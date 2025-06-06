import { CHAIN_INFO } from './chain';
import * as viem from 'viem';
import { CHAIN } from './enums';

// Define Push Chain networks as viem chains
export const VIEM_PUSH_TESTNET_DONUT = viem.defineChain({
  id: parseInt(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId),
  name: 'Push Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'nPUSH',
    symbol: 'nPUSH',
  },
  rpcUrls: {
    default: {
      http: [CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]],
    },
  },
  blockExplorers: {
    default: {
      name: 'Push Testnet Explorer',
      url: 'https://explorer.dev.push.org/',
    },
  },
});
