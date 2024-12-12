import { useEffect, useState } from 'react';
import ConfettiExplosion from 'react-confetti-explosion';
import useFetchPlayersPublicKeys from '../hooks/useFetchPlayersPublicKeys';
import useSubmitPlayerPublicKey from '../hooks/useSubmitPlayerPublicKey';
import useSubmitEncryptedShuffledCards from '../hooks/useSubmitEncryptedShuffledCards';
import useDecryptPlayersCards from '../hooks/useDecryptPlayersCards';
import useFetchGameState from '../hooks/useFetchGameState';
import { usePokerGameContext } from '../hooks/usePokerGameContext';
import useConnectedPushAddress from '../hooks/useConnectedPushAddress';
import usePushWalletSigner from '../hooks/usePushSigner';
import PokerTable from './poker-table';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Progress } from './ui/progress';
import { Loader2 } from 'lucide-react';
import { toast } from 'react-toastify';
import { PokerGame } from '../temp_types/types';

type DealingPhase = 
  | 'WAITING_FOR_PLAYERS' 
  | 'KEY_EXCHANGE' 
  | 'ENCRYPTING' 
  | 'DEALING' 
  | 'DECRYPTING' 
  | 'READY';

interface GameState {
  dealingPhase: DealingPhase;
  progress: number;
}

