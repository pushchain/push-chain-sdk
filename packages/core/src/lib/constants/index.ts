import { CHAIN, LIBRARY, PUSH_NETWORK } from './enums';
import { TypedDataDomain, TypedData } from '../universal/signer/signer.types';
import {
  MOVEABLE_TOKEN_CONSTANTS,
  PAYABLE_TOKEN_CONSTANTS,
} from './tokens';
import { UNIVERSAL_CALLBACK_ADDRESSES, UNIVERSAL_CORE_ADDRESSES } from './chain';
import {
  CALLBACK_BUDGET_BUFFER,
  DEFAULT_EXPIRY_BLOCKS,
  MAX_CALLBACK_GAS_LIMIT,
  MIN_CONFIRMATIONS_FLOOR,
  READ_NAMESPACE,
  WEB2_DEFAULT_TIMEOUT_MS,
  WEB2_MAX_EXTRACT_ENTRIES,
} from './read-state';
import { UNIVERSAL_READ_STATUS, READ_STATUS, READ_ERROR_CODE } from '../read-state/read-state.types';

/** `PushChain.CONSTANTS.READ` — cross-chain read state. Values verified against the deployed UniversalCallback. */
export const READ_CONSTANTS = {
  /** Read-only Web2 destination. Equivalent to `CHAIN.WEB2`. */
  WEB2: CHAIN.WEB2,
  NAMESPACE: READ_NAMESPACE,
  MAX_CALLBACK_GAS_LIMIT,
  MIN_CONFIRMATIONS_FLOOR,
  DEFAULT_EXPIRY_BLOCKS,
  CALLBACK_BUDGET_BUFFER,
  WEB2_MAX_EXTRACT_ENTRIES,
  WEB2_DEFAULT_TIMEOUT_MS,
  UNIVERSAL_CORE_ADDRESSES,
  UNIVERSAL_CALLBACK_ADDRESSES,
  STATUS: UNIVERSAL_READ_STATUS,
  RESULT_STATUS: READ_STATUS,
  ERROR_CODE: READ_ERROR_CODE,
} as const;
export type {
  MoveableToken,
  PayableToken,
  PushChainMoveableToken,
  ChainSuffixAccessor,
  UsdcChainSuffixAccessor,
  PushChainMoveableTokenAccessor,
  MoveableTokenConstantsMap,
  PayableTokenConstantsMap,
} from './tokens';

// NOTE - Only include enums & constants which need to be exported to end user.
export const CONSTANTS = {
  PUSH_NETWORK,
  CHAIN,
  LIBRARY,
  MOVEABLE: { TOKEN: MOVEABLE_TOKEN_CONSTANTS },
  PAYABLE: { TOKEN: PAYABLE_TOKEN_CONSTANTS },
  READ: READ_CONSTANTS,
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
  MIGRATION_SELECTOR,
  TX_TYPE,
  ZERO_ADDRESS,
  DEFAULT_OUTBOUND_GAS_LIMIT,
  DEFAULT_CEA_TO_PUSH_GAS_LIMIT,
} from './selectors';

// Read state (cross-chain reads)
export { UNIVERSAL_CORE_ADDRESSES, UNIVERSAL_CALLBACK_ADDRESSES } from './chain';
export * from './read-state';
