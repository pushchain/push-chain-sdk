import { GameMove } from '@/common';
import { Chess } from 'chess.js';
import { useEffect, useState } from 'react';

const useStockfish = (
  setGame: React.Dispatch<React.SetStateAction<Chess>>,
  setMoves: React.Dispatch<React.SetStateAction<GameMove[]>>
) => {
  const [stockfish, setStockfish] = useState<Worker | null>(null);

  const sendBotMove = (fen: string) => {
    if (!stockfish) return;

    stockfish.postMessage('setoption name Skill Level value 1'); //Low level difficulty
    stockfish.postMessage(`position fen ${fen}`);
    stockfish.postMessage('go depth 1');
  };

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

  return { stockfish, sendBotMove };
};

export { useStockfish };
