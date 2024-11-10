import { useEffect, useState } from 'react';
import Navbar from './navbar';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { Poker } from '../services/poker.ts';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';
import Game from './game';
import PublicGames from './public-games';
import useConnectedPushAddress from '../hooks/useConnectedPushAddress.tsx';
import usePushWalletSigner from '../hooks/usePushSigner.tsx';

export default function LoggedInView() {
  const [friendsWallets, setFriendsWallets] = useState<string[]>([]);
  const [loadingStartGame, setLoadingStartGame] = useState<boolean>(false);
  const [walletInput, setWalletInput] = useState<string>('');
  const [recommendedWallets, setRecommendedWallets] = useState<string[]>([]);
  const [txHash, setTxHash] = useState<string | null>(null);
  const { address } = useConnectedPushAddress();
  const { pushWalletSigner } = usePushWalletSigner();

  useEffect(() => {
    const storedAddresses = localStorage.getItem('poker-friends-wallets');
    if (storedAddresses) {
      setRecommendedWallets(JSON.parse(storedAddresses));
    }
  }, []);

  const handleAddFriend = (recommendedWallet?: string) => {
    if (friendsWallets.length >= 4) {
      toast.error('Only a maximum of 4 players can be added.');
      return;
    }
    if (walletInput) {
      if (
        walletInput.startsWith('solana:') ||
        walletInput.startsWith('eip155:')
      ) {
        setFriendsWallets([...friendsWallets, walletInput]);
        setWalletInput('');

        // Save to local storage for recommended wallets
        if (!recommendedWallets.includes(walletInput)) {
          const updatedRecommendedWallets = [
            ...recommendedWallets,
            walletInput,
          ];
          localStorage.setItem(
            'poker-friends-wallets',
            JSON.stringify(updatedRecommendedWallets)
          );
        }
      } else {
        toast.error(
          `Wallet should be in CAIP10 format or PUSH format (e.g. eip155:1:0x1234567890)`
        );
      }
    } else if (recommendedWallet) {
      if (
        recommendedWallet.startsWith('solana:') ||
        recommendedWallet.startsWith('eip155:')
      ) {
        setFriendsWallets([...friendsWallets, recommendedWallet]);
        setRecommendedWallets(
          recommendedWallets.filter((w) => w !== recommendedWallet)
        );

        // Save to local storage for recommended wallets
        if (!recommendedWallets.includes(recommendedWallet)) {
          const updatedRecommendedWallets = [
            ...recommendedWallets,
            recommendedWallet,
          ];
          localStorage.setItem(
            'poker-friends-wallets',
            JSON.stringify(updatedRecommendedWallets)
          );
        }
      } else {
        toast.error(
          `Wallet should be in CAIP10 format or PUSH format (e.g. eip155:1:0x1234567890)`
        );
      }
    }
  };

  const handleRemoveFriend = (wallet: string) => {
    setFriendsWallets(friendsWallets.filter((w) => w !== wallet));
  };

  const handleCreateGame = async (type: 'public' | 'private') => {
    try {
      setLoadingStartGame(true);
      console.log('address', address, 'pushSigner', pushWalletSigner);
      if (!address || !pushWalletSigner) return;
      const poker = await Poker.initialize(ENV.DEV);
      const tx = await poker.createGame({ type }, [address], pushWalletSigner);
      setTxHash(tx);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingStartGame(false);
    }
  };

  return (
    <div>
      <Navbar />
      <ToastContainer />
      {txHash ? (
        <Game txHash={txHash} />
      ) : (
        <div className="flex flex-col items-center justify-center h-full w-full">
          <h1 className="text-4xl font-bold">Poker App</h1>
          <div className="flex flex-row justify-center items-center w-full gap-4 mt-8">
            <div className="relative group">
              <button
                className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-700 hover:to-purple-700 text-white font-bold py-2 px-4 rounded-full shadow-lg transform transition-transform hover:scale-105"
                onClick={() => handleCreateGame('public')}
                disabled={loadingStartGame}
              >
                {loadingStartGame ? (
                  <div className="flex flex-row items-center justify-center">
                    <svg
                      className="animate-spin h-5 w-5 mr-3 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                      ></path>
                    </svg>
                    Creating Game...
                  </div>
                ) : (
                  'Create public game'
                )}
              </button>
              <span className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-800 text-white text-xs rounded py-1 px-2">
                Any one can join
              </span>
            </div>
            <div className="relative group">
              <button
                className="bg-gradient-to-r from-green-500 to-teal-500 hover:from-green-700 hover:to-teal-700 text-white font-bold py-2 px-4 rounded-full shadow-lg transform transition-transform hover:scale-105"
                disabled={loadingStartGame}
              >
                Create game with friends
              </button>
              <span className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-800 text-white text-xs rounded py-1 px-2">
                Only your invited friends can join
              </span>
            </div>
          </div>
          {txHash && (
            <div className="flex flex-row items-center justify-center gap-2 w-full mt-8">
              <span>Transaction hash: {txHash}</span>
            </div>
          )}

          <div className="flex flex-row items-center justify-center w-full mt-8">
            <PublicGames />
          </div>

          <div className="flex flex-row items-center justify-center gap-2 w-full mt-8">
            <input
              type="text"
              placeholder="Enter friend's wallet address"
              className="border-2 border-gray-300 rounded-md p-2 w-1/3"
              value={walletInput}
              onChange={(e) => setWalletInput(e.target.value)}
            />
            <button
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              onClick={() => handleAddFriend()}
              disabled={!walletInput}
            >
              Add Friend
            </button>
          </div>

          {recommendedWallets.length > 0 && (
            <div className="flex flex-col items-center justify-center gap-1 w-full mt-8">
              <h2 className="text-2xl font-bold text-gray-500">
                Previously added friends
              </h2>
              <h3 className="text-gray-500">
                Select one of those to start a game faster ;P
              </h3>
              {recommendedWallets.map((wallet) => (
                <div
                  className="flex flex-row items-center justify-center gap-2"
                  key={wallet}
                >
                  <span
                    className="bg-gray-200 rounded-md p-2 cursor-pointer text-sm"
                    onClick={() => handleAddFriend(wallet)}
                  >
                    {wallet}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col items-center justify-center gap-2 w-full mt-8">
            {friendsWallets.map((wallet) => (
              <div
                className="flex flex-row items-center justify-center gap-2"
                key={wallet}
              >
                <span>{wallet}</span>
                <button
                  className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-1 rounded"
                  onClick={() => handleRemoveFriend(wallet)}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-6 h-6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          {friendsWallets.length > 0 && (
            <button
              className="bg-green-500 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-full shadow-lg mt-32 transition-transform transform hover:scale-105"
              onClick={() => handleCreateGame('private')}
              disabled={loadingStartGame}
            >
              {loadingStartGame ? (
                <div className="flex flex-row items-center justify-center">
                  <svg
                    className="animate-spin h-5 w-5 mr-3 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    ></path>
                  </svg>
                  Starting Game...
                </div>
              ) : (
                'Start Game'
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
