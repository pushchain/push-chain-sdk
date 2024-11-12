import { useEffect } from 'react';
import { usePokerGameContext } from './usePokerGameContext.tsx';

/**
 * Custom hook that will call PUSH Nodes every 2 seconds to fetch all
 * players Public Keys. This is necessary so we can deal the cards
 */
export default function useFetchPlayersPublicKeys() {
  const {
    game,
    otherPlayersPublicKey,
    setOtherPlayersPublicKey,
    pokerService,
    gameTransactionHash,
  } = usePokerGameContext();

  useEffect(() => {
    if (!game || !pokerService || !gameTransactionHash) return;
    const intervalId = setInterval(async () => {
      for (const playerAddress of game.players.keys()) {
        if (![...otherPlayersPublicKey.keys()].includes(playerAddress)) {
          const publicKey = await pokerService.getPlayerPublicKey(
            gameTransactionHash,
            playerAddress
          );
          if (!publicKey) continue;
          setOtherPlayersPublicKey((p) => p.set(playerAddress, publicKey));
        }
      }
    }, 2000);
    return () => clearInterval(intervalId);
  }, [game, pokerService]);
}
