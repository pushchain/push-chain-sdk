import { usePrivy } from '@privy-io/react-auth';
// import { useAppContext } from '@/context/app-context';
import { toBytes } from 'viem';

const Login = () => {
  const { login } = usePrivy();
  //   const { pushNetwork, setPushAccount } = useAppContext();

  //   const pushWalletLoginHandler = async () => {
  //     try {
  //       if (pushNetwork) {
  //         const acc = await pushNetwork.wallet.connect();
  //         // Allow Connection only when DApp is whitelisted
  //         await pushNetwork.wallet.sign(
  //           toBytes('Accept Connection Request From DApp')
  //         );
  //         setPushAccount(acc);
  //       }
  //     } catch (err) {
  //       alert(err);
  //     }
  //   };

  return (
    <div className="flex flex-row gap-4 items-center justify-center h-full w-full">
      <button onClick={login}>Login w/ any wallet</button>
      {/* <button onClick={pushWalletLoginHandler}>Login w/ Push Wallet</button> */}
    </div>
  );
};

export default Login;
