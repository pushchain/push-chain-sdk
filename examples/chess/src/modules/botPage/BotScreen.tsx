import { useState, useEffect, useRef } from 'react';
import { Chess, Move } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { Piece } from 'react-chessboard/dist/chessboard/types';
import { endGameSession } from '@/services/endGameSession';
import { useAppContext } from '@/context/AppContext';
import { GameData, PIECE_COLOR } from '@/common';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import { Button } from 'shared-components';
import { useNavigate } from 'react-router-dom';

const playerColor: PIECE_COLOR =
  Math.random() > 0.5 ? PIECE_COLOR.WHITE : PIECE_COLOR.BLACK;

const BotScreen = () => {
  const [game, setGame] = useState(new Chess());
  const [stockfish, setStockfish] = useState<Worker | null>(null);
  const [moves, setMoves] = useState<
    {
      player: string;
      move: Move;
    }[]
  >([]);
  const { pushChain } = useAppContext();
  const { universalAddress } = usePushWalletContext();
  const navigate = useNavigate();

  const movesRef = useRef(moves);

  useEffect(() => {
    const stockfishWorker = new Worker('/stockfish-17-asm.js');
    setStockfish(stockfishWorker);

    const handleStockfishMessage = (e: MessageEvent) => {
      if (e.data.startsWith('bestmove')) {
        const bestMove = e.data.split(' ')[1];

        setGame((prevGame) => {
          if (prevGame.isGameOver()) return prevGame;

          const newGame = new Chess(prevGame.fen());
          try {
            const move = newGame.move({
              from: bestMove.slice(0, 2),
              to: bestMove.slice(2, 4),
              promotion: 'q',
            });

            if (!move) {
              console.log('Invalid Move');
              return prevGame;
            }
            sendBotMove(newGame.fen());
            setMoves((prevMoves) => {
              return [{ player: 'bot', move: move }, ...prevMoves];
            });
            return newGame;
          } catch (err) {
            console.log(err);
            return prevGame;
          }
        });
      }
    };

    stockfishWorker.addEventListener('message', handleStockfishMessage);

    return () => {
      stockfishWorker.removeEventListener('message', handleStockfishMessage);
      stockfishWorker.terminate();
    };
  }, []);

  const sendBotMove = (fen: string) => {
    if (!stockfish) return;
    console.log('📢 Sending FEN to Stockfish:', fen);
    stockfish.postMessage(`position fen ${fen}`);
    stockfish.postMessage('go depth 15');
  };

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

  const handleEndGame = async (status: 'win' | 'lose' | 'draw') => {
    try {
      if (pushChain && universalAddress) {
        const gameData: GameData = {
          gameId: Date.now().toString(),
          player1: {
            address: universalAddress.address,
            pieceColor: playerColor,
          },
          player2: null,
          moves: movesRef.current,
          timestamp: Date.now().toString(),
        };
        await endGameSession(pushChain, gameData, universalAddress, status);
        window.removeEventListener('beforeunload', handleBeforeUnload);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleQuitGame = async () => {
    try {
      handleEndGame('lose');
      navigate('/home');
    } catch (err) {
      console.log(err);
    }
  };

  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    if (movesRef.current.length) {
      handleEndGame('lose');
    }
  };

  useEffect(() => {
    if (game.isGameOver()) {
      let status: 'win' | 'lose' | 'draw' = 'draw';

      if (game.isCheckmate()) {
        status = game.turn() === playerColor[0] ? 'lose' : 'win';
      } else if (
        game.isStalemate() ||
        game.isThreefoldRepetition() ||
        game.isInsufficientMaterial() ||
        game.isDraw()
      ) {
        status = 'draw';
      }
      handleEndGame(status);
    }
  }, [game]);

  useEffect(() => {
    if (stockfish && playerColor === 'black') {
      sendBotMove(game.fen());
    }
  }, [stockfish, playerColor]);

  useEffect(() => {
    movesRef.current = moves;
  }, [moves]);

  //   useEffect(() => {
  //     if (universalAddress && pushChain) {
  //       window.addEventListener('beforeunload', handleBeforeUnload);

  //       return () => {
  //         window.removeEventListener('beforeunload', handleBeforeUnload);
  //       };
  //     }
  //   }, [universalAddress, pushChain]);

  return (
    <>
      <Chessboard
        boardWidth={700}
        position={game.fen()}
        onPieceDrop={handleMove}
        boardOrientation={playerColor}
        allowDragOutsideBoard={false}
        arePiecesDraggable={true}
        isDraggablePiece={({ piece }) => {
          return handleDrag(piece);
        }}
      />
      <Button onClick={handleQuitGame}>Quit Game</Button>
    </>
  );
};

export default BotScreen;
