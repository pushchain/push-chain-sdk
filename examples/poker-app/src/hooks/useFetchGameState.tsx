// // useFetchGameState.tsx
// import { useEffect } from 'react';
// import { usePokerGameContext } from './usePokerGameContext';

// export default function useFetchGameState() {
//     const { game, pokerService, gameTransactionHash, setGame } = usePokerGameContext();
  
//     useEffect(() => {
//       if (!pokerService || !gameTransactionHash) return;
  
//       const intervalId = setInterval(async () => {
//         try {
//           const updatedGame = await pokerService.getGameState(gameTransactionHash);
//           if (updatedGame) {
//             // Compare old and new game states
//             const oldStr = JSON.stringify(game);
//             const newStr = JSON.stringify(updatedGame);
//             if (oldStr !== newStr) {
//               console.log("[useFetchGameState]: Updating local game state from chain");
//               setGame(updatedGame);
//             }
//           }
//         } catch (error) {
//           console.error('Error fetching game state:', error);
//         }
//       }, 3000);
  
//       return () => clearInterval(intervalId);
//     }, [pokerService, gameTransactionHash, setGame, game]);
// }

import { useEffect } from 'react';
import { usePokerGameContext } from './usePokerGameContext';

export default function useFetchGameState() {
  const { game, pokerService, gameTransactionHash, setGame } = usePokerGameContext();
  
  useEffect(() => {
    if (!pokerService || !gameTransactionHash) return;

    const fetchState = async () => {
      try {
        const updatedGame = await pokerService.getGameState(gameTransactionHash);
        if (updatedGame) {
          // Deep compare relevant game state properties
          const shouldUpdate = !game || 
            game.phase !== updatedGame.phase ||
            game.turnIndex !== updatedGame.turnIndex ||
            JSON.stringify(game.cards) !== JSON.stringify(updatedGame.cards) ||
            JSON.stringify(game.communityCardsEncrypted) !== JSON.stringify(updatedGame.communityCardsEncrypted) ||
            JSON.stringify(game.playerHoleCards) !== JSON.stringify(updatedGame.playerHoleCards);

          if (shouldUpdate) {
            console.log("[GameState] Updating game state:", {
              oldPhase: game?.phase,
              newPhase: updatedGame.phase,
              oldTurnIndex: game?.turnIndex,
              newTurnIndex: updatedGame.turnIndex
            });
            setGame(updatedGame);
          }
        }
      } catch (error) {
        console.error('[GameState] Error fetching game state:', error);
      }
    };

    const intervalId = setInterval(fetchState, 3000);
    // Immediate first fetch
    fetchState();

    return () => clearInterval(intervalId);
  }, [pokerService, gameTransactionHash, game, setGame]);
}