/**
 * Read-state (cross-chain read) constants.
 *
 * Contract-derived values are pinned to the deployed `UniversalCallback`
 * (push-chain-core-contracts@feat-read-state, f8d1a0c) and verified by
 * `read-state/__tests__/abi-selectors.spec.ts`.
 */

/** Hard upper bound on the gas an app callback may declare — `ReadTypes.sol:50`. */
export const MAX_CALLBACK_GAS_LIMIT = 1_000_000n;

/** Contract rejects anything below this — `ReadTypes.sol:43`. */
export const MIN_CONFIRMATIONS_FLOOR = 1;

/** Default lifetime of a request in Push blocks (~1.3 s each on Donut). */
export const DEFAULT_EXPIRY_BLOCKS = 300n;

/**
 * Multiple of `callbackGasLimit × pushGasPrice` escrowed as the callback budget.
 * The node refuses to fulfil a read whose budget cannot cover its callback, so
 * this errs high; the unspent remainder is refunded to `refundTo`.
 */
export const CALLBACK_BUDGET_BUFFER = 3;

/** `universalClient/externalchains/web2/read_envelope.go` — maxExtractEntries. */
export const WEB2_MAX_EXTRACT_ENTRIES = 16;

export const WEB2_DEFAULT_TIMEOUT_MS = 5_000;

/** Validators clamp anything above this. */
export const WEB2_MAX_TIMEOUT_MS = 15_000;

/**
 * Web2 is not a blockchain and is not a `CHAIN` enum member. Reads target it via
 * an explicit destination; the node routes on namespace `web2`, id `https`.
 */
export const WEB2_DESTINATION = {
  chainNamespace: 'web2',
  chainId: 'https',
} as const;

/** CAIP-2 namespaces the read path understands, keyed by how the node routes them. */
export const READ_NAMESPACE = {
  EVM: 'eip155',
  SVM: 'solana',
  WEB2: 'web2',
} as const;

export type ReadNamespace = (typeof READ_NAMESPACE)[keyof typeof READ_NAMESPACE];
