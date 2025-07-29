import { PushChain } from '@pushchain/core';
import { PROGRESS_HOOK } from '@pushchain/core/src/lib/progress-hook/progress-hook.types';
import { usePushWalletContext } from './usePushWallet';
import { useEffect, useState } from 'react';

export const usePushChainClient = (uid?: string) => {
  const {
    universalAccount,
    handleSignMessage,
    handleSignAndSendTransaction,
    handleSignTypedData,
    config,
    setProgress,
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

      const CHAINS = PushChain.CONSTANTS.CHAIN;

      const isSolana = [
        CHAINS.SOLANA_DEVNET,
        CHAINS.SOLANA_MAINNET,
        CHAINS.SOLANA_TESTNET,
      ].includes(universalAccount.chain);

      try {
        const signerSkeleton = PushChain.utils.signer.construct(
          universalAccount,
          {
            signMessage: handleSignMessage,
            signAndSendTransaction: handleSignAndSendTransaction,
            signTypedData: isSolana ? undefined : handleSignTypedData,
          }
        );

        const universalSigner = await PushChain.utils.signer.toUniversal(
          signerSkeleton
        );

        const pushChainClient = await PushChain.initialize(universalSigner, {
          network: config.network,
          progressHook: async (progress: any) => {
            setProgress(progress);

            if (
              progress.id === PROGRESS_HOOK.SEND_TX_99_01 ||
              progress.id === PROGRESS_HOOK.SEND_TX_99_02
            ) {
              setTimeout(() => setProgress(null), 5000);
            }
          },
          rpcUrls: config.chainConfig?.rpcUrls,
          blockExplorers: config.chainConfig?.blockExplorers,
          printTraces: config.chainConfig?.printTraces,
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
    error,
    isInitialized: !!pushChain && !error,
  };
};
