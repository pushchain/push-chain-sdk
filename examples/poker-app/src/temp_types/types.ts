// types.ts

export enum PhaseType {
  PREFLOP = 0,
  FLOP = 1,
  TURN = 2,
  RIVER = 3,
  SHOWDOWN = 4,
}

export enum Rank {
  ACE = 0,
  TWO = 1,
  THREE = 2,
  FOUR = 3,
  FIVE = 4,
  SIX = 5,
  SEVEN = 6,
  EIGHT = 7,
  NINE = 8,
  TEN = 9,
  JACK = 10,
  QUEEN = 11,
  KING = 12,
}

export enum Suit {
  SPADES = 0,
  HEARTS = 1,
  DIAMONDS = 2,
  CLUBS = 3,
}

export interface Card {
  rank: Rank;
  suit: Suit;
}

export interface Player {
  chips: number;
  cards: Card[];
}

export interface Phase {
  bets: Map<string, number>;
}

export interface PokerGame {
  players: Map<string, Player>;
  phases: Map<PhaseType, Phase>;
  cards: Card[];
  pot: number;
  dealer: string;
  creator: string;

  /**
   * New fields for dealing and decryption phases:
   */
  phase?: 'WAITING_FOR_PLAYERS' | 'KEY_EXCHANGE' | 'ENCRYPTING' | 'DEALING' | 'DECRYPTING' | 'READY';
  /**
   * playerHoleCards: 
   * Store each player's hole cards as encrypted strings during DEALING/DECRYPTING phases.
   * Once the player decrypts them privately, they update their local state.
   */
  playerHoleCards?: Record<string, string[]>;

  /**
   * communityCardsEncrypted: 
   * Encrypted community cards as strings (BN.toString(10)).
   * Each player in turn removes their layer and publishes the partially decrypted result.
   */
  communityCardsEncrypted?: string[];

  /**
   * turnIndex:
   * Indicates which player's turn it is to partially decrypt the community cards.
   */
  turnIndex?: number;
}
