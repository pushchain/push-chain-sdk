import { GameData } from '@/common';
import { PushChain } from '@pushchain/devnet';
import { UniversalAddress } from '@pushprotocol/pushchain-ui-kit';
import { Move } from 'chess.js';

export const sendGameMove = async (
  pushChain: PushChain,
  universalAddress: UniversalAddress,
  data: GameData,
  move: Move | null
) => {
  const newData: GameData = {
    ...data,
    moves: move
      ? [
          {
            player: universalAddress.address,
            move: move,
          },
          ...data.moves,
        ]
      : data.moves,
  };

  const txn = await pushChain.tx.send([], {
    category: `CHESS:${data.gameId}`,
    data: JSON.stringify(newData),
  });

  console.log(txn);
};
