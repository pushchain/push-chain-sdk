import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useAppContext } from '@/context/AppContext';
import quitCurrentSession from '@/services/quitCurrentSession';
import { getGameData } from '@/services/getGameData';
import { GameData, PIECE_COLOR } from '@/common';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import { Piece } from 'react-chessboard/dist/chessboard/types';
import { sendGameMove } from '@/services/sendGameMove';
import { endGameSession } from '@/services/endGameSession';
import { Button } from 'shared-components';
import { useNavigate } from 'react-router-dom';

const ChessScreen = () => {
  const [game, setGame] = useState(new Chess());
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [currentPieceColor, setCurrentPieceColor] = useState<PIECE_COLOR>(
    PIECE_COLOR.WHITE
  );

  const { pushChain, currentSession } = useAppContext();
  const { universalAddress } = usePushWalletContext();
  const navigate = useNavigate();

  const gameDataRef = useRef(gameData);
  const listenInterval = useRef<NodeJS.Timeout | null>(null);

  const handleMove = (source: string, target: string) => {
    const isWhitesTurn = game.turn() === 'w';
    const isCurrentPlayerWhite = currentPieceColor === PIECE_COLOR.WHITE;

    if (
      (isCurrentPlayerWhite && !isWhitesTurn) ||
      (!isCurrentPlayerWhite && isWhitesTurn)
    ) {
      return false;
    }

    setGame((prevGame) => {
      const newGame = new Chess(prevGame.fen());
      try {
        const move = newGame.move({ from: source, to: target, promotion: 'q' });
        if (!move) {
          console.log('Invalid Move');
          return prevGame;
        }
        if (gameData && universalAddress && pushChain) {
          sendGameMove(pushChain, universalAddress, gameData, move);
          listenGameMove();
          return newGame;
        }
        return prevGame;
      } catch (err) {
        console.log(err);
        return prevGame;
      }
    });

    return false;
  };

  const handleDraggablePiece = (piece: Piece) => {
    if (game.isGameOver()) return false;
    const isCurrentPlayerWhite = currentPieceColor === PIECE_COLOR.WHITE;
    if (
      (isCurrentPlayerWhite && game.turn() === 'w' && piece[0] === 'w') ||
      (!isCurrentPlayerWhite && game.turn() === 'b' && piece[0] === 'b')
    ) {
      return true;
    }
    return false;
  };

  const listenGameMove = () => {
    if (currentSession && pushChain && universalAddress) {
      if (listenInterval.current) {
        clearInterval(listenInterval.current);
        listenInterval.current = null;
      }
      listenInterval.current = setInterval(() => {
        const listen = async () => {
          try {
            const data = await getGameData(pushChain, currentSession.gameId);
            if (data) {
              if (data?.otherPlayerQuit) {
                if (listenInterval.current) {
                  clearInterval(listenInterval.current);
                  listenInterval.current = null;
                }
                handleEndGame('win');
                return;
              } else if (data.moves.length) {
                const lastMove = data.moves[0];
                if (lastMove.player !== universalAddress.address) {
                  setGame((prevGame) => {
                    if (prevGame.isGameOver() && listenInterval.current) {
                      clearInterval(listenInterval.current);
                      return prevGame;
                    }
                    const gameHistory = prevGame.history({ verbose: true });
                    console.log(lastMove.player, universalAddress.address);
                    console.log(lastMove.move, gameHistory);
                    const newGame = new Chess(prevGame.fen());
                    try {
                      const move = newGame.move({
                        from: lastMove.move.from,
                        to: lastMove.move.to,
                        promotion: 'q',
                      });
                      if (!move) {
                        console.log('Invalid Move');
                        return prevGame;
                      }
                      if (listenInterval.current) {
                        clearInterval(listenInterval.current);
                        listenInterval.current = null;
                      }
                      return newGame;
                    } catch (err) {
                      console.log(err);
                      return prevGame;
                    }
                  });
                }
              }
              if (
                !gameData ||
                (gameData && data.moves.length > gameData?.moves.length)
              ) {
                setGameData(data);
              }
            }
          } catch (err) {
            console.log(err);
          }
        };
        listen();
      }, 3000);
    }
  };

  const handleEndGame = async (status: 'win' | 'lose' | 'draw') => {
    try {
      if (pushChain && universalAddress && gameDataRef.current) {
        await endGameSession(
          pushChain,
          gameDataRef.current,
          universalAddress,
          status
        );
        window.removeEventListener('beforeunload', handleBeforeUnload);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleQuitGame = async () => {
    try {
      if (pushChain && universalAddress && gameDataRef.current) {
        handleEndGame('lose');
        sendGameMove(
          pushChain,
          universalAddress,
          { ...gameDataRef.current, otherPlayerQuit: true },
          null
        );
        navigate('/home');
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    if (!gameDataRef.current) {
      quitCurrentSession(pushChain!, currentSession!);
    } else {
      handleEndGame('lose');
      sendGameMove(
        pushChain!,
        universalAddress!,
        { ...gameDataRef.current, otherPlayerQuit: true },
        null
      );
    }
  };

  useEffect(() => {
    if (game.isGameOver()) {
      let status: 'win' | 'lose' | 'draw' = 'draw';

      if (game.isCheckmate()) {
        status = game.turn() === currentPieceColor[0] ? 'lose' : 'win';
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
    gameDataRef.current = gameData;
  }, [gameData]);

  useEffect(() => {
    if (universalAddress && currentSession) {
      if (universalAddress.address === currentSession.player1.address) {
        setCurrentPieceColor(currentSession.player1.pieceColor);
      } else if (currentSession.player2) {
        setCurrentPieceColor(currentSession.player2?.pieceColor);
      }
    }
    listenGameMove();
  }, [currentSession]);

  useEffect(() => {
    if (currentSession && pushChain) {
      window.addEventListener('beforeunload', handleBeforeUnload);

      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      };
    }
  }, [currentSession, pushChain]);

  return (
    <>
      <Chessboard
        boardWidth={700}
        position={game.fen()}
        onPieceDrop={handleMove}
        boardOrientation={currentPieceColor}
        allowDragOutsideBoard={false}
        arePiecesDraggable={!!gameData?.player1 && !!gameData?.player2}
        isDraggablePiece={({ piece }) => {
          return handleDraggablePiece(piece);
        }}
      />
      <Button onClick={handleQuitGame}>Quit Game</Button>
    </>
  );
};

export default ChessScreen;
