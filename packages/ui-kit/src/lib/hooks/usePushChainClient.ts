import { PushChain } from '@pushchain/core';
import { PROGRESS_HOOK, ProgressEvent } from '@pushchain/core/src/lib/progress-hook/progress-hook.types';
import { usePushWalletContext } from './usePushWallet';
import { useEffect, useState, useRef } from 'react';
import { createGuardedPushChain } from '../helpers/txnAuthGuard';

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

  const MIN_VISIBLE_MS = 2000;
  const SUCCESS_HIDE_MS = 10000;

  const queueRef = useRef<ProgressEvent[]>([]);
  const lockRef = useRef(false);

  const minTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearProgressTimers = () => {
    if (minTimerRef.current) {
      clearTimeout(minTimerRef.current);
      minTimerRef.current = null;
    }
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  };

  const showProgress = (p: ProgressEvent) => {
    clearProgressTimers();

    setProgress(p);

    lockRef.current = true;
    minTimerRef.current = setTimeout(() => {
      lockRef.current = false;
      minTimerRef.current = null;

      if (queueRef.current.length > 0) {
        const next = queueRef.current.shift();
        if (next) showProgress(next);
      }
    }, MIN_VISIBLE_MS);

    if (p.id === PROGRESS_HOOK.SEND_TX_99_01) {
      successTimerRef.current = setTimeout(() => setProgress(null), SUCCESS_HIDE_MS);
    }
  };

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
        const signerSkeleton = PushChain.utils.signer.construct(universalAccount, {
          signMessage: handleSignMessage,
          signAndSendTransaction: handleSignAndSendTransaction,
          signTypedData: isSolana ? undefined : handleSignTypedData,
        });

        const universalSigner = await PushChain.utils.signer.toUniversal(signerSkeleton);

        const intializeProps = {
          network: config.network,

          progressHook: async (incoming: ProgressEvent) => {
            if (!lockRef.current) {
              showProgress(incoming);
            } else {
              queueRef.current.push(incoming);
            }
          },

          rpcUrls: config.chainConfig?.rpcUrls,
          blockExplorers: config.chainConfig?.blockExplorers,
          printTraces: config.chainConfig?.printTraces,
        };

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
        setError(err instanceof Error ? err : new Error('Failed to initialize PushChain'));
        setPushChain(null);
      }
    };

    initializePushChain();

    return () => {
      clearProgressTimers();
      queueRef.current = [];
      lockRef.current = false;
    };
  }, [universalAccount, config, isReadOnly]);

  return {
    pushChainClient: pushChain,
    error,
    isInitialized: !!pushChain && !error,
  };
};
