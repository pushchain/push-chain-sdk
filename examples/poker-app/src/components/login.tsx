import { usePrivy } from '@privy-io/react-auth';
import { toBytes } from 'viem';
import { useAppContext } from '../hooks/useAppContext.tsx';

const Login = () => {
  const { login } = usePrivy();
  const { pushNetwork, setPushAccount } = useAppContext();

  const pushWalletLoginHandler = async () => {
    try {
      if (pushNetwork) {
        const acc = await pushNetwork.wallet.connect();
        // Allow Connection only when DApp is whitelisted
        await pushNetwork.wallet.sign(
          toBytes('Accept Connection Request From DApp')
        );
        console.log('Connected account: ', acc);
        setPushAccount(acc);
      }
    } catch (err) {
      alert(err);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full w-full">
      <span className="text-3xl font-bold text-red-600 mb-10">
        ♠️ Poker App ♥️
      </span>
      <div className="flex flex-row gap-4 items-center justify-center ">
        <button
          className="bg-blue-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 transition duration-300"
          onClick={login}
        >
          Login w/ any wallet
        </button>
        <button
          className="bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-2 px-4 rounded-lg shadow-lg hover:from-purple-600 hover:to-pink-600 transition duration-300 transform hover:scale-105"
          onClick={pushWalletLoginHandler}
        >
          Login w/ Push Wallet
        </button>
      </div>
      <div className="w-1/2 h-1/2 relative mt-10">
        <iframe
          src="https://giphy.com/embed/httS0Xzi9ZMQ0"
          width="100%"
          height="100%"
          style={{ position: 'absolute' }}
          className="giphy-embed"
          //   allowFullScreen
        ></iframe>
      </div>
    </div>
  );
};

export default Login;
