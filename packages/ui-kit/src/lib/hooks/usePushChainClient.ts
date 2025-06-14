// hooks/usePushChainClient.ts (use uid?:string in the future as prop)

import { usePushWalletContext } from './usePushWallet';
import { useEffect, useState } from 'react';
import { PushChain } from '@pushchain/core';

export const usePushChainClient = (uid?: string) => {
  const {
    universalAccount,
    handleSignMessage,
    handleSignTransaction,
    handleSignTypedData,
    config,
  } = usePushWalletContext(uid);
  const [pushChain, setPushChain] = useState<PushChain | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const dummySendTransaction = async (txn: Uint8Array) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const dummySignature = new Uint8Array(65).fill(0);

    return dummySignature;
  };

  // initialise Push Chain instance here and export that
  useEffect(() => {
    const initializePushChain = async () => {
      if (!universalAccount) {
        setPushChain(null);
        return;
      }

      try {
        const signerSkeleton = PushChain.utils.signer.construct(
          universalAccount,
          {
            signMessage: handleSignMessage,
            signTransaction: dummySendTransaction,
            signTypedData: handleSignTypedData,
          }
        );

        const universalSigner = await PushChain.utils.signer.toUniversal(
          signerSkeleton
        );

        const pushChainClient = await PushChain.initialize(universalSigner, {
          network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
          rpcUrls: config.chain?.rpcUrls,
          blockExplorers: config.chain?.blockExplorers,
          printTraces: config.chain?.printTraces,
        });

        setPushChain(pushChainClient);
        setError(null);
      } catch (err) {
        console.log('Error occured when initialising Push chain', err);
        setError(
          err instanceof Error
            ? err
            : new Error('Failed to initialize PushChain')
        );
        setPushChain(null);
      }
    };

    initializePushChain();
  }, [universalAccount, config]);

  return {
    pushChainClient: pushChain,
    universalAccount,
    error,
    isLoading: !pushChain && !error,
  };
};
