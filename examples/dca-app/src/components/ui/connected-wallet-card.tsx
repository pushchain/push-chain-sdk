import { usePrivy } from '@privy-io/react-auth';
import { Button } from '@/components/ui/button';

import { trimAddress } from '@/lib/utils';
import { useAppContext } from '@/context/app-context';
import { Badge } from './badge';

const ConnectedWalletCard = () => {
  const { authenticated, logout, user } = usePrivy();
  const { pushAccount, setPushAccount } = useAppContext();
  const logoutHandler = () => {
    if (pushAccount) {
      setPushAccount(null);
    } else if (authenticated) {
      logout();
    }
  };
  return (
    <div>
      {authenticated && (
        <div className="flex flex-row gap-2">
          <Badge variant={'secondary'}>
            {user?.wallet?.address && trimAddress(user.wallet.address)}
          </Badge>

          <Button onClick={logoutHandler}>Logout</Button>
        </div>
      )}
    </div>
  );
};

export default ConnectedWalletCard;
