import { useState, useEffect, useRef } from 'react';
import { Chess, Move } from 'chess.js';
import { Piece } from 'react-chessboard/dist/chessboard/types';
import { endGameSession } from '@/services/endGameSession';
import { useAppContext } from '@/context/AppContext';
import { GAME_RESULT, GameData, PIECE_COLOR, trimAddress } from '@/common';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import { Box, Button, Cross, css, Text, Tick } from 'shared-components';
import { ChessBoard } from '@/components/ChessBoard';
import BlockiesSvg from 'blockies-react-svg';
import { ChainIcon } from '@/common/components/ChainIcon';
import { GameEndModal } from '@/components/GameEndModal';

const BotScreen = () => {
  const [game, setGame] = useState(new Chess());
  const [stockfish, setStockfish] = useState<Worker | null>(null);
  const [moves, setMoves] = useState<
    {
      player: string;
      move: Move;
    }[]
  >([]);
  const [status, setStatus] = useState<GAME_RESULT | null>(null);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [playerColor, setPlayerColor] = useState<PIECE_COLOR>(
    Math.random() > 0.5 ? PIECE_COLOR.WHITE : PIECE_COLOR.BLACK
  );

  const { pushChain } = useAppContext();
  const { universalAddress } = usePushWalletContext();

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

    stockfish.postMessage('setoption name Skill Level value 10'); //Mid level difficulty
    stockfish.postMessage(`position fen ${fen}`);
    stockfish.postMessage('go depth 10');
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
          moves: movesRef.current,
          timestamp: Date.now().toString(),
          result: {
            universalAddress: universalAddress,
            status: status === GAME_RESULT.FORFEIT ? GAME_RESULT.LOSE : status,
          },
        };
        setStatus(status);
        await endGameSession(pushChain, gameData);
        window.removeEventListener('beforeunload', handleBeforeUnload);
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

  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    if (movesRef.current.length) {
      handleEndGame(GAME_RESULT.LOSE);
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
    if (stockfish && playerColor === 'black' && !game.history().length) {
      sendBotMove(game.fen());
    }
  }, [stockfish, playerColor, game]);

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
          <ChessBoard
            position={game.fen()}
            onPieceDrop={handleMove}
            boardOrientation={playerColor}
            arePiecesDraggable={true}
            isDraggablePiece={({ piece }) => {
              return handleDrag(piece);
            }}
          />
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
              {moves.map((move, index) => (
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
            setMoves([]);
            setStatus(null);
            setConfirmQuit(false);
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
