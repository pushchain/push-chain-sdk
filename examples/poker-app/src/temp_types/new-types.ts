export interface CreateGame {
  type: 'public' | 'private';
}

export interface GamesTable {
  txHash: string;
  creator: string;
  type: 'public' | 'private';
  numberOfPlayers: number;
}
