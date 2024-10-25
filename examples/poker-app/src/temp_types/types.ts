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
  address: string;
  chips: number;
  cards: Card[];
  isDealer: boolean;
}

export interface Phase {
  type: PhaseType;
  bets: Record<string, number>;
}

export interface PokerGame {
  players: Player[];
  phases: Phase[];
  cards: Card[];
  pot: number;
  creator: string;
}
