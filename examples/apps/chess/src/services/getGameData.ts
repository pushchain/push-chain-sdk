import { GameData } from '@/common';
import { PushChain } from '@pushchain/devnet';

export const getGameData = async (pushChain: PushChain, gameId: string) => {
  const txn = await pushChain.tx.get('*', {
    category: `CHESS:${gameId}`,
    limit: 1,
  });

  if (!txn.blocks.length) {
    return null;
  }

  return txn.blocks[0].transactions[0]
    ? (JSON.parse(txn.blocks[0].transactions[0].data) as GameData)
    : null;
};
