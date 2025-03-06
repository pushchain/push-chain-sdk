import { UniversalAddress } from '@pushprotocol/pushchain-ui-kit';
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
  FORFEIT = 'forfeit',
}

type PlayerData = {
  universalAddress: UniversalAddress;
  pieceColor: PIECE_COLOR;
};

type GameSessionData = {
  gameId: string;
  player1: PlayerData;
  player2: PlayerData | null;
  status: GAME_STATUS;
  timestamp: string;
};

type GameMove = {
  player: string;
  move: Move;
};

type GameData = {
  gameId: string;
  player1: PlayerData;
  player2: PlayerData | null;
  moves: GameMove[];
  otherPlayerQuit?: boolean;
  result?: {
    universalAddress: UniversalAddress;
    status: GAME_RESULT;
  };
  timestamp: string;
};

export { PIECE_COLOR, GAME_STATUS, GAME_RESULT };
export type { PlayerData, GameSessionData, GameData, GameMove };
