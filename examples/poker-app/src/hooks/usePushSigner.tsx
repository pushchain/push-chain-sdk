import PushNetwork from '@pushprotocol/node-core';
import { hexToBytes } from 'viem';
import useConnectedPushAddress from './useConnectedPushAddress.tsx';
import { useEffect, useState } from 'react';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { useSignMessage } from 'wagmi';
import { useAppContext } from './useAppContext.tsx';

interface Signer {
  account: string;
  signMessage: (dataToBeSigned: Uint8Array) => Promise<Uint8Array>;
}

export default function usePushWalletSigner() {
  const { address } = useConnectedPushAddress();
  const { pushAccount, pushNetwork } = useAppContext();
  const { wallets } = useSolanaWallets();
  const { user } = usePrivy();
  const { signMessageAsync } = useSignMessage();
  const [pushWalletSigner, setPushWalletSigner] = useState<Signer | null>(null);

  useEffect(() => {
    if (!address || !pushAccount || !pushNetwork) return;
    const signer: Signer = {
      account: address,
      signMessage: async (data: Uint8Array): Promise<Uint8Array> => {
        if (!user?.wallet?.address && !pushAccount)
          throw new Error('No account connected');

        return pushAccount
          ? (pushNetwork as PushNetwork).wallet.sign(data)
          : user?.wallet?.chainType === 'solana'
          ? await wallets[0].signMessage(data)
          : hexToBytes(await signMessageAsync({ message: { raw: data } }));
      },
    };
    setPushWalletSigner(signer);
  }, [
    address,
    pushAccount,
    pushNetwork,
    signMessageAsync,
    user?.wallet?.address,
    user?.wallet?.chainType,
    wallets,
  ]);

  return { pushWalletSigner };
}
