import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { encodePacked, keccak256, namehash } from 'viem';
import type { Address } from 'viem';
import { mainnet } from 'viem/chains';
import { subDays, format } from 'date-fns';
import { Alchemy, Network } from 'alchemy-sdk';
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Convert an chainId to a coinType hex for reverse chain resolution
 */
export const convertChainIdToCoinType = (chainId: number): string => {
  // L1 resolvers to addr
  if (chainId === mainnet.id) {
    return 'addr';
  }

  const cointype = (0x80000000 | chainId) >>> 0;
  return cointype.toString(16).toLocaleUpperCase();
};

/**
 * Convert an address to a reverse node for ENS resolution
 */
export const convertReverseNodeToBytes = (
  address: Address,
  chainId: number
) => {
  const addressFormatted = address?.toLocaleLowerCase() as Address;

  const addressNode = keccak256(addressFormatted.substring(2) as Address);
  const chainCoinType = convertChainIdToCoinType(chainId);
  const baseReverseNode = namehash(
    `${chainCoinType.toLocaleUpperCase()}.reverse`
  );
  const addressReverseNode = keccak256(
    encodePacked(['bytes32', 'bytes32'], [baseReverseNode, addressNode])
  );
  return addressReverseNode;
};

export const trimAddress = (address: string, length = 4) => {
  return `${address.slice(0, length)}...${address.slice(-length)}`;
};

export const generateMockData = (days: number) => {
  const data = [];
  const endDate = new Date();
  for (let i = days; i >= 0; i--) {
    const date = subDays(endDate, i);
    data.push({
      date: format(date, 'MMM dd'),
      value: Math.floor(Math.random() * (20000 - 15000) + 15000),
    });
  }
  return data;
};

export const timeRanges = {
  '7d': generateMockData(7),
  '1m': generateMockData(30),
};

const config = {
  apiKey: import.meta.env.VITE_ALCHEMY_API_KEY,
  network: Network.BASE_MAINNET,
};
export const alchemy = new Alchemy(config);

export type TimeRange = keyof typeof timeRanges;
