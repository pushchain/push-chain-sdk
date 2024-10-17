'use client';
import { AppContext } from '@/context/app-context';
import { IEmail } from '@/types';
import PushNetwork from '@pushprotocol/node-core/src/lib';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';
// import {ENV} from "@pushprotocol/node-core/src/lib/constants";
import { ReactNode, useEffect, useState } from 'react';

export function AppProvider({ children }: { children: ReactNode }) {
  const [searchInput, setSearchInput] = useState<string>('');
  const [selectedEmail, setSelectedEmail] = useState<IEmail | null>(null);
  const [pushNetwork, setPushNetwork] = useState<PushNetwork | null>(null);
  const [pushAccount, setPushAccount] = useState<any>(null);

  useEffect(() => {
    const setNetwork = async () => {
      try {
        const pushNetworkInstance = await PushNetwork.initialize(ENV.DEV);
        console.log('Push Network initialized:', pushNetworkInstance);
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
        searchInput,
        setSearchInput,
        selectedEmail,
        setSelectedEmail,
        pushNetwork,
        setPushNetwork,
        pushAccount,
        setPushAccount,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
