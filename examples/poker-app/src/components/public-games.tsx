import { useEffect, useState } from 'react';
import { GamesTable } from '../temp_types/new-types';
import { trimAddress } from '../lib/utils';
import useConnectedPushAddress from '../hooks/useConnectedPushAddress.tsx';
import usePushWalletSigner from '../hooks/usePushSigner.tsx';
import { useAppContext } from '../hooks/useAppContext.tsx';
import { Phase, PhaseType, Player, PokerGame } from '../temp_types/types.ts';
import { usePokerGameContext } from '../hooks/usePokerGameContext.tsx';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { toast } from 'react-toastify';

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
    try {
      if (!connectedPushAddressFormat || !pushWalletSigner || !pokerService) {
        toast.error('Wallet not connected properly');
        return;
      }
  
      setLoadingStartGame(true);
      console.log('Joining game:', game.txHash);
  
      await pokerService.joinGame({
        txHash: game.txHash,
        tos: [game.creator],
        signer: pushWalletSigner,
      });
  
      // Wait for transaction confirmation
      await new Promise(resolve => setTimeout(resolve, 2000));
  
      // Check if join was successful
      const updatedPlayers = await pokerService.getPlayerOrderForTable({
        txHash: game.txHash,
        creator: game.creator,
      });
  
      if (updatedPlayers.has(connectedPushAddressFormat)) {
        toast.success('Successfully joined the game!');
        setGameStarted(true);
        // Initialize game state
        const players = new Map<string, Player>();
        const playersBet: Phase = { bets: new Map<string, number>() };
        updatedPlayers.forEach((playerAddress) => {
          players.set(playerAddress, {
            chips: 100,
            cards: [],
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
          creator: game.creator,
          dealer: game.creator,
        };
  
        setGame(pokerGame);
      } else {
        toast.error('Failed to join the game. Please try again.');
      }
    } catch (error) {
      console.error('Error joining game:', error);
      toast.error('Failed to join the game');
    } finally {
      setLoadingStartGame(false);
    }
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
          chips: 100,
          cards: [],
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
        dealer: connectedPushAddressFormat,
      };

      await pokerService.updateGame(
        game.txHash,
        pokerGame,
        game.players,
        pushWalletSigner
      );
      setGameStarted(true);
      setGame(pokerGame);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingStartGame(false);
    }
  };

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle>Available Public Games</CardTitle>
      </CardHeader>
      <CardContent>
        {loadingFetchingGames ? (
          <div className="flex flex-col items-center justify-center space-y-2">
            <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-blue-500"></div>
            <div className="text-md">Fetching public games...</div>
          </div>
        ) : publicGames.length === 0 ? (
          <p>No public games available. Why not create one?</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {publicGames.map((game) => (
              <Card key={game.txHash} className="bg-gray-700 border-gray-600">
                <CardContent className="p-4">
                  <p className="text-sm mb-2">Creator: {trimAddress(game.creator)}</p>
                  <p className="text-sm mb-2">Players: {game.players.size}</p>
                  <p className="text-xs text-gray-400 mb-4">TX: {trimAddress(game.txHash)}</p>
                  <Button
                    className={`w-full ${
                      game.players.size === 1
                        ? 'bg-gray-500 hover:bg-gray-600'
                        : game.players.size > 1
                        ? 'bg-purple-500 hover:bg-purple-600'
                        : 'bg-green-500 hover:bg-green-600'
                    }`}
                    onClick={() => {
                      if (game.creator === connectedPushAddressFormat) {
                        if (game.players.size === 1) {
                          return;
                        } else {
                          void handleStartAlreadyCreatedGame(game);
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
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

