import { usePrivy } from '@privy-io/react-auth';
import { useAppContext } from '@/context/app-context';
import { useEffect } from 'react';
import { Button } from './ui/button';
import { ConnectPushWalletButton } from '@pushprotocol/pushchain-ui-kit';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';

const LoggedOutView = () => {
  const { login } = usePrivy();
  const { setPushAccount, account } = useAppContext();
  const { account: pushWalletAccount } = usePushWalletContext();

  // Set push account whenever pushWalletAccount changes
  useEffect(() => {
    if (pushWalletAccount) {
      setPushAccount(pushWalletAccount);
    }
  }, [pushWalletAccount, setPushAccount]);

  return (
    <div className="w-screen h-screen flex flex-col gap-6 items-center justify-center">
      <div className="flex flex-row gap-4">
          <ConnectPushWalletButton showLogOutButton />
      </div>
    </div>
  );
};

export default LoggedOutView;