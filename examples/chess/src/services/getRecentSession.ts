import { GameSessionData } from '@/common';
import { PushChain } from '@pushchain/devnet';

export const getRecentSession = async (pushChain: PushChain) => {
  const txn = await pushChain.tx.get('*', {
    category: 'CHESS_GAME_SESSION',
    limit: 10,
  });

  if (!txn.blocks.length) {
    return null;
  }

  const latestGameSessions: Record<string, GameSessionData> = {};

  txn.blocks[0]?.transactions.forEach((tx) => {
    const data: GameSessionData = JSON.parse(tx.data);
    const gameId = data.gameId;
    if (gameId) {
      if (
        !latestGameSessions[gameId] ||
        new Date(latestGameSessions[gameId].timestamp) <
          new Date(data.timestamp)
      ) {
        latestGameSessions[gameId] = data;
      }
    }
  });

  const waitingGames = Object.values(latestGameSessions).filter(
    (data) => data.status === 'waiting'
  );

  return waitingGames.length ? waitingGames[0] : null;
};
