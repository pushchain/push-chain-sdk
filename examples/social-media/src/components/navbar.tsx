import { usePrivy } from '@privy-io/react-auth';
import { usePushContext } from '../usePushContext.tsx';

/**
 * Navbar only shows when user authenticated, so no need to check if user has connected
 */
export function Navbar() {
  const { logout } = usePrivy();
  const { connectedAddress } = usePushContext();

  return (
    <div className="w-full mt-2 flex justify-end pr-2 items-center gap-2">
      <div>Welcome {`${connectedAddress!.slice(0, 15)}...${connectedAddress!.slice(-6)}`}</div>
      <button
        className="bg-red-500 hover:bg-red-700 text-white p-2 rounded font-bold"
        onClick={logout}
      >
        Logout
      </button>
    </div>
  );
}
