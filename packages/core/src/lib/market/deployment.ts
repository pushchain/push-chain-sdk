import { PUSH_NETWORK } from '../constants/enums';
import { unavailable } from './errors';
export const DONUT_MARKETPLACE = Object.freeze({
  sourceCommit: '5aad0392510b7b4dce807f7edba39054c8f95fc4',
  version: '2.1.0',
  startBlock: BigInt(24803669),
  marketplace: '0x940744d96b14Bc030163C6084d602d57CE42ba48',
  kernel: '0x449C11cAFe57d8d9079058FeEef8e9E7E1DCBcE0',
  hook: '0xbee0B01773Dc742887f04bED58BD1B5Aa457ED96',
  rules: '0x323FDBF1EC07e56a19225d836566155C93463CcD',
  evaluator: '0x2a73944D79E052bAF553F59fA1c7C23f3491845c',
  paymentToken: '0x8E1eD40770cd197c80048cB3a86D3c8173cd560D',
} as const);
export type MarketDeployment = Omit<
  typeof DONUT_MARKETPLACE,
  'marketplace' | 'kernel' | 'hook' | 'rules' | 'evaluator' | 'paymentToken'
> &
  Record<
    'marketplace' | 'kernel' | 'hook' | 'rules' | 'evaluator' | 'paymentToken',
    `0x${string}`
  >;
export function marketplaceDeployment(network: PUSH_NETWORK): MarketDeployment {
  if (network !== PUSH_NETWORK.TESTNET_DONUT)
    unavailable('Marketplace on this Push network');
  return DONUT_MARKETPLACE;
}
