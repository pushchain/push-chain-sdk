import { useEffect, useState } from 'react';
import ConfettiExplosion from 'react-confetti-explosion';
import useFetchPlayersPublicKeys from '../hooks/useFetchPlayersPublicKeys';
import useSubmitPlayerPublicKey from '../hooks/useSubmitPlayerPublicKey';
import useSubmitEncryptedShuffledCards from '../hooks/useSubmitEncryptedShuffledCards';
import useDecryptPlayersCards from '../hooks/useDecryptPlayersCards';
import { usePokerGameContext } from '../hooks/usePokerGameContext';
import useConnectedPushAddress from '../hooks/useConnectedPushAddress';
import PokerTable from './poker-table';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Progress } from './ui/progress';
import { Loader2 } from 'lucide-react';
import { toast } from 'react-toastify';

type DealingPhase = 'WAITING_FOR_PLAYERS' | 'KEY_EXCHANGE' | 'ENCRYPTING' | 'DECRYPTING' | 'READY';

interface GameState {
  dealingPhase: DealingPhase;
  progress: number;
}

export default function Game() {
  const [gameState, setGameState] = useState<GameState>({
    dealingPhase: 'WAITING_FOR_PLAYERS',
    progress: 0
  });

  const { game, otherPlayersPublicKey, pokerService, gameTransactionHash,setGame } = usePokerGameContext();
  const { connectedPushAddressFormat } = useConnectedPushAddress();

  // Initialize hooks
  useSubmitPlayerPublicKey();
  useFetchPlayersPublicKeys();
  const { hasFinishedEncryptingCards } = useSubmitEncryptedShuffledCards();
  console.log("hasFinishedEncryptingCards,Game",hasFinishedEncryptingCards)
  useDecryptPlayersCards({ hasFinishedEncryptingCards });

  // Poll for player updates
  useEffect(() => {
    if (!gameTransactionHash || !pokerService || !game) return;

    const intervalId = setInterval(async () => {
      try {
        const updatedPlayers = await pokerService.getPlayerOrderForTable({
          txHash: gameTransactionHash,
          creator: game.creator,
        });

        if (updatedPlayers) {
          // Clone current game state
          const updatedGame = { ...game };

          // Update players in the cloned game state
          updatedGame.players = new Map(game.players); // Ensure a new map is used
          updatedPlayers.forEach((playerAddress) => {
            if (!updatedGame.players.has(playerAddress)) {
              updatedGame.players.set(playerAddress, {
                chips: 100,
                cards: [],
              });
            }
          });

          // Update the game state using setGame
          setGame(updatedGame);
        }
      } catch (error) {
        console.error('Error updating player list:', error);
      }
    }, 4000);

    return () => clearInterval(intervalId);
  }, [gameTransactionHash, pokerService, game]);

  
  

  // Monitor key exchange progress
  useEffect(() => {
    if (!game || game.players.size < 2) return;
    if(!hasFinishedEncryptingCards){
    const totalPlayers = game.players.size;
    // console.log("totalplayer",totalPlayers)
    const keysCollected = otherPlayersPublicKey.size;
    // console.log("keysCollected",keysCollected)
    
    const keyProgress = Math.min((keysCollected / (totalPlayers - 1)) * 100, 100);
    
    if (keysCollected === totalPlayers) {
      setGameState(prev => ({
        ...prev,
        dealingPhase: 'ENCRYPTING',
        progress: 100
      }));
      toast.success('All players have submitted their keys. Starting encryption...');
    } else {
      setGameState(prev => ({
        ...prev,
        dealingPhase: 'KEY_EXCHANGE',
        progress: keyProgress
      }));
    }}
  }, [game, otherPlayersPublicKey]);

  // Monitor encryption/decryption progress
  useEffect(() => {
    if (hasFinishedEncryptingCards) {
      console.log("!!!!!!!!!!!!!!!!!!!!!!!!1")
      setGameState(prev => ({
        ...prev,
        dealingPhase: 'DECRYPTING'
      }));
      toast.info('Cards encrypted. Starting decryption...');
    }
  }, [hasFinishedEncryptingCards]);

  // Check when cards are fully dealt
  useEffect(() => {
    if (game?.cards?.length > 0) {
      setGameState(prev => ({
        ...prev,
        dealingPhase: 'READY'
      }));
      toast.success('Cards dealt successfully!');
    }
  }, [game?.cards]);

  // Render phase-specific content
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

      case 'DECRYPTING':
        return (
          <Alert className="mb-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertTitle>Revealing Cards</AlertTitle>
            <AlertDescription>
              Decrypting your cards...
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