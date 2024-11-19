import { usePrivy } from '@privy-io/react-auth';
import { usePushContext } from '../usePushContext.tsx';

export function Login() {
  const { login } = usePrivy();
  const { pushWalletLoginHandler } = usePushContext();

  return (
    <div>
      <button onClick={login}>Login with any wallet</button>
      <button onClick={pushWalletLoginHandler}>Login with Push Wallet</button>
    </div>
  );
}
