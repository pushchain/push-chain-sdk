import PushNetwork from '@pushprotocol/node-core';
import React, { createContext } from 'react';

interface AppContextType {
  pushNetwork: PushNetwork | null;
  setPushNetwork: React.Dispatch<React.SetStateAction<PushNetwork | null>>;
  /**
   * This is the PUSH Address. If user connects with any wallet such as metamask, this will be `null`
   * Only set when user connects with Push Wallet.
   */
  pushAccount: string | null;
  setPushAccount: React.Dispatch<React.SetStateAction<string | null>>;
  gameStarted: boolean;
  setGameStarted: React.Dispatch<React.SetStateAction<boolean>>;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);
