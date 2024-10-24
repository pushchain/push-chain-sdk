import { AppContext } from '../context/app-context';
import PushNetwork from '@pushprotocol/node-core';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';

import { ReactNode, useEffect, useState } from 'react';

export function AppProvider({ children }: { children: ReactNode }) {
  const [pushNetwork, setPushNetwork] = useState<PushNetwork | null>(null);
  const [pushAccount, setPushAccount] = useState<string | null>(null);
  const [gameStarted, setGameStarted] = useState<boolean>(false);

  useEffect(() => {
    const setNetwork = async () => {
      try {
        const pushNetworkInstance = await PushNetwork.initialize(ENV.DEV);
        setPushNetwork(pushNetworkInstance);
      } catch (error) {
        console.error('Error initializing Push Network:', error);
      }
    };
    setNetwork();
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
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
