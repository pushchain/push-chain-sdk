import { Move } from 'chess.js';

enum PIECE_COLOR {
  WHITE = 'white',
  BLACK = 'black',
}

enum GAME_STATUS {
  WAITING = 'waiting',
  CLOSED = 'closed',
}

enum GAME_RESULT {
  WIN = 'win',
  LOSE = 'lose',
  DRAW = 'draw',
}

type PlayerData = {
  address: string;
  pieceColor: PIECE_COLOR;
};

type GameSessionData = {
  gameId: string;
  player1: PlayerData;
  player2: PlayerData | null;
  status: GAME_STATUS;
  timestamp: string;
};

type GameData = {
  gameId: string;
  player1: PlayerData;
  player2: PlayerData | null;
  moves: {
    player: string;
    move: Move;
  }[];
  otherPlayerQuit?: boolean;
  timestamp: string;
};

export { PIECE_COLOR, GAME_STATUS, GAME_RESULT };
export type { PlayerData, GameSessionData, GameData };
