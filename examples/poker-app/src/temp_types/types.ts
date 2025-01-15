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
  cards: (Card | string)[];  // Allow both encrypted strings and decrypted Card objects
}

export interface Phase {
  bets: Map<string, number>;
  currentPlayer?: string;  // Address of player whose turn it is
  lastRaisePlayer?: string;  // Address of last player who raised
  minimumRaise?: number;  // Minimum amount that can be raised
}

export interface PokerGame {
  players: Map<string, Player>;
  phases: Map<PhaseType, Phase>;
  cards: (Card | string)[];  // Allow both encrypted strings and decrypted Card objects
  pot: number;
  dealer: string;
  creator: string;

  /**
   * Current state of the game
   */
  phase?: 'WAITING_FOR_PLAYERS' | 'KEY_EXCHANGE' | 'ENCRYPTING' | 'DEALING' | 'DECRYPTING' | 'READY' | 'PLAYING';

  /**
   * Store game phase for poker rounds after cards are dealt
   */
  gamePhase?: PhaseType;

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
   * Indicates which player's turn it is to partially decrypt the community cards
   * or to play during the game phase.
   */
  turnIndex?: number;

  /**
   * currentBet:
   * The current bet amount that players need to match
   */
  currentBet?: number;

  /**
   * lastAction:
   * Records the last action taken by a player
   */
  lastAction?: {
    player: string;
    action: PokerAction;
    amount?: number;
  };

  /**
   * activePlayers:
   * Array of players still in the current hand (not folded)
   */
  activePlayers?: string[];
}

// Additional type definitions for game actions
export type PokerAction = 'fold' | 'check' | 'call' | 'raise';

export interface PokerActionPayload {
  action: PokerAction;
  amount?: number;  // Required for 'raise'
  player: string;
}