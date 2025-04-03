import { GAME_STATUS, GameSessionData } from '@/common';
import { PushChain } from '@pushchain/devnet';

const quitCurrentSession = async (
  pushChain: PushChain,
  data: GameSessionData
) => {
  const newData: GameSessionData = {
    ...data,
    status: GAME_STATUS.CLOSED,
  };

  const txn = await pushChain.tx.send([], {
    category: 'CHESS_GAME_SESSION',
    data: JSON.stringify(newData),
  });

  console.log(txn);
};

export default quitCurrentSession;
