import { PushChain } from "@pushchain/core";
import { UniversalSigner } from "@pushchain/core/src/lib/universal/universal.types";
import { ChainType, IWalletProvider } from "../types";

export function createGuardedPushChain(
  baseClient: PushChain,
	handleExternalWalletConnection: (data: {
    chain: ChainType;
    provider: IWalletProvider["name"];
	}) => Promise<void>,
	requestPushWalletConnection: () => Promise<{
    chain: ChainType;
    provider: IWalletProvider["name"];
	}>,
  checkAndShowUpgradeIfNeeded: (pushChainClient: PushChain) => Promise<boolean>,
	universalSigner: UniversalSigner,
	intializeProps: any,
  uid: string,
	callback?: () => void,
): PushChain {
  const clientRef: { current: PushChain } = { current: baseClient };

  let promoting: Promise<void> | null = null;

  const promoteIfNeeded = async () => {
    if (!clientRef.current.isReadMode) return;

    if (!promoting) {
      promoting = (async () => {
        const walletInfo = localStorage.getItem(`walletInfo_${uid}`);
    		const walletData = walletInfo ? JSON.parse(walletInfo) : null;

				if (!walletData) {
					return;
				}

				if (walletData.wallet.providerName) {
					await handleExternalWalletConnection({
						chain: walletData.wallet.chainType,
						provider: walletData.wallet.providerName
					});
				} else {
					await requestPushWalletConnection();
				}

				const pushChainClient = await clientRef.current.reinitialize(universalSigner, intializeProps);

				callback?.();

				clientRef.current = pushChainClient;
				
      })().finally(() => {
        promoting = null;
      });
    }
    await promoting;
  };

  const checkUpgradeNeeded = async () => {
		const status = await checkAndShowUpgradeIfNeeded(clientRef.current);
		if (!status) {
			throw new Error('Account upgrade failed.');
		}
	};

  const wrapWrite = <A extends unknown[], R>(
    getter: () => (...args: A) => Promise<R>
	) => {
	const wrapped = async (...args: A): Promise<R> => {
		await promoteIfNeeded();
    await checkUpgradeNeeded();
		const fn = getter();
		return fn(...args);
	};
		return wrapped;
	};

  const universalProxy = new Proxy({} as PushChain["universal"], {
    get(_t, p, _r) {
      const u = clientRef.current.universal;
      if (p === "sendTransaction") {
        return wrapWrite(() => clientRef.current.universal.sendTransaction);
      }
      if (p === "executeTransactions") {
        return wrapWrite(() => clientRef.current.universal.executeTransactions);
      }
      if (p === "prepareTransaction") {
        return wrapWrite(() => clientRef.current.universal.prepareTransaction);
      }
      if (p === "signMessage") {
        return wrapWrite(() => clientRef.current.universal.signMessage);
      }
      if (p === "signTypedData") {
        return wrapWrite(() => clientRef.current.universal.signTypedData);
      }
      // @ts-expect-error: index access for dynamic property
      return u[p];
    },
  });

  const clientProxy = new Proxy(baseClient, {
    get(_target, prop, _receiver) {
      if (prop === "universal") return universalProxy;
      // @ts-expect-error: index access for dynamic property
      return clientRef.current[prop];
    },
  });

  return clientProxy;
}
