import { TokenETH, TokenPUSH, TokenSOL } from '@web3icons/react';
import { usePrivy } from '@privy-io/react-auth';
import { trimAddress } from '@/lib/utils';
import { useAppContext } from '@/context/app-context';
import { Button } from './ui/button';
const ConnectedWalletInfo = () => {
  const { user, authenticated, logout } = usePrivy();
  const { pushAccount, setPushAccount, setSelectedEmail } = useAppContext();

  const logoutHandler = () => {
    if (pushAccount) {
      setPushAccount(null);
    } else if (authenticated) {
      logout();
    }
    setSelectedEmail(null);
  };
  return (
    <div className="flex flex-row gap-2 items-center">
      {(pushAccount || authenticated) && (
        <Button onClick={logoutHandler} variant={'outline'}>
          Logout
        </Button>
      )}
      {(pushAccount || (authenticated && user)) && (
        <div className="flex flex-row items-center justify-center gap-2 border-2 border-secondary p-2 rounded-md">
          {pushAccount ? (
            <TokenPUSH className="w-6 h-6" />
          ) : user?.wallet?.chainType === 'solana' ? (
            <TokenSOL className="w-6 h-6" />
          ) : (
            <TokenETH className="w-6 h-6" />
          )}
          <span>
            {pushAccount
              ? trimAddress(pushAccount.split(':')[2])
              : user?.wallet?.address && trimAddress(user.wallet.address)}
          </span>{' '}
        </div>
      )}
    </div>
  );
};

export default ConnectedWalletInfo;
