import { PushNetwork } from '@pushprotocol/push-chain';
import React, { createContext, useContext } from 'react';

interface AppContextType {
  account: string | null;
  handleSendSignRequestToPushWallet: (data: Uint8Array) => Promise<Uint8Array>;
  pushNetwork: PushNetwork | null;
  setPushNetwork: React.Dispatch<React.SetStateAction<PushNetwork | null>>;
  pushAccount: any;
  setPushAccount: React.Dispatch<React.SetStateAction<any>>;
  watchAccount: string;
  setWatchAccount: React.Dispatch<React.SetStateAction<string>>;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
