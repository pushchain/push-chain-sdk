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
  const { game, setGame, pokerService, gameTransactionHash } = usePokerGameContext();

  useEffect(() => {
    if (!pokerService || !gameTransactionHash) return;

    const fetchGameState = async () => {
      try {
        const latestGameState = await pokerService.getGameState(gameTransactionHash);
        
        if (!latestGameState || !game) return;

        // Don't overwrite if we're transitioning from READY to PLAYING
        if (game.phase === 'PLAYING' && latestGameState.phase === 'READY') {
          return;
        }

        // Preserve certain game state properties during updates
        const updatedGame = {
          ...latestGameState,
          // Preserve local game properties that shouldn't be overwritten
          activePlayers: game.activePlayers || latestGameState.activePlayers,
          currentBet: game.currentBet ?? latestGameState.currentBet,
          pot: game.pot ?? latestGameState.pot,
          gamePhase: game.gamePhase || latestGameState.gamePhase,
        };

        setGame(updatedGame);
      } catch (error) {
        console.error('[FetchGameState] Error:', error);
      }
    };

    const intervalId = setInterval(fetchGameState, 3000);
    return () => clearInterval(intervalId);
  }, [pokerService, gameTransactionHash, game, setGame]);
}