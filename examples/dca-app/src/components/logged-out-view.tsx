import { usePrivy } from '@privy-io/react-auth';
import { useAppContext } from '@/context/app-context';
import { Button } from './ui/button';
import { isAddress, toBytes } from 'viem';
import { Input } from './ui/input';

const LoggedOutView = () => {
  const { login } = usePrivy();
  const { pushNetwork, setPushAccount, watchAccount, setWatchAccount } =
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
      <span className="bg-gray-300 rounded-full p-4 text-gray-700">OR</span>
      <Input
        value={watchAccount}
        onChange={(e) => {
          if (isAddress(e.target.value)) setWatchAccount(e.target.value);
        }}
        placeholder="just watch a wallet"
        className="w-80 border-primary"
      />
    </div>
  );
};

export default LoggedOutView;