export default function Game() {
  const [gameState, setGameState] = useState<GameState>({
    dealingPhase: 'WAITING_FOR_PLAYERS',
    progress: 0,
  });

  const { game, otherPlayersPublicKey, pokerService, gameTransactionHash, setGame } = usePokerGameContext();
  const { connectedPushAddressFormat } = useConnectedPushAddress();
  const { pushWalletSigner } = usePushWalletSigner();

  // Initialize hooks
  useSubmitPlayerPublicKey();
  useFetchPlayersPublicKeys();
  const { hasFinishedEncryptingCards } = useSubmitEncryptedShuffledCards();
  useDecryptPlayersCards({ hasFinishedEncryptingCards });
  useFetchGameState(); // Continuously fetch latest game state

  // Poll for player updates (This updates player info like chips/cards)
  useEffect(() => {
    if (!gameTransactionHash || !pokerService || !game) return;

    const intervalId = setInterval(async () => {
      try {
        const updatedPlayers = await pokerService.getPlayerOrderForTable({
          txHash: gameTransactionHash,
          creator: game.creator,
        });

        if (updatedPlayers) {
          const updatedGame = { ...game };
          updatedGame.players = new Map(game.players);
          updatedPlayers.forEach((playerAddress) => {
            if (!updatedGame.players.has(playerAddress)) {
              updatedGame.players.set(playerAddress, {
                chips: 100,
                cards: [],
              });
            }
          });
          setGame(updatedGame);
        }
      } catch (error) {
        console.error('Error updating player list:', error);
      }
    }, 4000);

    return () => clearInterval(intervalId);
  }, [gameTransactionHash, pokerService, game, setGame]);

  // Monitor key exchange progress
  useEffect(() => {
    if (!game || game.players.size < 2) return;
    if (!hasFinishedEncryptingCards) {
      const totalPlayers = game.players.size;
      const keysCollected = otherPlayersPublicKey.size;
      const keyProgress = Math.min((keysCollected / (totalPlayers - 1)) * 100, 100);

      if (keysCollected === totalPlayers) {
        setGameState(prev => ({
          ...prev,
          dealingPhase: 'ENCRYPTING',
          progress: 100,
        }));
        toast.success('All players have submitted their keys. Starting encryption...');
      } else {
        setGameState(prev => ({
          ...prev,
          dealingPhase: 'KEY_EXCHANGE',
          progress: keyProgress,
        }));
      }
    }
  }, [game, otherPlayersPublicKey, hasFinishedEncryptingCards]);

  // Once encryption is done, deal cards
  useEffect(() => {
    if (!game || !pokerService || !gameTransactionHash) return;
    if (hasFinishedEncryptingCards && gameState.dealingPhase === 'ENCRYPTING') {
      setGameState(prev => ({ ...prev, dealingPhase: 'DEALING' }));
      toast.info('All encryption done. Dealing cards...');

      (async () => {
        const playersArr = Array.from(game.players.keys());
        const dealerIndex = playersArr.indexOf(game.dealer);
        const lastEncrypterIndex = (dealerIndex === 0) ? playersArr.length - 1 : dealerIndex - 1;
        const lastEncrypter = playersArr[lastEncrypterIndex];

        const finalEncryptedDeck = await pokerService.getEncryptedShuffledCards(gameTransactionHash, lastEncrypter);
        if (!finalEncryptedDeck) {
          console.error('Failed to retrieve final encrypted deck');
          return;
        }

        const deckArray = Array.from(finalEncryptedDeck);
        const playerCount = game.players.size;
        const holeCardsPerPlayer = 2;
        const totalHoleCards = holeCardsPerPlayer * playerCount;
        const communityCardCount = 5;

        const playerHoleCards: Record<string, string[]> = {};
        const playerAddresses = Array.from(game.players.keys());
        for (let i = 0; i < playerCount; i++) {
          const holeSegment = deckArray.slice(i*2, i*2+2);
          playerHoleCards[playerAddresses[i]] = holeSegment.map(cardBN => cardBN.toString(10));
        }

        const communityCardsEncrypted = deckArray.slice(totalHoleCards, totalHoleCards + communityCardCount).map(c => c.toString(10));

        const updatedGame: PokerGame = {
          ...game,
          phase: 'DECRYPTING',
          playerHoleCards,
          communityCardsEncrypted,
          turnIndex: 0 // first player in array to decrypt
        };

        await pokerService.updateGame(
          gameTransactionHash,
          updatedGame,
          new Set(playerAddresses),
          pushWalletSigner!
        );

        setGame(updatedGame);
        setGameState(prev => ({ ...prev, dealingPhase: 'DECRYPTING' }));
        toast.info('Cards dealt. Starting partial decryption...');
      })();
    }
  }, [hasFinishedEncryptingCards, gameState.dealingPhase, game, pokerService, gameTransactionHash, setGame]);

  // Move to READY once final cards are revealed
  useEffect(() => {
    if (game?.cards?.length > 0 && game.phase === 'READY') {
      setGameState(prev => ({ ...prev, dealingPhase: 'READY' }));
      toast.success('Cards dealt and revealed!');
    }
  }, [game?.cards, game?.phase]);

  const renderPhaseContent = () => {
    if (!game) return null;

    switch (gameState.dealingPhase) {
      case 'WAITING_FOR_PLAYERS':
        return (
          <Alert className="mb-4">
            <AlertTitle>Waiting for Players</AlertTitle>
            <AlertDescription>
              Need {Math.max(0, 3 - game.players.size)} more players to start...
              <Progress value={gameState.progress} className="mt-2" />
            </AlertDescription>
          </Alert>
        );
      case 'KEY_EXCHANGE':
        return (
          <Alert className="mb-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertTitle>Exchanging Keys</AlertTitle>
            <AlertDescription>
              Waiting for all players to submit their keys...
              <Progress value={gameState.progress} className="mt-2" />
            </AlertDescription>
          </Alert>
        );
      case 'ENCRYPTING':
        return (
          <Alert className="mb-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertTitle>Dealing Cards</AlertTitle>
            <AlertDescription>
              {game.dealer === connectedPushAddressFormat 
                ? 'Shuffling and encrypting the deck...'
                : 'Waiting for dealer to encrypt cards...'}
            </AlertDescription>
          </Alert>
        );
      case 'DEALING':
        return (
          <Alert className="mb-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertTitle>Dealing Cards</AlertTitle>
            <AlertDescription>
              Distributing hole cards and community cards...
            </AlertDescription>
          </Alert>
        );
      case 'DECRYPTING':
        return (
          <Alert className="mb-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertTitle>Revealing Cards</AlertTitle>
            <AlertDescription>
              Players are partially decrypting community cards...
            </AlertDescription>
          </Alert>
        );
      case 'READY':
        return (
          <ConfettiExplosion
            force={0.8}
            duration={3000}
            particleCount={100}
            width={1600}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* Phase feedback */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 w-96">
        {renderPhaseContent()}
      </div>

      {/* Poker table */}
      <PokerTable 
        dealingPhase={gameState.dealingPhase}
        isDealer={game?.dealer === connectedPushAddressFormat}
      />
    </div>
  );
}
