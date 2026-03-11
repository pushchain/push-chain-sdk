/**
 * Route Detection and Validation for Multi-Chain Transactions
 *
 * Detects which route a transaction should take based on `from` and `to` parameters:
 * - Route 1 (UOA_TO_PUSH): UOA → Push Chain
 * - Route 2 (UOA_TO_CEA): UOA → CEA on external chain
 * - Route 3 (CEA_TO_PUSH): CEA → Push Chain
 * - Route 4 (CEA_TO_CEA): CEA → CEA (external to external via Push)
 */

import { CHAIN } from '../constants/enums';
import type {
  UniversalExecuteParams,
  ChainTarget,
  TransactionRouteType,
} from './orchestrator.types';
import { isSvmChain, isValidSolanaHexAddress } from './payload-builders';

// ============================================================================
// Transaction Route Enum
// ============================================================================

/**
 * Enum for transaction routes
 */
export enum TransactionRoute {
  /** Route 1: UOA → Push Chain (existing flow) */
  UOA_TO_PUSH = 'UOA_TO_PUSH',
  /** Route 2: UOA → CEA on external chain */
  UOA_TO_CEA = 'UOA_TO_CEA',
  /** Route 3: CEA → Push Chain */
  CEA_TO_PUSH = 'CEA_TO_PUSH',
  /** Route 4: CEA → CEA (external to external via Push) */
  CEA_TO_CEA = 'CEA_TO_CEA',
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when route parameters are invalid
 */
export class RouteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteValidationError';
  }
}

/**
 * Error thrown when a chain is not supported for CEA operations
 */
export class ChainNotSupportedError extends Error {
  constructor(public chain: CHAIN | string) {
    super(`Chain ${chain} is not supported for CEA operations`);
    this.name = 'ChainNotSupportedError';
  }
}

/**
 * Error thrown when transaction type is invalid
 */
export class InvalidTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTransactionError';
  }
}

// ============================================================================
// Chain Helpers
// ============================================================================

/**
 * Push Chain identifiers (all environments)
 */
const PUSH_CHAINS: CHAIN[] = [
  CHAIN.PUSH_MAINNET,
  CHAIN.PUSH_TESTNET,
  CHAIN.PUSH_TESTNET_DONUT,
  CHAIN.PUSH_LOCALNET,
];

/**
 * External chains supported for outbound operations (Route 2).
 * - EVM chains: use CEA (Chain Executor Account)
 * - SVM chains: use gateway program directly (no CEA)
 */
const SUPPORTED_CEA_CHAINS: CHAIN[] = [
  // EVM chains (CEA-based)
  CHAIN.ETHEREUM_MAINNET,
  CHAIN.ETHEREUM_SEPOLIA,
  CHAIN.ARBITRUM_SEPOLIA,
  CHAIN.BASE_SEPOLIA,
  CHAIN.BNB_TESTNET,
  // SVM chains (gateway-based, no CEA)
  CHAIN.SOLANA_MAINNET,
  CHAIN.SOLANA_TESTNET,
  CHAIN.SOLANA_DEVNET,
];

/**
 * Check if a chain is a Push Chain
 */
export function isPushChain(chain: CHAIN): boolean {
  return PUSH_CHAINS.includes(chain);
}

/**
 * Check if a chain is supported for CEA operations
 */
export function isSupportedExternalChain(chain: CHAIN): boolean {
  return SUPPORTED_CEA_CHAINS.includes(chain);
}

/**
 * Check if 'to' parameter is a ChainTarget object
 */
export function isChainTarget(to: unknown): to is ChainTarget {
  return (
    typeof to === 'object' &&
    to !== null &&
    'address' in to &&
    'chain' in to &&
    typeof (to as ChainTarget).address === 'string' &&
    typeof (to as ChainTarget).chain === 'string'
  );
}

// ============================================================================
// Route Detection
// ============================================================================

/**
 * Detect the transaction route based on params
 *
 * Route detection logic:
 * | from.chain | to format     | to.chain    | Route         |
 * |------------|---------------|-------------|---------------|
 * | undefined  | string        | N/A         | UOA_TO_PUSH   |
 * | undefined  | ChainTarget   | external    | UOA_TO_CEA    |
 * | undefined  | ChainTarget   | push        | UOA_TO_PUSH   |
 * | defined    | string        | N/A         | CEA_TO_PUSH   |
 * | defined    | ChainTarget   | push        | CEA_TO_PUSH   |
 * | defined    | ChainTarget   | external    | CEA_TO_CEA    |
 *
 * @param params - Universal execute parameters
 * @returns The detected transaction route
 * @throws RouteValidationError if parameters are invalid
 */
