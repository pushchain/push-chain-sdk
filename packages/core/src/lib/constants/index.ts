import { CHAIN, LIBRARY, PUSH_NETWORK } from './enums';
import { TypedDataDomain, TypedData } from '../universal/signer/signer.types';
export type { MoveableToken, PayableToken } from './tokens';

// NOTE - Only include enums & constants which need to be exported to end user.
export const CONSTANTS = {
  PUSH_NETWORK,
  CHAIN,
  LIBRARY,
};

export type { TypedDataDomain, TypedData };
