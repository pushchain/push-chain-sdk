export interface GameType {
  type: 'public' | 'private';
}

export interface GamesTable {
  txHash: string;
  creator: string;
  type: 'public' | 'private';
  players: Set<string>;
}

export interface PushWalletSigner {
  account: string;
  signMessage: (dataToBeSigned: Uint8Array) => Promise<Uint8Array>;
}
