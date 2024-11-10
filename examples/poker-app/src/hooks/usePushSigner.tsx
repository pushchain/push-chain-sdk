import PushNetwork from '@pushprotocol/node-core';
import { hexToBytes } from 'viem';
import useConnectedPushAddress from './useConnectedPushAddress.tsx';
import { useEffect, useState } from 'react';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { useSignMessage } from 'wagmi';
import { useAppContext } from './useAppContext.tsx';
import { PushWalletSigner } from '../temp_types/new-types.ts';

export default function usePushWalletSigner() {
  const { connectedPushAddressFormat } = useConnectedPushAddress();
  const { pushAccount, pushNetwork } = useAppContext();
  const { wallets } = useSolanaWallets();
  const { user } = usePrivy();
  const { signMessageAsync } = useSignMessage();
  const [pushWalletSigner, setPushWalletSigner] =
    useState<PushWalletSigner | null>(null);

  useEffect(() => {
    if (!connectedPushAddressFormat || !pushNetwork) return;
    const signer: PushWalletSigner = {
      account: connectedPushAddressFormat,
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
  }, [connectedPushAddressFormat, pushAccount, pushNetwork]);

  return { pushWalletSigner };
}
