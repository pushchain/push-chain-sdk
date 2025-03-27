import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, Move } from 'chess.js';
import { useAppContext } from '@/context/AppContext';
import quitCurrentSession from '@/services/quitCurrentSession';
import { getGameData } from '@/services/getGameData';
import { GAME_RESULT, GameData, getGameResult, PIECE_COLOR } from '@/common';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import { Piece } from 'react-chessboard/dist/chessboard/types';
import { sendGameMove } from '@/services/sendGameMove';
import { endGameSession } from '@/services/endGameSession';
import { Box } from 'shared-components';
import { GameEndModal } from '@/components/GameEndModal';
import { ChessBoard } from '@/components/ChessBoard';
import { PlayerData } from './components/PlayerData';
import { GameSidebar } from '@/components/GameSidebar';
import { useTimer } from '@/hooks/useTimer';
import { useNavigate } from 'react-router-dom';

const ChessScreen = () => {
  const [game, setGame] = useState(new Chess());
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [playerColor, setPlayerColor] = useState<PIECE_COLOR>(
    PIECE_COLOR.WHITE
  );
  const [status, setStatus] = useState<GAME_RESULT | null>(null);
  const [playerTurn, setPlayerTurn] = useState('');
  const [waitingText, setWaitingText] = useState('Searching for player');
  const [walletSignWaiting, setWalletSignWaiting] = useState(false);

  const listenInterval = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { pushChain, currentSession } = useAppContext();
  const { universalAddress } = usePushWalletContext();
  const navigate = useNavigate();

  const { playerTimer, currentTimeRef, playerTimerRef, startPlayerTimer } =
    useTimer();

  const opponentData = useMemo(() => {
    if (gameData && universalAddress) {
      return (
        (gameData.player1.universalAddress.address === universalAddress.address
          ? gameData.player2
          : gameData.player1) || null
      );
    }
    return null;
  }, [gameData, universalAddress]);

  const handleMove = (source: string, target: string) => {
    const isWhitesTurn = game.turn() === 'w';
    const isCurrentPlayerWhite = playerColor === PIECE_COLOR.WHITE;

    if (
      (isCurrentPlayerWhite && !isWhitesTurn) ||
      (!isCurrentPlayerWhite && isWhitesTurn)
    ) {
      return false;
    }

    let moveToSend: Move | null = null;
    let prevFen: string | null = null;

    setGame((prevGame) => {
      prevFen = prevGame.fen();
      const newGame = new Chess(prevGame.fen());
      try {
        const move = newGame.move({ from: source, to: target, promotion: 'q' });
        if (!move) {
          console.log('Invalid Move');
          return prevGame;
        }
        moveToSend = move;
        return newGame;
      } catch (err) {
        console.log(err);
        return prevGame;
      }
    });

    if (gameData && universalAddress && pushChain && moveToSend) {
      sendGameMove(pushChain, universalAddress, gameData, moveToSend)
        .then(() => {
          if (currentTimeRef.current === 0) {
            if (prevFen) setGame(new Chess(prevFen));
            return;
          }
          startPlayerTimer();
          setPlayerTurn(opponentData?.universalAddress.address || '');
          setGameData((prevData) => {
            if (prevData) {
              return {
                ...prevData,
                moves: [
                  { player: universalAddress.address, move: moveToSend! },
                  ...prevData.moves,
                ],
              };
            }
            return null;
          });
          listenGameMove();
        })
        .catch(() => {
          if (prevFen) setGame(new Chess(prevFen));
        });
    }

    return true;
  };

  const handleDraggablePiece = (piece: Piece) => {
    if (game.isGameOver()) return false;
    const isCurrentPlayerWhite = playerColor === PIECE_COLOR.WHITE;
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
                handleEndGame(GAME_RESULT.WIN);
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
                    if (
                      gameHistory.some(
                        (m) =>
                          m.from === lastMove.move.from &&
                          m.to === lastMove.move.to
                      )
                    ) {
                      return prevGame;
                    }
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
                      setPlayerTurn(universalAddress.address || '');
                      startPlayerTimer();
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
                if (timeoutRef.current) {
                  clearTimeout(timeoutRef.current);
                  timeoutRef.current = null;
                }
              }
            }
          } catch (err) {
            console.log(err);
          }
        };
        listen();
      }, 5000);
    }
  };

  const handleEndGame = async (status: GAME_RESULT) => {
    setWalletSignWaiting(true);
    setWaitingText('Awaiting sign in wallet');
    try {
      if (pushChain && universalAddress && gameData) {
        const data: GameData = {
          ...gameData,
          result: {
            universalAddress: universalAddress,
            status: status === GAME_RESULT.FORFEIT ? GAME_RESULT.LOSE : status,
          },
        };
        if (playerTimerRef.current) clearInterval(playerTimerRef.current);
        await endGameSession(pushChain, data);
        setStatus(status);
        setWalletSignWaiting(false);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleQuitGame = async () => {
    try {
      if (pushChain && !gameData) {
        setWalletSignWaiting(true);
        setWaitingText('Awaiting sign in wallet');
        try {
          await quitCurrentSession(pushChain!, currentSession!);
          setStatus(GAME_RESULT.FORFEIT);
          setWalletSignWaiting(false);
        } catch (err) {
          console.log(err);
        }
      } else if (pushChain && universalAddress && gameData) {
        try {
          await sendGameMove(
            pushChain,
            universalAddress,
            { ...gameData, otherPlayerQuit: true },
            null
          );
          setWalletSignWaiting(false);
        } catch (err) {
          console.log(err);
        }
        await handleEndGame(GAME_RESULT.FORFEIT);
      }
    } catch (err) {
      console.log(err);
    }
  };

  useEffect(() => {
    if (playerTimer === 0) {
      if (playerTurn === universalAddress?.address) {
        handleEndGame(GAME_RESULT.LOSE);
      } else {
        setTimeout(() => {
          if (listenInterval.current) handleEndGame(GAME_RESULT.WIN);
        }, 3000);
      }
    }
  }, [playerTimer]);

  useEffect(() => {
    const result = getGameResult(game, playerColor);
    if (result) {
      setTimeout(() => handleEndGame(result), 2000);
    }
  }, [game]);

  useEffect(() => {
    if (!playerTurn && gameData && universalAddress) {
      if (
        gameData.player1.universalAddress.address === universalAddress.address
      ) {
        setPlayerTurn(
          gameData.player1.pieceColor === PIECE_COLOR.WHITE
            ? universalAddress.address
            : gameData.player2?.universalAddress.address || ''
        );
      } else {
        setPlayerTurn(
          gameData.player2?.pieceColor === PIECE_COLOR.WHITE
            ? universalAddress.address
            : gameData.player1.universalAddress.address
        );
      }
      startPlayerTimer();
    }
  }, [gameData]);

  useEffect(() => {
    if (universalAddress && currentSession) {
      if (
        universalAddress.address ===
        currentSession.player1.universalAddress.address
      ) {
        setPlayerColor(currentSession.player1.pieceColor);
      } else if (currentSession.player2) {
        setPlayerColor(currentSession.player2?.pieceColor);
      }
    }
    listenGameMove();
  }, [currentSession]);

  useEffect(() => {
    setWaitingText('Searching for player');
    timeoutRef.current = setTimeout(() => {
      if (!opponentData) {
        setWaitingText('Player not found.\n Starting a game against a bot');
        setTimeout(() => {
          navigate('/bot');
        }, 3000);
      }
    }, 90 * 1000); // 1.5 minutes

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

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
          {opponentData && (
            <PlayerData
              universalAddress={opponentData?.universalAddress}
              timer={
                gameData
                  ? playerTurn === opponentData.universalAddress.address
                    ? playerTimer
                    : 120
                  : 120
              }
            />
          )}
          {/* ) : (
            <Box
              display="flex"
              alignItems="center"
              height="42px"
              gap="spacing-xxs"
              width="100%"
              maxWidth="615px"
              padding="spacing-none spacing-xs"
              css={css`
                box-sizing: border-box;
              `}
            >
              <Spinner
                size="small"
                variant="secondary"
                css={css`
                  & [role='img'] {
                    color: white;
                  }
                `}
              />
              <Text variant="bs-bold" color="text-primary-inverse">
                Searching for player...
              </Text>
            </Box>
          )} */}

          <ChessBoard
            position={game.fen()}
            onPieceDrop={handleMove}
            boardOrientation={playerColor}
            arePiecesDraggable={!!gameData?.player1 && !!gameData?.player2}
            isDraggablePiece={({ piece }) => {
              return handleDraggablePiece(piece);
            }}
            waiting={!opponentData || walletSignWaiting}
            waitingText={waitingText}
          />
          <PlayerData
            universalAddress={universalAddress}
            timer={
              gameData
                ? playerTurn === universalAddress?.address
                  ? playerTimer
                  : 120
                : 120
            }
          />
        </Box>

        <GameSidebar
          handleQuitGame={handleQuitGame}
          moves={gameData?.moves || []}
        />
      </Box>
      {status && (
        <GameEndModal
          isOpen={!!status}
          gameStatus={status}
          pieceColor={playerColor}
          gameType="multiplayer"
          handleNewGame={() => {
            setGame(new Chess());
            setStatus(null);
            setGameData(null);
            setPlayerTurn('');
            if (listenInterval.current) {
              clearInterval(listenInterval.current);
              listenInterval.current = null;
            }
          }}
        />
      )}
    </>
  );
};

export default ChessScreen;
