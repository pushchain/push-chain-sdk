import { usePrivy } from '@privy-io/react-auth';

/**
 * Navbar only shows when user authenticated, so no need to check if user has connected
 */
export function Navbar() {
  const { logout } = usePrivy();

  return (
    <div className="w-full mt-2 flex justify-end pr-2">
      <button
        className="bg-red-500 hover:bg-red-700 text-white p-2 rounded font-bold"
        onClick={logout}
      >
        Logout
      </button>
    </div>
  );
}
