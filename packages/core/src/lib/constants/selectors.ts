/**
 * Function selectors and constants for multi-chain transactions
 */

/**
 * MULTICALL_SELECTOR
 * Selector for CEA multicall execution
 * Calculated as: keccak256("multicall((address,uint256,bytes)[])")[:4]
 */
export const MULTICALL_SELECTOR = '0x1749e1e3' as const;

/**
 * UEA_MULTICALL_SELECTOR
 * Selector for UEA multicall execution on Push Chain (existing)
 * Calculated as: keccak256("UEA_MULTICALL")[:4]
 */
export const UEA_MULTICALL_SELECTOR = '0x8f6f1c5e' as const;

/**
 * MIGRATION_SELECTOR
 * Selector for CEA migration execution
 * Calculated as: keccak256("migrateCEA()")[:4]
 */
export const MIGRATION_SELECTOR = '0x0af1c213' as const;

/**
 * TX_TYPE enum values (matches Solidity TX_TYPE enum)
 */
export const TX_TYPE = {
  GAS: 0,
  GAS_AND_PAYLOAD: 1,
  FUNDS: 2,
  FUNDS_AND_PAYLOAD: 3,
} as const;

export type TxType = (typeof TX_TYPE)[keyof typeof TX_TYPE];

/**
 * Zero address constant
 */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/**
 * Default gas limit for outbound transactions
 */
export const DEFAULT_OUTBOUND_GAS_LIMIT = BigInt(200_000);
