import { defineChain } from 'viem';
import * as viemChains from 'viem/chains';

type ChainType = typeof viemChains & Record<string, unknown>;

export const pushWalletDonut = defineChain({
  id: 42101,
  name: 'Push Testnet Donut',
  nativeCurrency: {
    decimals: 18,
    name: 'PUSH',
    symbol: 'PUSH',
  },
  rpcUrls: {
    default: {
      http: ['https://evm.rpc-testnet-donut-node1.push.org/'],
      webSocket: ['wss://evm.pn1.dev.push.org'],
    },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'https://explorer.testnet.push.org' },
  },
});

export const chains: ChainType = {
  ...viemChains,
  pushWalletDonut,
};
