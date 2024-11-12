// PokerGame.ts

export enum PhaseType {
  PREFLOP = 0,
  FLOP = 1,
  TURN = 2,
  RIVER = 3,
  SHOWDOWN = 4,
}

enum Rank {
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

enum Suit {
  SPADES = 0,
  HEARTS = 1,
  DIAMONDS = 2,
  CLUBS = 3,
}

interface Card {
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

/**
 * This is the Poker State. After every play (bet, check or fold), we update this object.
 */
export interface PokerGame {
  players: Map<string, Player>;
  phases: Map<PhaseType, Phase>;
  cards: Card[];
  pot: number;
  /**
   * At first the dealer is the game creator. After each round, the dealer is changed to the
   * next address on the `players` map key.
   */
  dealer: string;
  creator: string;
}
