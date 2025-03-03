import { GAME_STATUS, GameSessionData } from '@/common';
import { PushChain } from '@pushchain/devnet';

const quitCurrentSession = async (
  pushChain: PushChain,
  data: GameSessionData
) => {
  const txn = await pushChain.tx.send([], {
    category: 'CHESS_GAME_SESSION',
    data: JSON.stringify({
      ...data,
      status: GAME_STATUS.CLOSED,
    }),
  });

  console.log(txn);
};

export default quitCurrentSession;
