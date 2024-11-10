import { useContext } from 'react';
import { PokerGameContext } from '../context/poker-game-context.tsx';

export function usePokerGameContext() {
  const context = useContext(PokerGameContext);
  if (context === undefined) {
    throw new Error(
      'usePokerGameContext must be used within an PokerGameProvider'
    );
  }
  return context;
}
