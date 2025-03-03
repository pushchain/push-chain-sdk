import { GameSessionData } from '@/common';
import { PushChain } from '@pushchain/devnet';

export const joinExistingSession = async (
  pushChain: PushChain,
  data: GameSessionData
) => {
  const txn = await pushChain.tx.send([], {
    category: 'CHESS_GAME_SESSION',
    data: JSON.stringify(data),
  });

  console.log(txn);

  const txn2 = await pushChain.tx.send([], {
    category: `CHESS:${data.timestamp}`,
    data: JSON.stringify({
      gameId: data.gameId,
      player1: data.player1,
      player2: data.player2,
      moves: [],
      timestamp: Date.now(),
      winner: null,
    }),
  });

  console.log(txn2);
};
