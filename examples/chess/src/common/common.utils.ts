import { Chess } from 'chess.js';
import { FC } from 'react';
import {
  IconProps,
  EthereumMonotone,
  PolygonMonotone,
  BnbMonotone,
  ArbitrumMonotone,
  OptimismMonotone,
  SolanaMonotone,
  PushMonotone,
} from 'shared-components';
import { PIECE_COLOR, GAME_RESULT } from './common.types';
import { UniversalAddress } from '@pushprotocol/pushchain-ui-kit';

export function trimAddress(address: string) {
  return `${address.slice(0, 7)}...${address.slice(-7)}`;
}

export const CHAIN_LOGO: {
  [x: number | string]: FC<IconProps>;
} = {
  1: EthereumMonotone,
  11155111: EthereumMonotone,
  137: PolygonMonotone,
  80002: PolygonMonotone,
  97: BnbMonotone,
  56: BnbMonotone,
  42161: ArbitrumMonotone,
  421614: ArbitrumMonotone,
  11155420: OptimismMonotone,
  10: OptimismMonotone,
  2442: PolygonMonotone,
  1101: PolygonMonotone,
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': SolanaMonotone,
  devnet: PushMonotone,
};

export const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${secs}`;
};

export const getGameResult = (
  game: Chess,
  playerColor: PIECE_COLOR
): GAME_RESULT | null => {
  if (!game.isGameOver()) return null;

  if (game.isCheckmate()) {
    return game.turn() === playerColor[0] ? GAME_RESULT.LOSE : GAME_RESULT.WIN;
  }

  if (
    game.isStalemate() ||
    game.isThreefoldRepetition() ||
    game.isInsufficientMaterial() ||
    game.isDraw()
  ) {
    return GAME_RESULT.DRAW;
  }

  return GAME_RESULT.DRAW;
};

export const getFullCaipAddress = (universalAddress: UniversalAddress) => {
  const { chain, chainId, address } = universalAddress;

  if (chain && chainId) {
    return `${chain}:${chainId}:${address}`;
  }
  if (chain) {
    return `${chain}:${address}`;
  }
  return address;
};
