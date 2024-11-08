import PushNetwork from '@pushprotocol/node-core';
import React, { createContext } from 'react';
import { PokerGame } from '../temp_types/types.ts';

interface AppContextType {
  pushNetwork: PushNetwork | null;
  setPushNetwork: React.Dispatch<React.SetStateAction<PushNetwork | null>>;
  pushAccount: string | null;
  setPushAccount: React.Dispatch<React.SetStateAction<string | null>>;
  gameStarted: boolean;
  setGameStarted: React.Dispatch<React.SetStateAction<boolean>>;
  game: PokerGame | null;
  setGame: React.Dispatch<React.SetStateAction<PokerGame | null>>;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);
