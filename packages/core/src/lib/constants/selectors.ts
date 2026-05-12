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
 * Selector for UEA/CEA multicall execution
 * Calculated as: bytes4(keccak256("UEA_MULTICALL")) = 0x2cc2842d
 * Must match MULTICALL_SELECTOR in Types.sol of push-chain-core-contracts
 */
export const UEA_MULTICALL_SELECTOR = '0x2cc2842d' as const;

/**
 * MIGRATION_SELECTOR
 * Selector for CEA migration execution
 * Calculated as: bytes4(keccak256("UEA_MIGRATION"))
 * Must match MIGRATION_SELECTOR in Types.sol of push-chain-core-contracts
 */
export const MIGRATION_SELECTOR = '0xcac656d6' as const;

/**
 * TX_TYPE enum values (matches Solidity TX_TYPE enum)
 */
export const TX_TYPE = {
  GAS: 0,
  GAS_AND_PAYLOAD: 1,
  FUNDS: 2,
  FUNDS_AND_PAYLOAD: 3,
  RESCUE_FUNDS: 4,
} as const;

export type TxType = (typeof TX_TYPE)[keyof typeof TX_TYPE];

/**
 * Zero address constant
 */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/**
 * Default gas limit for outbound transactions
 */
export const DEFAULT_OUTBOUND_GAS_LIMIT = BigInt(500_000);

/**
 * Default gas limit for EVM Route 3 (CEA -> Push) source-chain execution.
 *
 * This path can deploy the CEA and then execute sendUniversalTxToUEA with a
 * nested Push payload. Live Sepolia traces estimate ~540k gas for that shape,
 * so the generic 500k outbound default is too tight.
 */
export const DEFAULT_CEA_TO_PUSH_GAS_LIMIT = BigInt(750_000);
