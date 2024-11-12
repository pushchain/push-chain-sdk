import { useEffect, useState } from 'react';
import { GamesTable } from '../temp_types/new-types';
import { trimAddress } from '../lib/utils';
import useConnectedPushAddress from '../hooks/useConnectedPushAddress.tsx';
import usePushWalletSigner from '../hooks/usePushSigner.tsx';
import { useAppContext } from '../hooks/useAppContext.tsx';
import { Phase, PhaseType, Player, PokerGame } from '../temp_types/types.ts';
import { usePokerGameContext } from '../hooks/usePokerGameContext.tsx';

export default function PublicGames() {
  const [publicGames, setPublicGames] = useState<GamesTable[]>([]);
  const [loadingFetchingGames, setLoadingFetchingGames] = useState(true);
  const [loadingStartGame, setLoadingStartGame] = useState(false);
  const { setGameStarted } = useAppContext();
  const { setGame, pokerService } = usePokerGameContext();
  const { connectedPushAddressFormat } = useConnectedPushAddress();
  const { pushWalletSigner } = usePushWalletSigner();

  useEffect(() => {
    const fetchGames = async () => {
      try {
        setLoadingFetchingGames(true);
        if (!pokerService) return;
        const games = await pokerService.get({ type: 'public' });
        const gamesToShow: GamesTable[] = [];
        for (const game of games) {
          // if (game.creator === address) continue; // Skip the user's own wallet
          const isGameStarted = await pokerService.checkIfGameStarted({
            txHash: game.txHash,
            creator: game.creator,
          });
          if (!isGameStarted) {
            gamesToShow.push(game);
          }
        }
        for (const game of gamesToShow) {
          game.players = await pokerService.getPlayerOrderForTable({
            txHash: game.txHash,
            creator: game.creator,
          });
        }
        setPublicGames(gamesToShow);
      } catch (error) {
        console.error(error);
      } finally {
        setLoadingFetchingGames(false);
      }
    };
    void fetchGames();
  }, [pokerService]);

  const handleJoinGame = async (game: GamesTable) => {
    if (!connectedPushAddressFormat || !pushWalletSigner || !pokerService)
      return;

    await pokerService.joinGame({
      txHash: game.txHash,
      tos: [game.creator],
      signer: pushWalletSigner,
    });
  };

  function displayButtonText(game: GamesTable) {
    if (game.creator === connectedPushAddressFormat) {
      if (game.players.size === 1) {
        return 'Waiting for players to join your game';
      } else {
        return loadingStartGame ? 'Starting Game...' : 'Start game';
      }
    } else return 'Join';
  }

  /**
   * We will START a game. The game has already been previously created.
   * The group creator will first CREATE a game then will wait for others to join the table.
   * Once enough participants are there, the group creator can then START the game.
   * @param game
   */
  const handleStartAlreadyCreatedGame = async (game: GamesTable) => {
    try {
      if (!connectedPushAddressFormat || !pushWalletSigner || !pokerService)
        return;
      setLoadingStartGame(true);
      const players = new Map<string, Player>();
      const playersBet: Phase = { bets: new Map<string, number>() };
      game.players.forEach((playerAddress) => {
        players.set(playerAddress, {
          chips: 100, // Every player starts with 100 chips
          cards: [], // Cards will be dealt after game started
        });
        playersBet.bets.set(playerAddress, 0);
      });

      const phases = new Map<PhaseType, Phase>([
        [PhaseType.PREFLOP, playersBet],
      ]);

      const pokerGame: PokerGame = {
        players,
        phases,
        cards: [],
        pot: 0,
        creator: connectedPushAddressFormat,
        dealer: connectedPushAddressFormat, // Dealer at first is the group creator
      };

      await pokerService.updateGame(
        game.txHash,
        pokerGame,
        game.players,
        pushWalletSigner
      );
      setGameStarted(true);
      setGame(pokerGame);
      setGameStarted(true);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingStartGame(false);
    }
  };

  return (
    <div>
      {loadingFetchingGames && (
        <div className="flex flex-col items-center justify-center space-y-2">
          <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-blue-500"></div>
          <div className="text-md">Fetching public games...</div>
        </div>
      )}
      {!loadingFetchingGames && (
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
                <td className="text-center">{game.players.size}</td>
                <td className="text-center">
                  <button
                    className={`${
                      game.players.size === 1
                        ? 'bg-gray-500 hover:bg-gray-600'
                        : game.players.size > 1
                        ? 'bg-purple-500 hover:bg-purple-600' // Beautiful color for more than 1 player
                        : 'bg-green-500 hover:bg-green-600'
                    } text-white font-bold py-2 px-4 rounded transition duration-300`}
                    onClick={() => {
                      if (game.creator === connectedPushAddressFormat) {
                        if (game.players.size === 1) {
                          return;
                        } else {
                          void handleStartAlreadyCreatedGame(game); // Can only create game if table owner and at least 2 people on the table (creator + 1 person)
                        }
                      } else {
                        void handleJoinGame(game);
                      }
                    }}
                    disabled={
                      game.creator === connectedPushAddressFormat &&
                      game.players.size === 1
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
