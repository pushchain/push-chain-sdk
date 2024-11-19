import { usePrivy } from '@privy-io/react-auth';
import PushNetwork from '@pushprotocol/node-core';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';
import { PushContext } from '../context/push-context.tsx';
import { ReactNode, useEffect, useState } from 'react';
import { toBytes } from 'viem';
import { Social } from '../services/social.ts';

export function PushProvider({ children }: { children: ReactNode }) {
  const [pushNetwork, setPushNetwork] = useState<PushNetwork | null>(null);
  const [socialSDK, setSocialSDK] = useState<Social | null>(null);
  const [pushAccount, setPushAccount] = useState<string | null>(null);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);

  const { user } = usePrivy();

  useEffect(() => {
    (async () => {
      try {
        const pushNetworkInstance = await PushNetwork.initialize(ENV.DEV);
        setPushNetwork(pushNetworkInstance);
        setSocialSDK(await Social.initialize());
      } catch (error) {
        console.error('Error initializing Push Network:', error);
      }
    })();
  }, []);

  useEffect(() => {
    let address: string | null;
    if (pushAccount) address = pushAccount;
    else if (user && user.wallet) {
      if (user.wallet.chainType == 'solana') {
        address = `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${user.wallet.address}`;
      } else {
        address = `${user?.wallet?.chainId}:${user?.wallet?.address}`;
      }
    } else address = null;

    setConnectedAddress(address);
  }, [user, pushAccount]);

  async function pushWalletLoginHandler(): Promise<void> {
    try {
      if (pushNetwork) {
        const acc = await pushNetwork.wallet.connect();
        // Allow Connection only when DApp is whitelisted
        await pushNetwork.wallet.sign(
          toBytes('Accept Connection Request From DApp')
        );
        setPushAccount(acc);
      }
    } catch (err) {
      alert(err);
    }
  }

  return (
    <PushContext.Provider
      value={{
        connectedAddress,
        pushWalletLoginHandler,
        socialSDK
      }}
    >
      {children}
    </PushContext.Provider>
  );
}
