import { ReactNode, useEffect, useState } from 'react';
import { PokerGame } from '../temp_types/types.ts';
import BN from 'bn.js';
import { curve } from 'elliptic';
import BasePoint = curve.base.BasePoint;
import { PokerGameContext } from '../context/poker-game-context.tsx';
import { Poker } from '../services/poker.ts';
import { useAppContext } from '../hooks/useAppContext.tsx';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';

export function PokerGameProvider({ children }: { children: ReactNode }) {
  const [pokerService, setPokerService] = useState<Poker | null>(null);
  const [game, setGame] = useState<PokerGame | null>(null);
  const [myEncryptionKeys, setMyEncryptionKeys] = useState<{
    privateKey: BN;
    publicKey: BasePoint;
  } | null>(null);
  const [otherPlayersPublicKey, setOtherPlayersPublicKey] = useState<
    Map<string, BasePoint>
  >(new Map<string, BasePoint>());
  const [gameTransactionHash, setGameTransactionHash] = useState<string | null>(
    null
  );

  const { pushNetwork } = useAppContext();

  useEffect(() => {
    (async function () {
      if (pushNetwork) {
        const poker = await Poker.initialize(ENV.DEV);
        setPokerService(poker);
      }
    })();
  }, [pushNetwork]);

  return (
    <PokerGameContext.Provider
      value={{
        game,
        setGame,
        myEncryptionKeys,
        setMyEncryptionKeys,
        otherPlayersPublicKey,
        setOtherPlayersPublicKey,
        pokerService,
        setPokerService,
        gameTransactionHash,
        setGameTransactionHash,
      }}
    >
      {children}
    </PokerGameContext.Provider>
  );
}
