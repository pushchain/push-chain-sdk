'use client';
import { GameSessionData } from '@/common';
import { createUniversalSigner, PushChain } from '@pushchain/devnet';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import React, { createContext, useContext } from 'react';
import { ReactNode, useEffect, useState } from 'react';

interface AppContextType {
  pushChain: PushChain | null;
  setPushChain: React.Dispatch<React.SetStateAction<PushChain | null>>;
  currentSession: GameSessionData | null;
  setCurrentSession: React.Dispatch<
    React.SetStateAction<GameSessionData | null>
  >;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [pushChain, setPushChain] = useState<PushChain | null>(null);
  const [currentSession, setCurrentSession] = useState<GameSessionData | null>(
    null
  );
  const { universalAddress, handleSendSignRequestToPushWallet } =
    usePushWalletContext();

  useEffect(() => {
    if (universalAddress) {
      const setNetwork = async () => {
        const signer = createUniversalSigner({
          address: universalAddress.address,
          signMessage: async (data: Uint8Array) => {
            try {
              return await handleSendSignRequestToPushWallet(data);
            } catch (error) {
              console.error('Error signing with Push Wallet:', error);
              throw error;
            }
          },
        });
        try {
          const pushNetworkInstance = await PushChain.initialize(signer);
          setPushChain(pushNetworkInstance);
        } catch (error) {
          console.error('Error initializing Push Network:', error);
        }
      };
      setNetwork();
    }
  }, [universalAddress]);
  return (
    <AppContext.Provider
      value={{
        pushChain,
        setPushChain,
        currentSession,
        setCurrentSession,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
