import { defineChain } from 'viem';
import * as viemChains from 'viem/chains';

type ChainType = typeof viemChains & Record<string, unknown>;

export const pushWalletDonut = defineChain({
  id: 42101,
  name: 'Push Testnet Donut',
  nativeCurrency: {
    decimals: 18,
    name: 'Push Chain',
    symbol: 'PC',
  },
  rpcUrls: {
    default: {
      http: ['https://evm.donut.rpc.push.org/'],
      webSocket: ['wss://evm.donut.rpc.push.org'],
    },
  },
  blockExplorers: {
    default: { name: 'Push Testnet Explorer', url: 'https://donut.push.network/' },
  },
});

export const chains: ChainType = {
  ...viemChains,
  pushWalletDonut,
};
