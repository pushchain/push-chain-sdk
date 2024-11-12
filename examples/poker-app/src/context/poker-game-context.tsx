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
  myEncryptionKeys: { privateKey: BN; publicKey: BasePoint } | null;
  setMyEncryptionKeys: React.Dispatch<
    React.SetStateAction<{ privateKey: BN; publicKey: BasePoint } | null>
  >;
  /**
   * Map of other players address to their public key. The current player public key will be
   * store on `myEncryptionKeys`
   */
  otherPlayersPublicKey: Map<string, BasePoint>;
  setOtherPlayersPublicKey: React.Dispatch<
    React.SetStateAction<Map<string, BasePoint>>
  >;
  pokerService: Poker | null;
  setPokerService: React.Dispatch<React.SetStateAction<Poker | null>>;
  gameTransactionHash: string | null;
  setGameTransactionHash: React.Dispatch<React.SetStateAction<string | null>>;
}

export const PokerGameContext = createContext<PokerGameContext | undefined>(
  undefined
);
