// hooks/usePushChainClient.ts (use uid?:string in the future as prop)

import { usePushWalletContext } from './usePushWallet';
import { useEffect, useState } from 'react';
import { PushChain } from '@pushchain/core';
import { PUSH_NETWORK } from '@pushchain/core/src/lib/constants/enums';

export const usePushChainClient = (uid?: string) => {
  const {
    universalAccount,
    handleExternalWalletSignRequest,
    handleExternalWalletSignTransactionRequest,
    handleExternalWalletSignTypedDataRequest,
  } = usePushWalletContext(uid);
  const [pushChain, setPushChain] = useState<PushChain | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // initialise Push Chain instance here and export that
  useEffect(() => {
    const initializePushChain = async () => {
      if (!universalAccount) {
        setPushChain(null);
        return;
      }

      const signerSkeleton = PushChain.utils.signer.construct(
        universalAccount,
        {
          signMessage: handleExternalWalletSignRequest,
          signTransaction: handleExternalWalletSignTransactionRequest,
          signTypedData: handleExternalWalletSignTypedDataRequest,
        }
      );

      console.log(signerSkeleton);

      const universalSigner = await PushChain.utils.signer.toUniversal(
        signerSkeleton
      );

      const pushChainClient = await PushChain.initialize(universalSigner, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      });

      const txHash = await pushChainClient.universal.sendTransaction({
        target: '0xB59Cdc85Cacd15097ecE4C77ed9D225014b4D56D',
        value: BigInt(0),
      });

      console.log(txHash);

      // try {
      //   const signer = createUniversalSigner({
      //     address: universalAddress.address,
      //     chain: universalAddress.chain,
      //     chainId: universalAddress.chainId,
      //     signMessage: async (data: Uint8Array) => {
      //       return await handleSignMessage(data);
      //     },
      //   });

      //   // Push Chain is only initialized at devnet and mainnet
      //   const pushChainNetwork =
      //     config.env === ENV.LOCAL || config.env === ENV.TESTNET
      //       ? CONSTANTS.ENV.DEVNET
      //       : config.env;

      //   const instance = await PushChain.initialize(signer, {
      //     network: pushChainNetwork,
      //     rpcUrl: config.rpcURL,
      //   });

      //   console.log('Push Chain Initialised', instance);

      //   setPushChain(instance);
      //   setError(null);
      // } catch (err) {
      //   console.log('Error occured when initialising Push chain', err);
      //   setError(
      //     err instanceof Error
      //       ? err
      //       : new Error('Failed to initialize PushChain')
      //   );
      //   setPushChain(null);
      // }
    };

    initializePushChain();
  }, [universalAccount]);

  return {
    pushChainClient: pushChain,
    universalAccount,
    error,
    isLoading: !pushChain && !error,
  };
};
