import { CHAIN_INFO } from './chain';
import * as viem from 'viem';

// Define Push Chain networks as viem chains
export const VIEM_PUSH_TESTNET_DONUT = viem.defineChain({
  id: parseInt(CHAIN_INFO.PUSH_TESTNET_DONUT.chainId),
  name: 'Push Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'nPUSH',
    symbol: 'nPUSH',
  },
  rpcUrls: {
    default: {
      http: [CHAIN_INFO.PUSH_TESTNET_DONUT.defaultRPC],
    },
  },
  blockExplorers: {
    default: {
      name: 'Push Testnet Explorer',
      url: 'https://explorer.dev.push.org/',
    },
  },
});
