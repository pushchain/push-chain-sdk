import { useState } from 'react';
import Navbar from './navbar';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

export default function LoggedInView() {
  const [friendsWallets, setFriendsWallets] = useState<string[]>([]);
  const [walletInput, setWalletInput] = useState<string>('');

  const handleAddFriend = () => {
    if (friendsWallets.length >= 4) {
      toast.error('Only a maximum of 4 players can be added.');
      return;
    }
    if (walletInput) {
      setFriendsWallets([...friendsWallets, walletInput]);
      setWalletInput('');
    }
  };

  return (
    <div>
      <Navbar />
      <ToastContainer />
      <div className="flex flex-col items-center justify-center h-full w-full">
        <h1 className="text-4xl font-bold">Poker App</h1>
        <p className="text-gray-500 mt-2">
          Poker is better when you play with friends!
        </p>
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
            onClick={handleAddFriend}
            disabled={!walletInput}
          >
            Add Friend
          </button>
        </div>
        <div className="flex flex-col items-center justify-center gap-2 w-full mt-8">
          {friendsWallets.map((wallet) => (
            <div key={wallet}>{wallet}</div>
          ))}
        </div>
        {friendsWallets.length > 0 && (
          <button className="bg-green-500 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-full shadow-lg mt-32 transition-transform transform hover:scale-105">
            Send Invite
          </button>
        )}
      </div>
    </div>
  );
}
