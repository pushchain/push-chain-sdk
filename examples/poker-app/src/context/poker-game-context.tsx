import React, { createContext } from 'react';
import { PokerGame } from '../temp_types/types.ts';
import { curve } from 'elliptic';
import BasePoint = curve.base.BasePoint;
import BN from 'bn.js';

interface PokerGameContext {
  game: PokerGame | null;
  setGame: React.Dispatch<React.SetStateAction<PokerGame | null>>;
  encryptionKeys: { privateKey: BN; publicKey: BasePoint } | null;
  setEncryptionKeys: React.Dispatch<
    React.SetStateAction<{ privateKey: BN; publicKey: BasePoint } | null>
  >;
}

export const PokerGameContext = createContext<PokerGameContext | undefined>(
  undefined
);
