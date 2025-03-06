import { FC, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, Move } from 'chess.js';
import { useAppContext } from '@/context/AppContext';
import quitCurrentSession from '@/services/quitCurrentSession';
import { getGameData } from '@/services/getGameData';
import { GAME_RESULT, GameData, PIECE_COLOR, trimAddress } from '@/common';
import {
  UniversalAddress,
  usePushWalletContext,
} from '@pushprotocol/pushchain-ui-kit';
import { Piece } from 'react-chessboard/dist/chessboard/types';
import { sendGameMove } from '@/services/sendGameMove';
import { endGameSession } from '@/services/endGameSession';
import {
  Box,
  Button,
  Cross,
  css,
  Spinner,
  Text,
  Tick,
} from 'shared-components';
import BlockiesSvg from 'blockies-react-svg';
import { ChainIcon } from '@/common/components/ChainIcon';
import { GameEndModal } from '@/components/GameEndModal';
import { ChessBoard } from '@/components/ChessBoard';

const ChessScreen = () => {
  const [game, setGame] = useState(new Chess());
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [playerColor, setPlayerColor] = useState<PIECE_COLOR>(
    PIECE_COLOR.WHITE
  );
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [status, setStatus] = useState<GAME_RESULT | null>(null);

  const { pushChain, currentSession } = useAppContext();
  const { universalAddress } = usePushWalletContext();

  const gameDataRef = useRef(gameData);
  const listenInterval = useRef<NodeJS.Timeout | null>(null);

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

  const handleEndGame = async (status: GAME_RESULT) => {
    try {
      if (pushChain && universalAddress && gameDataRef.current) {
        const data: GameData = {
          ...gameDataRef.current,
          result: {
            universalAddress: universalAddress,
            status: status === GAME_RESULT.FORFEIT ? GAME_RESULT.LOSE : status,
          },
        };
        setStatus(status);
        await endGameSession(pushChain, data);
        window.removeEventListener('beforeunload', handleBeforeUnload);
      }
    } catch (err) {
      console.log(err);
    }
  };

  const handleQuitGame = async () => {
    try {
      if (pushChain && universalAddress && gameDataRef.current) {
        await sendGameMove(
          pushChain,
          universalAddress,
          { ...gameDataRef.current, otherPlayerQuit: true },
          null
        );
        await handleEndGame(GAME_RESULT.LOSE);
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
      handleEndGame(GAME_RESULT.LOSE);
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
      let status: GAME_RESULT = GAME_RESULT.DRAW;

      if (game.isCheckmate()) {
        status =
          game.turn() === playerColor[0] ? GAME_RESULT.LOSE : GAME_RESULT.WIN;
      } else if (
        game.isStalemate() ||
        game.isThreefoldRepetition() ||
        game.isInsufficientMaterial() ||
        game.isDraw()
      ) {
        status = GAME_RESULT.DRAW;
      }
      setTimeout(() => handleEndGame(status), 2000);
    }
  }, [game]);

  useEffect(() => {
    gameDataRef.current = gameData;
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
    if (currentSession && pushChain) {
      window.addEventListener('beforeunload', handleBeforeUnload);

      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      };
    }
  }, [currentSession, pushChain]);

  return (
    <>
      <Box
        display="flex"
        margin="spacing-xl spacing-none spacing-none spacing-none"
        alignItems={{ initial: 'flex-start', lp: 'center' }}
        justifyContent="center"
        gap={{ initial: 'spacing-xl', lp: 'unset' }}
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
          {opponentData ? (
            <PlayerData universalAddress={opponentData?.universalAddress} />
          ) : (
            <Box
              display="flex"
              alignItems="center"
              height="42px"
              gap="spacing-xxs"
              width="100%"
              maxWidth="615px"
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
          )}

          <ChessBoard
            position={game.fen()}
            onPieceDrop={handleMove}
            boardOrientation={playerColor}
            arePiecesDraggable={!!gameData?.player1 && !!gameData?.player2}
            isDraggablePiece={({ piece }) => {
              return handleDraggablePiece(piece);
            }}
          />
          <PlayerData universalAddress={universalAddress} />
        </Box>

        <Box
          display="flex"
          flexDirection={{ initial: 'column', lp: 'column-reverse' }}
          gap="spacing-lg"
          width={{ initial: '260px', lp: '100%' }}
          maxWidth={{ initial: 'unset', lp: '390px' }}
          padding={{
            initial: 'spacing-xxl spacing-none',
            lp: 'spacing-xxl spacing-md',
          }}
          css={css`
            box-sizing: border-box;
          `}
        >
          {confirmQuit ? (
            <Box
              display="flex"
              alignItems="flex-start"
              justifyContent="space-between"
              padding="spacing-xs spacing-md"
              width="100%"
              css={css`
                box-sizing: border-box;
              `}
            >
              <Box cursor="pointer" onClick={handleQuitGame}>
                <Tick size={20} color="icon-tertiary" />
              </Box>
              <Text variant="h6-semibold" color="text-tertiary">
                Are you sure?
              </Text>
              <Box cursor="pointer" onClick={() => setConfirmQuit(false)}>
                <Cross size={20} color="icon-tertiary" />
              </Box>
            </Box>
          ) : (
            <Button onClick={() => setConfirmQuit(true)}>Quit Game</Button>
          )}

          <Box
            padding="spacing-md spacing-xxs"
            backgroundColor="surface-primary-inverse"
            borderRadius="radius-sm"
          >
            <Box
              display="flex"
              flexDirection="column"
              height="260px"
              padding="spacing-none spacing-sm"
              gap="spacing-xs"
              customScrollbar
              css={css`
                overflow-y: scroll;
              `}
            >
              {gameData &&
                gameData.moves.map((move, index) => (
                  <Box
                    display="flex"
                    width="100%"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <Text variant="cs-semibold" color="text-primary-inverse">
                      {index + 1}.
                    </Text>
                    <Text variant="cs-semibold" color="text-primary-inverse">
                      {move.move.from}
                    </Text>
                    <Text variant="cs-semibold" color="text-primary-inverse">
                      {move.move.to}
                    </Text>
                  </Box>
                ))}
            </Box>
          </Box>
        </Box>
      </Box>
      {status && (
        <GameEndModal
          isOpen={!!status}
          gameStatus={status}
          pieceColor={playerColor}
          handleNewGame={() => {
            setGame(new Chess());
            setStatus(null);
            setConfirmQuit(false);
            setGameData(null);
          }}
        />
      )}
    </>
  );
};

const PlayerData: FC<{ universalAddress: UniversalAddress | null }> = ({
  universalAddress,
}) => {
  return (
    <Box
      display="flex"
      alignItems="center"
      height="42px"
      gap="spacing-xxs"
      width="100%"
      maxWidth="615px"
    >
      <Box
        width="32px"
        height="32px"
        borderRadius="radius-round"
        overflow="hidden"
        alignSelf="center"
      >
        <BlockiesSvg address={universalAddress?.address || ''} />
      </Box>
      <Text variant="bs-bold" color="text-primary-inverse">
        {trimAddress(universalAddress?.address || '')}
      </Text>
      <ChainIcon chainId={universalAddress?.chainId || ''} />
    </Box>
  );
};

export default ChessScreen;
