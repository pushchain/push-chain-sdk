import PushNetwork from '@pushprotocol/node-core';
import React, { createContext } from 'react';

interface AppContextType {
  pushNetwork: PushNetwork | null;
  setPushNetwork: React.Dispatch<React.SetStateAction<PushNetwork | null>>;
  pushAccount: string | null;
  setPushAccount: React.Dispatch<React.SetStateAction<string | null>>;
  gameStarted: boolean;
  setGameStarted: React.Dispatch<React.SetStateAction<boolean>>;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);
