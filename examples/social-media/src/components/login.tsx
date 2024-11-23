import { usePrivy } from '@privy-io/react-auth';
import { usePushContext } from '../hooks/usePushContext.tsx';

export function Login() {
  const { login } = usePrivy();
  const { pushWalletLoginHandler } = usePushContext();

  return (
    <div className="flex h-screen justify-center items-center gap-2">
      <button
        className="bg-blue-500 h-fit p-2 rounded text-white hover:bg-blue-600"
        onClick={login}
      >
        Login with any wallet
      </button>
      <button
        className="bg-green-500 h-fit p-2 rounded text-white hover:bg-green-600"
        onClick={pushWalletLoginHandler}
      >
        Login with Push Wallet
      </button>
    </div>
  );
}
