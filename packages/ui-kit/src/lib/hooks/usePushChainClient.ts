import { PushChain } from '@pushchain/core';
import { PROGRESS_HOOK } from '@pushchain/core/src/lib/progress-hook/progress-hook.types';
import { usePushWalletContext } from './usePushWallet';
import { useEffect, useState } from 'react';
import { createGuardedPushChain } from '../helpers/txnAuthGuard';
import { useRef } from 'react';

export const usePushChainClient = (uid?: string) => {
  const {
    universalAccount,
    handleSignMessage,
    handleSignAndSendTransaction,
    handleSignTypedData,
    handleExternalWalletConnection,
    requestPushWalletConnection,
    config,
    setProgress,
    isReadOnly,
    setIsReadOnly
  } = usePushWalletContext(uid);
  const [pushChain, setPushChain] = useState<PushChain | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

        const intializeProps = {
          network: config.network,
          progressHook: async (progress: any) => {
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
            setProgress(progress);

            if ( progress.id === PROGRESS_HOOK.SEND_TX_99_01 ) {
              timeoutRef.current = setTimeout(() => setProgress(null), 10000);
            }
          },
          rpcUrls: config.chainConfig?.rpcUrls,
          blockExplorers: config.chainConfig?.blockExplorers,
          printTraces: config.chainConfig?.printTraces,
        }

        if (isReadOnly) {
          const pushChainClient = await PushChain.initialize(universalAccount, {
            network: config.network,
          });
          setPushChain(
            createGuardedPushChain(
              pushChainClient,
              handleExternalWalletConnection,
              requestPushWalletConnection,
              universalSigner,
              intializeProps,
              () => {
                setIsReadOnly(false);
              },
            )
          );
        } else {
          const pushChainClient = await PushChain.initialize(universalSigner, intializeProps);
          setPushChain(pushChainClient);
        }
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
