import { usePrivy } from '@privy-io/react-auth';
import { useAppContext } from '@/context/app-context';
import { Button } from './ui/button';
import { ConnectPushWalletButton, TogglePushWalletButton } from '@pushprotocol/pushchain-ui-kit';

const LoggedOutView = () => {
  const { login } = usePrivy();
  const { pushAccount, setPushAccount, pushNetwork, account } = useAppContext();

  const connectPushWallet = async () => {
    try {
      const wallet = pushNetwork?.wallet;
      const walletAddress = await wallet?.connect();
      console.log("Push Wallet Address: ", walletAddress);

      return { success: true, walletAddress };
    } catch (err) {
      console.error("Push Wallet Connection Error: ", err);
      return { success: false, err };
    }
  };

  const handlePushWalletConnect = async () => {
    const result = await connectPushWallet();
    if (result.success) {
      setPushAccount(result.walletAddress);
      alert(`Push Wallet Connected: ${result.walletAddress}`);
    } else {
      alert("Failed to connect Push Wallet. Please try again.");
    }
  };

  return (
    <div className="w-screen h-screen flex flex-col gap-6 items-center justify-center">
      <div className="flex flex-row gap-4">
        <Button onClick={login} variant={'secondary'}>
          Login w/ any wallet
        </Button>
        <Button onClick={handlePushWalletConnect}>Login w/ Push Wallet</Button>
        {account ? (
          <TogglePushWalletButton account={account} />
        ) : (
          <ConnectPushWalletButton showLogOutButton />
        )}

      </div>
    </div>
  );
};


export default LoggedOutView;