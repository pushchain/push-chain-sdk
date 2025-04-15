import { UniversalAddress } from '@pushprotocol/pushchain-ui-kit';
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
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
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

export const extractWalletAddress = (address: string) => {
  if (address.includes(':')) {
    const parts = address.split(':');
    return parts[parts.length - 1];
  }
  return address;
};

export const getChainFromCAIP = (caip: string) => {
  const chainId = caip.split(':')[1];
  if (chainId === '1') return 'eth';
  if (chainId === '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') return 'sol';
  return 'push';
};

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

export const convertCaipToObject = (
  addressinCAIP: string
): {
  result: {
    chainId: string | null;
    chain: string | null;
    address: string | null;
  };
} => {
  // Check if the input is a valid non-empty string
  if (!addressinCAIP || typeof addressinCAIP !== 'string') {
    return {
      result: {
        chain: null,
        chainId: null,
        address: null,
      },
    };
  }

  const addressComponent = addressinCAIP.split(':');

  // Handle cases where there are exactly three components (chain, chainId, address)
  if (addressComponent.length === 3) {
    return {
      result: {
        chain: addressComponent[0],
        chainId: addressComponent[1],
        address: addressComponent[2],
      },
    };
  }
  // Handle cases where there are exactly two components (chain, address)
  else if (addressComponent.length === 2) {
    return {
      result: {
        chain: addressComponent[0],
        chainId: null,
        address: addressComponent[1],
      },
    };
  }
  // If the input doesn't match the expected format, return the address only
  else {
    return {
      result: {
        chain: null,
        chainId: null,
        address: addressinCAIP,
      },
    };
  }
};

export const markdownToPlainText = (markdown: string) => {
  return markdown
    .replace(/\*\*(.*?)\*\*/g, '$1') // Bold (**text**)
    .replace(/_(.*?)_/g, '$1') // Italic (_text_)
    .replace(/~~(.*?)~~/g, '$1') // Strikethrough (~~text~~)
    .replace(/>\s(.*?)(\r\n|\r|\n)?/g, '$1') // Blockquote (> text)
    .replace(/\[(.*?)\]\(.*?\)/g, '$1'); // Links ([text](url))
};

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
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': SolanaMonotone, //mainnet
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z': SolanaMonotone, //testnet
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1: SolanaMonotone, //devnet
  devnet: PushMonotone,
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

export const RPC_URL = (!process.env.NODE_ENV || process.env.NODE_ENV === 'development')
  ? 'https://eth-sepolia.g.alchemy.com/v2/skgdTbmOr9TCA8QTNb4y1PFfDW1iPn8y'
  : 'https://sepolia.infura.io/v3/4e4c307950b3459ab22a024f7304156c';
