import { usePrivy } from '@privy-io/react-auth';
import { useAppContext } from '@/context/app-context';
import { Button } from './ui/button';
import { toBytes } from 'viem';

const LoggedOutView = () => {
  const { login } = usePrivy();
  const { pushNetwork, setPushAccount } =
    useAppContext();
  const pushWalletLoginHandler = async () => {
    try {
      if (pushNetwork) {
        const acc = await pushNetwork.wallet.connect();
        // Allow Connection only when DApp is whitelisted
        await pushNetwork.wallet.sign(
          toBytes('Accept Connection Request From DApp')
        );
        setPushAccount(acc);
      }
    } catch (err) {
      alert(err);
    }
  };

  return (
    <div className="w-screen h-screen flex flex-col gap-6 items-center justify-center">
      <div className="flex flex-row gap-4">
        <Button onClick={login} variant={'secondary'}>
          Login w/ any wallet
        </Button>
        <Button onClick={pushWalletLoginHandler}>Login w/ Push Wallet</Button>
      </div>
    </div>
  );
};


export default LoggedOutView;
