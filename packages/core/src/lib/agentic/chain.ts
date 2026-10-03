import { CHAIN_INFO } from '../constants/chain';
import { CHAIN, PUSH_NETWORK } from '../constants/enums';

/** 'eip155:<id>' of the Push chain for a network — the native rule chain. */
export function pushChainNamespaceFor(network: PUSH_NETWORK): string {
  const chain =
    network === PUSH_NETWORK.MAINNET
      ? CHAIN.PUSH_MAINNET
      : network === PUSH_NETWORK.TESTNET_DONUT || network === PUSH_NETWORK.TESTNET
        ? CHAIN.PUSH_TESTNET_DONUT
        : CHAIN.PUSH_LOCALNET;
  return `eip155:${CHAIN_INFO[chain].chainId}`;
}
