import { useState, useEffect } from 'react';
import { Chess } from 'chess.js';
import { Piece } from 'react-chessboard/dist/chessboard/types';
import { endGameSession } from '@/services/endGameSession';
import { useAppContext } from '@/context/AppContext';
import {
  GAME_RESULT,
  GameData,
  GameMove,
  getGameResult,
  PIECE_COLOR,
} from '@/common';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import { Box } from 'shared-components';
import { ChessBoard } from '@/components/ChessBoard';
import { GameEndModal } from '@/components/GameEndModal';
import { GameSidebar } from '@/components/GameSidebar';
import { PlayerData } from './components/PlayerData';
import { useStockfish } from './hooks/useStockfish';

const BotScreen = () => {
  const [game, setGame] = useState(new Chess());
  const [moves, setMoves] = useState<GameMove[]>([]);
  const [status, setStatus] = useState<GAME_RESULT | null>(null);
  const [playerColor, setPlayerColor] = useState<PIECE_COLOR>(
    Math.random() > 0.5 ? PIECE_COLOR.WHITE : PIECE_COLOR.BLACK
  );

  const { pushChain } = useAppContext();
  const { universalAddress } = usePushWalletContext();

  const { stockfish, sendBotMove } = useStockfish(setGame, setMoves);

  const handleDrag = (piece: Piece) => {
    if (game.isGameOver()) return false;
    if (
      (game.turn() === 'b' && piece[0] === 'w') ||
      (game.turn() === 'w' && piece[0] === 'b')
    ) {
      return false;
    }
    return true;
  };

  const handleMove = (source: string, target: string) => {
    if (
      (game.turn() === 'b' && playerColor === PIECE_COLOR.WHITE) ||
      (game.turn() === 'w' && playerColor === PIECE_COLOR.BLACK)
    ) {
      return false;
    }

    setGame((prevGame) => {
      const newGame = new Chess(prevGame.fen());
      try {
        const move = newGame.move({
          from: source,
          to: target,
          promotion: 'q',
        });
        if (!move) {
          console.log('Invalid Move');
          return prevGame;
        }
        sendBotMove(newGame.fen());
        if (universalAddress) {
          setMoves((prevMoves) => {
            return [
              { player: universalAddress.address, move: move },
              ...prevMoves,
            ];
          });
        }
        return newGame;
      } catch (err) {
        console.log(err);
        return prevGame;
      }
    });

    return true;
  };

  const handleEndGame = async (status: GAME_RESULT) => {
    try {
      if (pushChain && universalAddress) {
        const gameData: GameData = {
          gameId: Date.now().toString(),
          player1: {
            universalAddress: universalAddress,
            pieceColor: playerColor,
          },
          player2: null,
          moves: moves,
          timestamp: Date.now().toString(),
          result: {
            universalAddress: universalAddress,
            status: status === GAME_RESULT.FORFEIT ? GAME_RESULT.LOSE : status,
          },
        };
        setStatus(status);
        await endGameSession(pushChain, gameData);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleQuitGame = async () => {
    try {
      handleEndGame(GAME_RESULT.FORFEIT);
    } catch (err) {
      console.log(err);
    }
  };

  useEffect(() => {
    if (stockfish && playerColor === 'black' && !game.history().length) {
      sendBotMove(game.fen());
    }
  }, [stockfish, playerColor, game]);

  useEffect(() => {
    const result = getGameResult(game, playerColor);
    if (result) {
      setTimeout(() => handleEndGame(result), 2000);
    }
  }, [game]);

  return (
    <>
      <Box
        display="flex"
        margin="spacing-xl spacing-none"
        alignItems={{ initial: 'flex-start', lp: 'center' }}
        justifyContent="center"
        gap={{ initial: 'spacing-xl', lp: 'spacing-none' }}
        flexDirection={{ initial: 'unset', lp: 'column' }}
        width="100%"
      >
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          width={{ initial: '615px', tb: '100%' }}
          gap="spacing-xs"
        >
          <ChessBoard
            position={game.fen()}
            onPieceDrop={handleMove}
            boardOrientation={playerColor}
            arePiecesDraggable={true}
            isDraggablePiece={({ piece }) => {
              return handleDrag(piece);
            }}
          />
          <PlayerData universalAddress={universalAddress} />
        </Box>
        <GameSidebar handleQuitGame={handleQuitGame} moves={moves} />
      </Box>
      {status && (
        <GameEndModal
          isOpen={!!status}
          gameStatus={status}
          pieceColor={playerColor}
          gameType="bot"
          handleNewGame={() => {
            setGame(new Chess());
            setMoves([]);
            setStatus(null);
            setPlayerColor(
              Math.random() > 0.5 ? PIECE_COLOR.WHITE : PIECE_COLOR.BLACK
            );
          }}
        />
      )}
    </>
  );
};

export default BotScreen;
