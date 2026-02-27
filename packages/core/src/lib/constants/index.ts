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

// Multi-chain configuration exports
export {
  CHAIN_EXPLORERS,
  CEA_FACTORY_ADDRESSES,
  UNIVERSAL_GATEWAY_ADDRESSES,
  VAULT_ADDRESSES,
  getExplorerTxUrl,
  getExplorerAddressUrl,
} from './chain';

// Selectors and constants for multi-chain transactions
export {
  MULTICALL_SELECTOR,
  UEA_MULTICALL_SELECTOR,
  TX_TYPE,
  ZERO_ADDRESS,
  DEFAULT_OUTBOUND_GAS_LIMIT,
} from './selectors';
