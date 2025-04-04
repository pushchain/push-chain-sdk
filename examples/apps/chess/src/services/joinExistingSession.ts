import { GameData, GameSessionData } from '@/common';
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

  const newData: GameData = {
    gameId: data.gameId,
    player1: data.player1,
    player2: data.player2,
    moves: [],
    timestamp: Date.now().toString(),
  };

  const txn2 = await pushChain.tx.send([], {
    category: `CHESS:${data.gameId}`,
    data: JSON.stringify(newData),
  });

  console.log(txn2);
};
