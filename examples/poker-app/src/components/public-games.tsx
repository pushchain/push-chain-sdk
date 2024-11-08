import { useEffect, useState } from 'react';
import { Poker } from '../services/poker.ts';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';
import { GamesTable } from '../temp_types/new-types';
import { trimAddress } from '../lib/utils';
import PushNetwork from '@pushprotocol/node-core';
import { useAppContext } from '../context/app-context';
import { useSignMessage } from 'wagmi';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { hexToBytes } from 'viem';

export default function PublicGames() {
  const [publicGames, setPublicGames] = useState<GamesTable[]>([]);
  const [loading, setLoading] = useState(true);
  const { pushAccount, pushNetwork, setGameStarted } = useAppContext();
  const { signMessageAsync } = useSignMessage();
  const { wallets } = useSolanaWallets();
  const { user } = usePrivy();

  const address = pushAccount
    ? pushAccount
    : user?.wallet?.chainType === 'solana'
    ? `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${user?.wallet?.address}`
    : `${user?.wallet?.chainId}:${user?.wallet?.address}`;

  useEffect(() => {
    const fetchGames = async () => {
      try {
        setLoading(true);
        const poker = await Poker.initialize(ENV.DEV);
        const games = await poker.get({ type: 'public' });
        const gamesToShow: GamesTable[] = [];
        for (const game of games) {
          // if (game.creator === address) continue; // Skip the user's own wallet
          const isGameStarted = await poker.checkIfGameStarted({
            txHash: game.txHash,
            creator: game.creator,
          });
          if (!isGameStarted) {
            gamesToShow.push(game);
          }
        }
        for (const game of gamesToShow) {
          game.numberOfPlayers = await poker.getNumberOfPlayersForTable({
            txHash: game.txHash,
            creator: game.creator,
          });
        }
        setPublicGames(gamesToShow);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    fetchGames();
  }, []);

  const handleJoinGame = async (game: GamesTable) => {
    const poker = await Poker.initialize(ENV.DEV);
    const signer = {
      account: address,
      signMessage: async (data: Uint8Array): Promise<Uint8Array> => {
        if (!user?.wallet?.address && !pushAccount)
          throw new Error('No account connected');

        return pushAccount
          ? (pushNetwork as PushNetwork).wallet.sign(data)
          : user?.wallet?.chainType === 'solana'
          ? await wallets[0].signMessage(data)
          : hexToBytes(await signMessageAsync({ message: { raw: data } }));
      },
    };

    await poker.joinGame({
      txHash: game.txHash,
      tos: [game.creator],
      signer,
    });
  };

  function displayButtonText(game: GamesTable) {
    if (game.creator === address) {
      if (game.numberOfPlayers === 1) {
        return 'Waiting for players to join your game';
      } else {
        return 'Start game';
      }
    } else return 'Join';
  }

  return (
    <div>
      {loading && (
        <div className="flex flex-col items-center justify-center space-y-2">
          <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-blue-500"></div>
          <div className="text-md">Fetching public games...</div>
        </div>
      )}
      {!loading && (
        <table>
          <thead>
            <tr>
              <th className="text-center">Creator</th>
              <th className="text-center pr-5">Transaction Hash</th>
              <th className="text-center">Number of players</th>
            </tr>
          </thead>
          <tbody>
            {publicGames.map((game, index) => (
              <tr key={index}>
                <td className="text-center pr-5">
                  {trimAddress(game.creator)}
                </td>
                <td className="text-center">{trimAddress(game.txHash)}</td>
                <td className="text-center">{game.numberOfPlayers}</td>
                <td className="text-center">
                  <button
                    className={`${
                      game.numberOfPlayers === 1
                        ? 'bg-gray-500 hover:bg-gray-600'
                        : game.numberOfPlayers > 1
                        ? 'bg-purple-500 hover:bg-purple-600' // Beautiful color for more than 1 player
                        : 'bg-green-500 hover:bg-green-600'
                    } text-white font-bold py-2 px-4 rounded transition duration-300`}
                    onClick={() => {
                      if (game.creator === address) {
                        if (game.numberOfPlayers === 1) {
                          return;
                        } else {
                          console.log('Starting game');
                          setGameStarted(true);
                        }
                      } else {
                        handleJoinGame(game);
                      }
                    }}
                    disabled={
                      game.creator === address && game.numberOfPlayers === 1
                    }
                  >
                    {displayButtonText(game)}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
