import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { PushNetwork } from '@pushprotocol/node-core';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';
import { PushContext } from '../context/push-context.tsx';
import { ReactNode, useEffect, useState } from 'react';
import { hexToBytes, recoverAddress, toBytes } from 'viem';
import { Social } from '../services/social.ts';
import { PushWalletSigner } from '../types';
import { useSignMessage } from 'wagmi';

export function PushProvider({ children }: { children: ReactNode }) {
  const [pushNetwork, setPushNetwork] = useState<PushNetwork | null>(null);
  const [socialSDK, setSocialSDK] = useState<Social | null>(null);
  const [pushAccount, setPushAccount] = useState<string | null>(null);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [pushSigner, setPushSigner] = useState<PushWalletSigner | null>(null);
  const { wallets } = useSolanaWallets();
  const { signMessageAsync } = useSignMessage();

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

  /**
   * Set connected address to the application. It can be the Push address or the normal address connected from a wallet
   */
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

  /**
   * Create Signer type that will be used to sign messages
   */
  useEffect(() => {
    if (!connectedAddress || !pushNetwork) return;
    const signer: PushWalletSigner = {
      account: connectedAddress,
      signMessage: async (data: Uint8Array): Promise<Uint8Array> => {
        if (!connectedAddress) throw new Error('User not connected');
        if (!pushNetwork) throw new Error('Not connected to Push Network');

        if (pushAccount) return pushNetwork.wallet.sign(data);
        else if (user?.wallet?.chainType === 'solana') return await wallets[0].signMessage(data);
        else return hexToBytes(await signMessageAsync({ message: { raw: data } }));
      },
      verifySignature: async (expectedAddress: string, hashedPayload: Uint8Array, signature: Uint8Array): Promise<boolean> => {
        if (!pushNetwork) throw new Error('Not connected to Push Network');
        // TODO: Currently we can't verify signature from Push Wallet
        if (pushAccount) return false;
        // TODO: Implement for Solana
        else if (user?.wallet?.chainType === 'solana') return false;
        else {
          const recoveredAddress = await recoverAddress({ hash: hashedPayload, signature });
          return toCaip10(recoveredAddress) === expectedAddress;
        }
      }
    };
    setPushSigner(signer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedAddress, pushAccount, pushNetwork]);

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

  function toCaip10(address: string): string {
    if (address.toLowerCase().startsWith('push'))
      throw new Error('For now we are not checking for push wallet addresses');
    else if (address.length === 44) throw new Error('We are not checking solana signatures for now');
    else {
      return `${user?.wallet?.chainId}:${user?.wallet?.address}`;
    }
  }

  return (
    <PushContext.Provider
      value={{
        connectedAddress,
        pushWalletLoginHandler,
        socialSDK,
        pushSigner
      }}
    >
      {children}
    </PushContext.Provider>
  );
}
