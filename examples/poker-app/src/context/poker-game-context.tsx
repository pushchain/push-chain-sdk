import React, { createContext } from 'react';
import { PokerGame } from '../temp_types/types.ts';
import { curve } from 'elliptic';
import BasePoint = curve.base.BasePoint;
import BN from 'bn.js';
import { Poker } from '../services/poker.ts';

interface PokerGameContext {
  /**
   * The current game that's being played
   */
  game: PokerGame | null;
  setGame: React.Dispatch<React.SetStateAction<PokerGame | null>>;
  encryptionKeys: { privateKey: BN; publicKey: BasePoint } | null;
  setEncryptionKeys: React.Dispatch<
    React.SetStateAction<{ privateKey: BN; publicKey: BasePoint } | null>
  >;
  playersPublicKey: Map<string, BasePoint>;
  setPlayersPublicKey: React.Dispatch<
    React.SetStateAction<Map<string, BasePoint>>
  >;
  pokerService: Poker | null;
  setPokerService: React.Dispatch<React.SetStateAction<Poker | null>>;
}

export const PokerGameContext = createContext<PokerGameContext | undefined>(
  undefined
);
