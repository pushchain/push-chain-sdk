import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';
import { useAppContext } from './useAppContext.tsx';

export default function useConnectedPushAddress() {
  const { user } = usePrivy();
  const { pushAccount } = useAppContext();
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      const pushAddress = pushAccount
        ? pushAccount
        : user?.wallet?.chainType === 'solana'
        ? `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${user?.wallet?.address}`
        : `${user?.wallet?.chainId}:${user?.wallet?.address}`;
      setAddress(pushAddress);
    }
  }, [user, pushAccount]);

  return { address };
}
