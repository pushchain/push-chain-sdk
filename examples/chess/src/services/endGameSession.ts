import { GameData } from '@/common';
import { PushChain } from '@pushchain/devnet';

export const endGameSession = async (pushChain: PushChain, data: GameData) => {
  const txn = await pushChain.tx.send([], {
    category: `CHESS_GAME_RESULTS`,
    data: JSON.stringify(data),
  });

  console.log(txn);
};
