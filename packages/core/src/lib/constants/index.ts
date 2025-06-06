import { CHAIN, LIBRARY, PUSH_NETWORK } from './enums';
import { VIEM_PUSH_TESTNET_DONUT } from './viem-push-testnet';
import { TypedDataDomain, TypedData } from '../universal/signer/signer.types';

// NOTE - Only include enums & constants which need to be exported to end user.
export const CONSTANTS = {
  PUSH_NETWORK,
  CHAIN,
  VIEM_PUSH_TESTNET_DONUT,
  LIBRARY,
};

export type { TypedDataDomain, TypedData };
