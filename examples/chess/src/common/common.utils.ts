import { SubscriptionFilter } from '@pushchain/devnet/src/lib/websocket/websocket-client';
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

export function trimAddress(address: string) {
  return `${address.slice(0, 7)}...${address.slice(-7)}`;
}

export function formatTimestamp(
  timestamp: string,
  showAgo: boolean = false
): string {
  const date = new Date(parseInt(timestamp, 10));
  const now = new Date();

  if (isNaN(date.getTime())) {
    return 'Invalid Date';
  }

  const timeDiff = now.getTime() - date.getTime();
  const seconds = Math.floor(timeDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  let agoText = '';
  if (showAgo) {
    if (seconds < 60) {
      agoText = `(${seconds} seconds ago)`;
    } else if (minutes < 60) {
      agoText = `(${minutes} minutes ago)`;
    } else if (hours < 24) {
      agoText = `(${hours} hours ago)`;
    } else if (days < 30) {
      agoText = `(${days} days ago)`;
    } else if (months < 12) {
      agoText = `(${months} months ago)`;
    } else {
      agoText = `(${years} years ago)`;
    }
  }

  if (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  ) {
    return (
      date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }) + (showAgo ? ` ${agoText}` : '')
    );
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  ) {
    return 'Yesterday' + (showAgo ? ` ${agoText}` : '');
  }

  if (date.getFullYear() === now.getFullYear()) {
    return (
      date.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
      }) + (showAgo ? ` ${agoText}` : '')
    );
  }

  return (
    date.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    }) + (showAgo ? ` ${agoText}` : '')
  );
}

export const getInCAIP = (address: string, chain: string) => {
  return `${
    chain === 'eth'
      ? 'eip155:1'
      : chain === 'sol'
      ? 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
      : chain === 'bnb'
      ? 'eip155:56'
      : 'push:devnet'
  }:${address}`;
};

export const customSessionFilters: SubscriptionFilter[] = [
  { type: 'CATEGORY', value: ['CHESS_GAME_SESSION'] },
];

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
