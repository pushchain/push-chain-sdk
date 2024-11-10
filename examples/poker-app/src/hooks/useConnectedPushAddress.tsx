import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';
import { useAppContext } from './useAppContext.tsx';

interface ConnectedPushAddress {
  /**
   * PUSH address format.
   * If user connected with PUSH Wallet, then this will be the PUSH address.
   * The address should follow the CAIP-10 standard format, such as `eip155:1:0x1234567890abcdef`.
   * If no address is connected, this value can be `null`.
   *
   * @example "eip155:1:0x1234567890abcdef" // Ethereum mainnet
   * @example "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:4TfXTVmQJPa8m9" // Solana mainnet
   *
   */
  connectedPushAddressFormat: string | null;
}

/**
 * This hook will return the connected address in the PUSH Format
 */
export default function useConnectedPushAddress(): ConnectedPushAddress {
  const { user } = usePrivy();
  const { pushAccount } = useAppContext();
  const [connectedPushAddressFormat, setConnectedPushAddressFormat] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (user) {
      const pushAddress = pushAccount
        ? pushAccount
        : user?.wallet?.chainType === 'solana'
        ? `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${user?.wallet?.address}`
        : `${user?.wallet?.chainId}:${user?.wallet?.address}`;
      setConnectedPushAddressFormat(pushAddress);
    }
  }, [user, pushAccount]);

  return { connectedPushAddressFormat };
}
