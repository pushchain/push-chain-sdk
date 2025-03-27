import { GameSessionData } from '@/common';
import { PushChain } from '@pushchain/devnet';

export const createNewSession = async (
  pushChain: PushChain,
  data: GameSessionData
) => {
  const txn = await pushChain.tx.send([], {
    category: 'CHESS_GAME_SESSION',
    data: JSON.stringify(data),
  });
};
