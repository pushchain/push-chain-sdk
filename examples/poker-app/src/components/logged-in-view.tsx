import { useState } from 'react';
import Navbar from './navbar';

export default function LoggedInView() {
  const [friendsWallets, setFriendsWallets] = useState<string[]>([]);
  const [walletInput, setWalletInput] = useState<string>('');

  const handleAddFriend = () => {
    if (walletInput) {
      setFriendsWallets([...friendsWallets, walletInput]);
      setWalletInput('');
    }
  };

  return (
    <div>
      <Navbar />
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
      </div>
    </div>
  );
}
