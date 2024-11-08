import { AppContext } from '../context/app-context';
import PushNetwork from '@pushprotocol/node-core';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';

import { ReactNode, useEffect, useState } from 'react';
import { PokerGame } from '../temp_types/types.ts';

export function AppProvider({ children }: { children: ReactNode }) {
  const [pushNetwork, setPushNetwork] = useState<PushNetwork | null>(null);
  const [pushAccount, setPushAccount] = useState<string | null>(null);
  const [gameStarted, setGameStarted] = useState<boolean>(false);
  const [game, setGame] = useState<PokerGame | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const pushNetworkInstance = await PushNetwork.initialize(ENV.DEV);
        setPushNetwork(pushNetworkInstance);
      } catch (error) {
        console.error('Error initializing Push Network:', error);
      }
    })();
  }, []);

  return (
    <AppContext.Provider
      value={{
        pushNetwork,
        setPushNetwork,
        pushAccount,
        setPushAccount,
        gameStarted,
        setGameStarted,
        game,
        setGame,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