export function detectRoute(
  params: UniversalExecuteParams
): TransactionRoute {
  const hasFromChain = params.from?.chain !== undefined;
  const toIsChainTarget = isChainTarget(params.to);

  // Case 1: No from.chain, to is simple string → Route 1 (UOA → Push)
  if (!hasFromChain && !toIsChainTarget) {
    return TransactionRoute.UOA_TO_PUSH;
  }

  // Case 2: No from.chain, to is ChainTarget
  if (!hasFromChain && toIsChainTarget) {
    const toChain = (params.to as ChainTarget).chain;

    // If targeting Push Chain, it's still Route 1
    if (isPushChain(toChain)) {
      return TransactionRoute.UOA_TO_PUSH;
    }

    // Targeting external chain → Route 2 (UOA → CEA)
    return TransactionRoute.UOA_TO_CEA;
  }

  // Case 3: from.chain present, to is simple string → Route 3 (CEA → Push)
  // When from.chain is specified and to is a string, we assume it's a Push Chain address
  // This is Route 3: CEA sends funds back to Push Chain
  if (hasFromChain && !toIsChainTarget) {
    return TransactionRoute.CEA_TO_PUSH;
  }

  // Case 4: from.chain present, to is ChainTarget
  if (hasFromChain && toIsChainTarget) {
    const toChain = (params.to as ChainTarget).chain;

    // Targeting Push Chain → Route 3 (CEA → Push)
    if (isPushChain(toChain)) {
      return TransactionRoute.CEA_TO_PUSH;
    }

    // Targeting external chain → Route 4 (CEA → CEA)
    return TransactionRoute.CEA_TO_CEA;
  }

  // Should never reach here
  throw new RouteValidationError('Unable to determine transaction route');
}

// ============================================================================
// Route Validation
// ============================================================================

/**
 * Validate route parameters are valid for the detected route
 *
 * @param params - Universal execute parameters
 * @throws RouteValidationError if validation fails
 * @throws ChainNotSupportedError if chain is not supported
 */
export function validateRouteParams(params: UniversalExecuteParams): void {
  const route = detectRoute(params);

  // Validate from.chain is supported external chain (Routes 3, 4)
  if (params.from?.chain) {
    if (!isSupportedExternalChain(params.from.chain)) {
      throw new ChainNotSupportedError(params.from.chain);
    }
  }

  // Validate to.chain is supported (Routes 2, 3, 4)
  if (isChainTarget(params.to)) {
    const toChain = params.to.chain;

    // For Route 2 (UOA → CEA), target must be external chain
    if (route === TransactionRoute.UOA_TO_CEA) {
      if (!isSupportedExternalChain(toChain)) {
        throw new ChainNotSupportedError(toChain);
      }
    }

    // For Route 4 (CEA → CEA), target must be external chain
    if (route === TransactionRoute.CEA_TO_CEA) {
      if (!isSupportedExternalChain(toChain)) {
        throw new ChainNotSupportedError(toChain);
      }
    }
  }

  // Validate migration params
  if (params.migration) {
    if (route !== TransactionRoute.UOA_TO_CEA) {
      throw new RouteValidationError(
        'migration flag is only valid for Route 2 (UOA_TO_CEA)'
      );
    }
    if (params.value && params.value > BigInt(0)) {
      throw new RouteValidationError(
        'migration is incompatible with value'
      );
    }
    if (params.funds) {
      throw new RouteValidationError(
        'migration is incompatible with funds'
      );
    }
    if (params.data) {
      throw new RouteValidationError(
        'migration is incompatible with data'
      );
    }
    if (params.svmExecute) {
      throw new RouteValidationError(
        'migration is incompatible with svmExecute'
      );
    }
    if (isChainTarget(params.to) && isSvmChain(params.to.chain)) {
      throw new RouteValidationError(
        'migration is not supported on SVM chains'
      );
    }
  }

  // Validate address format
  if (isChainTarget(params.to)) {
    if (!params.to.address.startsWith('0x')) {
      throw new RouteValidationError(
        `Invalid address format: ${params.to.address}`
      );
    }
    // SVM targets require 32-byte addresses (0x + 64 hex chars)
    if (isSvmChain(params.to.chain)) {
      if (!isValidSolanaHexAddress(params.to.address)) {
        throw new RouteValidationError(
          `Invalid Solana address format: ${params.to.address}. ` +
            `Expected 32 bytes (0x + 64 hex chars).`
        );
      }
    }
  } else if (typeof params.to === 'string') {
    if (!params.to.startsWith('0x')) {
      throw new RouteValidationError(`Invalid address format: ${params.to}`);
    }
  }
}

/**
 * Get route information for display/logging
 */
export function getRouteInfo(route: TransactionRoute): {
  name: string;
  description: string;
  isOutbound: boolean;
  requiresCEA: boolean;
} {
  switch (route) {
    case TransactionRoute.UOA_TO_PUSH:
      return {
        name: 'UOA → Push',
        description: 'Execute on Push Chain via UEA',
        isOutbound: false,
        requiresCEA: false,
      };
    case TransactionRoute.UOA_TO_CEA:
      return {
        name: 'UOA → CEA',
        description: 'Execute on external chain via CEA',
        isOutbound: true,
        requiresCEA: true,
      };
    case TransactionRoute.CEA_TO_PUSH:
      return {
        name: 'CEA → Push',
        description: 'Bridge from external chain to Push Chain',
        isOutbound: true,
        requiresCEA: true,
      };
    case TransactionRoute.CEA_TO_CEA:
      return {
        name: 'CEA → CEA',
        description: 'Cross-chain via Push (external → Push → external)',
        isOutbound: true,
        requiresCEA: true,
      };
  }
}
