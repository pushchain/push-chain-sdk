import { ReactNode, useState } from 'react';
import { PokerGame } from '../temp_types/types.ts';
import BN from 'bn.js';
import { curve } from 'elliptic';
import BasePoint = curve.base.BasePoint;
import { PokerGameContext } from '../context/poker-game-context.tsx';

export function PokerGameProvider({ children }: { children: ReactNode }) {
  const [game, setGame] = useState<PokerGame | null>(null);
  const [encryptionKeys, setEncryptionKeys] = useState<{
    privateKey: BN;
    publicKey: BasePoint;
  } | null>(null);

  return (
    <PokerGameContext.Provider
      value={{
        game,
        setGame,
        encryptionKeys,
        setEncryptionKeys,
      }}
    >
      {children}
    </PokerGameContext.Provider>
  );
}
