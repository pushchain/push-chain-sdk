import { PUSH_NETWORK } from '../constants/enums';
import { unavailable } from './errors';
export const DONUT_MARKETPLACE = Object.freeze({
  sourceCommit: '443b4e2dd9ca5dd9ffc8efebdfcecd619dd66c47',
  version: '2.0.0',
  startBlock: BigInt(24443653),
  marketplace: '0x9071ebE01B75123A91e88eB6ec4BF163F3fE9BF4',
  kernel: '0x977cf1AC973E9eC4332791d531507575006157Ed',
  hook: '0xDe7A94e510b6C571DE7880d441349689F73A32b3',
  rules: '0x5b98A8E0df5b918DF76cD2BE84bA7995B39dfd44',
  evaluator: '0x1afC81396f1bb36F91f74506284952b81e4bd47c',
  paymentToken: '0x7A58048036206bB898008b5bBDA85697DB1e5d66',
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
