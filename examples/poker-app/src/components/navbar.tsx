import { usePrivy } from '@privy-io/react-auth';
import { useAppContext } from '../context/app-context';
import { trimAddress } from '../lib/utils';
import { TokenETH, TokenPUSH, TokenSOL } from '@web3icons/react';

export default function Navbar() {
  const { user, authenticated, logout } = usePrivy();
  const { pushAccount, setPushAccount } = useAppContext();

  const logoutHandler = () => {
    if (pushAccount) {
      setPushAccount(null);
    } else if (authenticated) {
      logout();
    }
  };

  return (
    <div className="flex flex-row gap-2 items-center justify-end p-4">
      {(pushAccount || authenticated) && (
        <button
          onClick={logoutHandler}
          className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
        >
          Logout
        </button>
      )}
      {(pushAccount || (authenticated && user)) && (
        <div className="flex flex-row items-center justify-center gap-2 border-2 border-secondary p-2 rounded-md bg-gray-100 shadow-md">
          {pushAccount ? (
            <TokenPUSH className="w-6 h-6" />
          ) : user?.wallet?.chainType === 'solana' ? (
            <TokenSOL className="w-6 h-6" />
          ) : (
            <TokenETH className="w-6 h-6" />
          )}
          <span className="text-gray-800 font-medium">
            {pushAccount
              ? trimAddress(pushAccount.split(':')[2])
              : user?.wallet?.address && trimAddress(user.wallet.address)}
          </span>
        </div>
      )}
    </div>
  );
}
