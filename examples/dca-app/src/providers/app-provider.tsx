import { AppContext } from '@/context/app-context';
import { PushNetwork } from '@pushprotocol/push-chain';
import { ENV } from '@pushprotocol/push-chain/src/lib/constants';

import { ReactNode, useEffect, useState } from 'react';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';

export function AppProvider({ children }: { children: ReactNode }) {

  const { account, handleSendSignRequestToPushWallet } = usePushWalletContext();

  const [pushNetwork, setPushNetwork] = useState<PushNetwork | null>(null);
  const [pushAccount, setPushAccount] = useState<any>(null);
  const [watchAccount, setWatchAccount] = useState<string>('');


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
        account,
        handleSendSignRequestToPushWallet,
        pushNetwork,
        setPushNetwork,
        pushAccount,
        setPushAccount,
        watchAccount,
        setWatchAccount,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
