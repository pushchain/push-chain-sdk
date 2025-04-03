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
        Number(latestGameSessions[gameId].timestamp) < Number(data.timestamp)
      ) {
        latestGameSessions[gameId] = data;
      }
    }
  });

  const now = Date.now();

  const waitingGames = Object.values(latestGameSessions).filter((data) => {
    const isWithin90Secs = now - Number(data.timestamp) <= 85 * 1000;
    return data.status === 'waiting' && isWithin90Secs;
  });

  return waitingGames.length ? waitingGames[0] : null;
};
