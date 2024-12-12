// useFetchGameState.tsx
import { useEffect } from 'react';
import { usePokerGameContext } from './usePokerGameContext';

export default function useFetchGameState() {
    const { game, pokerService, gameTransactionHash, setGame } = usePokerGameContext();
  
    useEffect(() => {
      if (!pokerService || !gameTransactionHash) return;
  
      const intervalId = setInterval(async () => {
        try {
          const updatedGame = await pokerService.getGameState(gameTransactionHash);
          if (updatedGame) {
            // Compare old and new game states
            const oldStr = JSON.stringify(game);
            const newStr = JSON.stringify(updatedGame);
            if (oldStr !== newStr) {
              console.log("[useFetchGameState]: Updating local game state from chain");
              setGame(updatedGame);
            }
          }
        } catch (error) {
          console.error('Error fetching game state:', error);
        }
      }, 3000);
  
      return () => clearInterval(intervalId);
    }, [pokerService, gameTransactionHash, setGame, game]);
}