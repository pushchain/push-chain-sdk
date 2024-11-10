export interface GameType {
  type: 'public' | 'private';
}

export interface GamesTable {
  txHash: string;
  creator: string;
  type: 'public' | 'private';
  players: Set<string>;
}
