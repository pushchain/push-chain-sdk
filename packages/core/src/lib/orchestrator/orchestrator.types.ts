import type { CHAIN } from '../constants/enums';

// ============================================================================
// Multi-Chain Transaction Types
// ============================================================================

/**
 * Chain target for cross-chain routing (Routes 2, 3, 4)
 * When `to` is a ChainTarget, the transaction executes on the specified external chain.
 *
 * `address` is typed as `string` because the accepted shape varies by VM:
 *   - EVM chains expect a 0x-prefixed 20-byte hex address.
 *   - SVM chains (Solana) accept either a base58 32-byte pubkey OR a 0x-prefixed
 *     32-byte hex address; the SDK normalizes base58 to hex internally.
 * Runtime validation happens in the route detector.
 */
export type ChainTarget = {
  address: string;
  chain: CHAIN;
};

/**
 * Source chain for CEA-originated transactions (Routes 3, 4)
 * Specifies which CEA domain submits the transaction
 * NOTE: This does NOT represent where the user signed from
 */
export type ChainSource = {
  chain: CHAIN;
};

/**
 * Union type for 'to' parameter - backwards compatible
 * - string: Route 1 (UOA → Push)
 * - ChainTarget: Routes 2, 3, 4 (cross-chain)
 */
export type UniversalTo = `0x${string}` | ChainTarget;

/**
 * Transaction route identifiers
 */
export type TransactionRouteType =
  | 'UOA_TO_PUSH'
  | 'UOA_TO_CEA'
  | 'CEA_TO_PUSH'
  | 'CEA_TO_CEA';

// ============================================================================
// Execute Parameters
// ============================================================================

export type ExecuteParams = {
  /**
   * The target contract or account on Push Chain.
   */
  to: `0x${string}`;

  /**
   * Amount of native token (in wei) to send alongside the call.
   */
  value?: bigint;

  /**
   * Hex-encoded calldata or transfer payload.
   * @reason Encodes the function selector + arguments (or plain transfer).
   */
  data?: `0x${string}` | MultiCall[];

  /**
   * Optional hard cap on gas to use for this transaction.
   * @reason Prevents runaway gas consumption and lets users enforce limits.
   */
  gasLimit?: bigint;

  /**
   * Optional override for the EIP-1559 max fee per gas (in wei).
   * @reason Gives callers direct control over total gas price to speed up or save cost.
   */
  maxFeePerGas?: bigint;

  /**
   * Optional override for the EIP-1559 max priority fee per gas (in wei).
   * TODO: This will be removed
   * @reason Allows customizing the miner tip separately from the base fee.
   */
  maxPriorityFeePerGas?: bigint;

  /**
   * Optional to bypass fee locking in case funds are already locked by user
   */
  feeLockTxHash?: string;

  /**
   * Optional explicit nonce for the transaction.
   * @reason Ensures correct ordering and avoids “replacement underpriced” when sending in parallel.
   */
  nonce?: bigint;

  /**
   * Optional for signature expiry
   */
  deadline?: bigint;

  /**
   * Optional: pay gas in a specific token. If not provided, use `token` (bridge token) when present; otherwise, native token.
   */
  payGasWith?: {
    token?: import('../constants').PayableToken; // e.g., client.payable.token.USDT
    slippageBps?: number; // e.g., 100 = 1%
    minAmountOut?: bigint | string; // optional min ETH out (wei)
  };

  /**
   * Optional funds movement from origin chain to Push Chain (FUNDS_TX).
   * When present and no calldata is provided, the SDK will bridge the specified
   * ERC‑20 token amount to Push Chain using the Universal Gateway.
   *
   * Notes:
   * - Currently supported only on Ethereum Sepolia
   * - pay-with-token gas abstraction is NOT supported yet
   */
  funds?: {
    amount: bigint; // smallest units of the token
    token?: import('../constants').MoveableToken; // if omitted, defaults to native token for origin chain
  };

  /**
   * Internal: Pre-fetched UEA status to avoid redundant RPC calls.
   * Used by executeUoaToCea() to pass UEA state to execute().
   * @internal
   */
  _ueaStatus?: {
    isDeployed: boolean;
    nonce: bigint;
    balance: bigint;
  };

  /**
   * Internal: Skip fee locking for outbound flows (UEA→CEA).
   * Outbound txs execute entirely on Push Chain and don't need
   * external-chain fee locking.
   * @internal
   */
  _skipFeeLocking?: boolean;

  /**
   * Internal: Minimum fee-locking deposit in USD (8 decimals).
   * Overrides the default $1 floor when the caller needs a larger deposit
   * (e.g., Route 2 needs enough UPC for the outbound swap).
   * Still capped at $1000 by lockFee.
   * @internal
   */
  _minimumDepositUsd?: bigint;
};

/**
 * New Universal Transaction Receipt interface with prioritized field ordering
 */
export interface UniversalTxResponse {
  // 1. Identity
  hash: string; // tx hash
  origin: string; // origin, e.g. "eip155:1:0xabc"

  // 2. Block Info
  blockNumber: bigint; // 803963n
  blockHash: string; // block hash
  transactionIndex: number; // index in block
  chainId: string; // 42101 or solana

  // 3. Execution Context
  from: string; // UEA (executor) address
  to: string; // the "to" the UEA executed
  nonce: number; // derived (UEA) nonce

  // 4. Payload
  data: string; // perceived calldata (was input)
  value: bigint; // perceived value

  // 5. Gas
  gasLimit: bigint; // 21000n (was gas)
  gasPrice?: bigint; // for legacy txs
  maxFeePerGas?: bigint; // for EIP-1559
  maxPriorityFeePerGas?: bigint;
  accessList: any[]; // AccessList type

  // 6. Utilities
  /**
   * Wait for this transaction to reach its final state.
   *
   * For outbound routes (R2 / R3) the resolved receipt also includes external
   * chain details. Pass `options.outboundTimeoutMs` / `options.inboundTimeoutMs`
   * to override the default polling timeouts on a per-call basis — useful for
   * latency-sensitive UIs that want to surface a provisional timeout and retry
   * with a longer budget.
   *
   * When the outbound or inbound leg times out / fails, `.wait()` still
   * resolves with a receipt (no throw); inspect `externalStatus` to classify
   * the outcome.
   */
  wait: (options?: WaitOptions) => Promise<UniversalTxReceipt>;

  /**
   * Register a progress callback for events during wait().
   * Call this BEFORE calling wait() to receive tracking events, including
   * the route-specific external/inbound polling events: R2 emits the 209/299
   * series, R3 emits 309/310/399. Registering after wait() resolves will
   * replay the pre-execution event buffer but miss outbound polling events.
   * @param callback - Function called with each progress event
   */
  progressHook: (
    callback: (
      event: import('../progress-hook/progress-hook.types').ProgressEvent
    ) => void
  ) => void;

  /**
   * @internal Register a wait-phase progressHook without replaying buffered
   * events. Used by `trackTransaction()` to auto-attach the caller's per-call
   * progressHook so `tracked.wait()` can deliver wait-phase events (209-xx /
   * 299-xx / 399-xx) to the same callback — without re-emitting the
   * reconstructed execute-phase stream that trackTransaction already fired.
   */
  _setProgressHookNoReplay?: (
    callback: (
      event: import('../progress-hook/progress-hook.types').ProgressEvent
    ) => void
  ) => void;

  // 7. Metadata
  type: string; // "99" (was typeHex), now string
  typeVerbose: string; // "universal" (was type), human readable
  signature: Signature; // ethers Signature instance

  // 8. Raw Universal Fields (if you ever need them)
  raw?: {
    from: string; // what went on chain
    to: string; // what went on chain
    nonce: number; // the actual raw nonce
    data: string; // the actual raw data (was input)
    value: bigint; // the actual derived value
  };

  // 9. Multi-Chain Context (NEW)
  /** Target chain where transaction was executed */
  chain?: CHAIN;
  /** CAIP-2 chain namespace, e.g., "eip155:11155111" */
  chainNamespace?: string;

  // 10. Multi-Hop Tracking (NEW - for chained transactions)
  /** Position in chain sequence (0-indexed) */
  hopIndex?: number;
  /** Previous transaction hash in chain */
  parentTxHash?: string;
  /** Next transaction hash in chain */
  childTxHash?: string;

  // 11. Transaction Route
  /** Transaction route (UOA_TO_PUSH, UOA_TO_CEA, CEA_TO_PUSH, CEA_TO_CEA) */
  route?: TransactionRouteType;

  // 12. Internal flags
  /**
   * @internal True when this response was produced by `trackTransaction` and
   * its progress events have already been replayed via the registered hook.
   * `wait()` checks this to skip a redundant inner trackTransaction call that
   * would otherwise emit the same reconstructed events a second time when
   * the user does `tracked = trackTransaction(...); tracked.wait()`.
   */
  _eventsReconstructed?: boolean;
  /**
   * @internal True when the R3 (CEA_TO_PUSH) execution produces a child UTX
   * on Push Chain — i.e., the source-chain CEA payload actually calls
   * `sendUniversalTxToUEA` (funds flowing back to UEA). When false, `.wait()`
   * skips `waitForInboundPushTx` to avoid a 300s timeout on payload-only R3
   * flows that have no inbound leg.
   */
  _expectsInboundRoundTrip?: boolean;
}

/**
 * New Universal Transaction Receipt interface for transaction receipts
 */
/**
 * Per-call options accepted by `UniversalTxResponse.wait()`.
 *
 * All fields are optional; omitted values fall back to the orchestrator's
 * defaults (`OUTBOUND_MAX_TIMEOUT_MS`, `INBOUND_MAX_TIMEOUT_MS`).
 */
export interface WaitOptions {
  /**
   * Override the outbound polling budget (ms) — applies to R2 / R3 while
   * waiting for the external-chain tx to land via UGPC relay. When exceeded,
   * `wait()` resolves with `externalStatus: 'timeout'` and the progress-hook
   * stream emits `SEND-TX-299-03` (R2) or `SEND-TX-399-03` (R3 inbound).
   *
   * The outbound-sync initial settle-wait is automatically clamped to this
   * timeout, so a 200ms budget will throw in ~200ms rather than blocking for
   * the default 20s.
   */
  outboundTimeoutMs?: number;
  /**
   * Override the inbound polling budget (ms) — applies to R3 only, for the
   * round-trip Push tx produced by the external CEA. When exceeded,
   * `wait()` resolves with `externalStatus: 'timeout'` and emits
   * `SEND-TX-399-03`.
   */
  inboundTimeoutMs?: number;
  /**
   * Override the poll interval (ms) between outbound status checks. Default
   * is 5000ms. Lower values give faster feedback on fast relays; higher
   * values reduce RPC pressure. Only applies to R2 / R3 outbound polling.
   */
  outboundPollingIntervalMs?: number;
  /**
   * Override the initial settle-wait (ms) before the outbound polling loop
   * starts. Default is 20000ms — a buffer for UGPC relay submission latency.
   * Reducing this doesn't affect the timeout budget but may cause earlier
   * polls that miss the relay submission and burn RPC. Rarely needed; prefer
   * `outboundTimeoutMs` which auto-clamps the initial wait.
   */
  outboundInitialWaitMs?: number;
}

export interface UniversalTxReceipt {
  // 1. Identity
  hash: string; // changed from transactionHash

  // 2. Block Info
  blockNumber: bigint;
  blockHash: string;
  transactionIndex: number;

  // 3. Execution Context
  from: string; // should be the executor account of push chain
  to: string; // should be the actual intended address of the tx
  contractAddress: string | null;

  // 4. Gas & Usage
  gasPrice: bigint; // gasPrice should be gasPrice
  gasUsed: bigint; // was cumulativeGasUsed
  cumulativeGasUsed: bigint; // was gasUsed

  // 5. Logs
  logs: any[]; // Log[] type
  logsBloom: string;

  // 6. Outcome
  status: 0 | 1; // 1 is success, 0 is failure - modeled after ethers

  // 7. Raw
  raw: {
    from: string; // what happened on chain
    to: string; // what happened on chain
  };

  // 8. Multi-Chain Context (NEW)
  /** Target chain where transaction was executed */
  chain?: CHAIN;
  /** CAIP-2 chain namespace, e.g., "eip155:11155111" */
  chainNamespace?: string;

  // 9. External Chain Details (populated for outbound routes)
  /** Transaction hash on external chain (outbound only) */
  externalTxHash?: string;
  /** External chain where tx executed */
  externalChain?: CHAIN;
  /** Explorer URL for external tx */
  externalExplorerUrl?: string;
  /** Recipient on external chain */
  externalRecipient?: string;
  /** Amount transferred to external chain */
  externalAmount?: string;
  /** Asset address on external chain */
  externalAssetAddr?: string;
  /**
   * Outcome of the external-chain leg for outbound routes (R2 / R3).
   * - `success`: external tx landed and was confirmed (299-01 fired).
   * - `failed`: external tx reverted or UGPC reported terminal failure (299-02 fired).
   * - `timeout`: UGPC relay timed out before an external tx was observed (299-03 fired).
   * Undefined on non-outbound receipts.
   */
  externalStatus?: 'success' | 'failed' | 'timeout';
  /** Error message from the external-chain leg when `externalStatus !== 'success'`. */
  externalError?: string;

  // 10. Inbound Push Tx (populated for R3 round-trips)
  /** Push Chain tx hash that closed the R3 round-trip (inbound from CEA). */
  pushInboundTxHash?: string;
  /** Child UTX id that owns the inbound execution. */
  pushInboundUtxId?: string;
}

/**
 * Signature interface modeled after ethers.js v6 Signature interface
 */
export interface Signature {
  r: string;
  s: string;
  v: number;
  yParity?: number;
}

/**
 * Call shape for multicall payloads
 */
export type MultiCall = {
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
};

export interface UniversalTxRequest {
  recipient: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  payload: `0x${string}`;
  revertInstruction: {
    fundRecipient: `0x${string}`;
    revertMsg: `0x${string}`;
  };
  signatureData: `0x${string}`;
}

/** V1 gateway request — uses a plain `revertRecipient` address instead of a struct. */
export interface UniversalTxRequestV1 {
  recipient: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  payload: `0x${string}`;
  revertRecipient: `0x${string}`;
  signatureData: `0x${string}`;
}

export interface UniversalTokenTxRequest {
  recipient: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  gasToken: `0x${string}`;
  gasAmount: bigint;
  payload: `0x${string}`;
  revertInstruction: {
    fundRecipient: `0x${string}`;
    revertMsg: `0x${string}`;
  };
  signatureData: `0x${string}`;
  amountOutMinETH: bigint;
  deadline: bigint;
}

/** V1 gateway token request — uses a plain `revertRecipient` address instead of a struct. */
export interface UniversalTokenTxRequestV1 {
  recipient: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  gasToken: `0x${string}`;
  gasAmount: bigint;
  payload: `0x${string}`;
  revertRecipient: `0x${string}`;
  signatureData: `0x${string}`;
  amountOutMinETH: bigint;
  deadline: bigint;
}

/**
 * Options for tracking a transaction by hash
 */
// ============================================================================
// Universal Execute Parameters (Multi-Chain Support)
// ============================================================================

/**
 * Extended ExecuteParams for multi-chain transactions
 * Supports all 4 routes:
 * - Route 1: UOA → Push (to is string)
 * - Route 2: UOA → CEA (to is ChainTarget, no from)
 * - Route 3: CEA → Push (from.chain present, to.chain is Push)
 * - Route 4: CEA → CEA (from.chain present, to.chain is external)
 */
export type UniversalExecuteParams = Omit<ExecuteParams, 'to'> & {
  /**
   * Source chain for CEA-originated transactions (Routes 3, 4)
   * When present, transaction originates from CEA on this chain
   */
  from?: ChainSource;

  /**
   * Destination - where execution happens
   * - string: Push Chain target (Route 1)
   * - ChainTarget: External chain target (Routes 2, 3, 4)
   */
  to: UniversalTo;

  /**
   * When true, sends MIGRATION_SELECTOR as raw CEA payload (no multicall wrapping).
   * Used for CEA contract upgrades. Incompatible with value/funds/data.
   * Only applicable for Route 2 (UOA_TO_CEA) on EVM chains.
   */
  migration?: boolean;
};

// ============================================================================
// SVM (Solana) Types for Route 2 Outbound
// ============================================================================

/**
 * Account metadata for SVM CPI execution (Solana Gateway pattern).
 * Pubkey is 0x-prefixed hex encoding of a 32-byte Solana public key.
 */
export interface SvmGatewayAccountMeta {
  /** Solana public key as 0x-prefixed hex (32 bytes = 0x + 64 hex chars) */
  pubkey: `0x${string}`;
  /** Whether this account is writable in the CPI */
  isWritable: boolean;
}

/**
 * Fields for encoding the SVM execute payload (binary format).
 * Used internally by encodeSvmExecutePayload.
 */
export interface SvmExecutePayloadFields {
  /** Target Solana program to CPI into (32 bytes, 0x-prefixed hex) */
  targetProgram: `0x${string}`;
  /** Accounts required for the CPI call */
  accounts: SvmGatewayAccountMeta[];
  /** Raw instruction data for the target program */
  ixData: Uint8Array;
  /** Instruction ID: 2 = execute (default) */
  instructionId?: number;
}

// `SvmExecuteParams` (previously the user-facing CPI shape) has been removed —
// callers now pass a plain `data: 0x${string}` (Anchor discriminator + Borsh args)
// together with the Anchor IDL inline on `to.idl`. The SDK resolves accounts via
// `svm-idl/resolve.ts`. See svm-idl/build-payload.ts.

// ============================================================================
// Outbound Transaction Types (for Push → External Chain)
// ============================================================================

/**
 * Request structure for sendUniversalTxOutbound on Push Chain
 * Used for Routes 2, 3, 4 (outbound from Push)
 *
 * NOTE: The `target` field is a LEGACY parameter for contract compatibility.
 * The deployed UniversalGatewayPC contract still expects this field, but it will
 * be removed in future contract upgrades. Pass any non-zero address (e.g., CEA address).
 * The actual destination is determined by the relay from the token's SOURCE_CHAIN_NAMESPACE.
 */
export interface UniversalOutboundTxRequest {
  /**
   * LEGACY/DUMMY: Raw destination address bytes for contract compatibility.
   * Pass any non-zero address - this value is NOT used by the relay to determine
   * the actual transaction destination. Will be removed in future contract upgrades.
   */
  target: `0x${string}`;
  /** PRC20 token address on Push Chain to burn */
  token: `0x${string}`;
  /** Amount to burn (0 for no-burn, use existing CEA balance) */
  amount: bigint;
  /** Gas limit for fee quote (0 = default BASE_GAS_LIMIT) */
  gasLimit: bigint;
  /** Raw ABI-encoded Multicall[] (no selector prefix) */
  payload: `0x${string}`;
  /** Address to receive funds on revert */
  revertRecipient: `0x${string}`;
}

// ============================================================================
// Rescue Funds (Manual revert for stuck inbound funds)
// ============================================================================

/**
 * Parameters for rescuing stuck funds on a source chain.
 * Used when a CEA-to-Push inbound transaction fails and tokens are
 * locked in the Vault on the source chain.
 */
export interface RescueFundsParams {
  /** The universalTxId of the failed inbound transaction (bytes32 hash, 0x-prefixed) */
  universalTxId: `0x${string}`;
  /** PRC-20 token address on Push Chain whose source-chain counterpart is locked */
  prc20: `0x${string}`;
}

// ============================================================================
// Hop Descriptor (Internal metadata for cascade nesting)
// ============================================================================

/**
 * Internal metadata attached to each prepared transaction.
 * Carries all information needed to nest this hop into a cascade.
 * @internal
 */
export interface HopDescriptor {
  /** Original user params */
  params: UniversalExecuteParams;
  /** Detected route */
  route: TransactionRouteType;
  /** Target chain for outbound (Route 2) */
  targetChain?: CHAIN;
  /** Source chain for inbound (Route 3) */
  sourceChain?: CHAIN;
  /** CEA address on the relevant external chain */
  ceaAddress?: `0x${string}`;
  /** Operations to execute on external chain CEA */
  ceaMulticalls?: MultiCall[];
  /** Operations to execute on Push Chain */
  pushMulticalls?: MultiCall[];
  /** PRC-20 token address to burn for outbound */
  prc20Token?: `0x${string}`;
  /** Amount of PRC-20 to burn */
  burnAmount?: bigint;
  /** Gas token address on Push Chain */
  gasToken?: `0x${string}`;
  /** Gas fee amount in gas token */
  gasFee?: bigint;
  /** Gas limit for outbound relay */
  gasLimit: bigint;
  /** UEA address */
  ueaAddress: `0x${string}`;
  /** Address to receive funds on revert */
  revertRecipient: `0x${string}`;
  /** Whether this hop targets an SVM chain (Solana) */
  isSvmTarget?: boolean;
  /** SVM execute payload (binary-encoded, for Solana targets) */
  svmPayload?: `0x${string}`;
  /** Whether this hop is a CEA migration (raw MIGRATION_SELECTOR payload) */
  isMigration?: boolean;
  /** SDK 5.2 gas-abstraction sizing decision for this hop. @internal */
  sizing?: import('./internals/gas-usd-sizer').GasSizingDecision;
}

// ============================================================================
// Cascade Segment (Internal grouping for composition)
// ============================================================================

/**
 * Segment types for cascade composition
 * @internal
 */
export type CascadeSegmentType =
  | 'PUSH_EXECUTION'
  | 'OUTBOUND_TO_CEA'
  | 'INBOUND_FROM_CEA';

/**
 * A segment groups one or more hops of the same type/direction.
 * Consecutive same-chain hops are merged within a segment.
 * @internal
 */
export interface CascadeSegment {
  /** Segment type determines composition behavior */
  type: CascadeSegmentType;
  /** Hops in this segment */
  hops: HopDescriptor[];
  /** Target chain (for OUTBOUND_TO_CEA) */
  targetChain?: CHAIN;
  /** Source chain (for INBOUND_FROM_CEA) */
  sourceChain?: CHAIN;
  /** Merged CEA multicalls from all hops in segment */
  mergedCeaMulticalls?: MultiCall[];
  /** Merged Push Chain multicalls from all hops in segment */
  mergedPushMulticalls?: MultiCall[];
  /** Sum of burn amounts from merged hops */
  totalBurnAmount?: bigint;
  /** PRC-20 token for this segment */
  prc20Token?: `0x${string}`;
  /** Gas token for this segment */
  gasToken?: `0x${string}`;
  /** Total gas fee for this segment */
  gasFee?: bigint;
  /** Gas limit for this segment */
  gasLimit?: bigint;
  /**
   * SDK 5.2 gas-abstraction sizing decision for this segment. When the
   * segment merges multiple hops, the strictest (highest category) sizing
   * among them is taken (C > B > A).
   * @internal
   */
  sizing?: import('./internals/gas-usd-sizer').GasSizingDecision;
}

// ============================================================================
// Prepared Transaction & Chaining API
// ============================================================================

/**
 * Prepared transaction for inspection before sending
 * Returned by prepareTransaction()
 */
export interface PreparedUniversalTx {
  /** Detected route for this transaction */
  route: TransactionRouteType;
  /** Encoded payload ready for submission */
  payload: `0x${string}`;
  /** Gateway request object (inbound or outbound) */
  gatewayRequest: UniversalTxRequest | UniversalOutboundTxRequest;
  /** Estimated gas for the transaction */
  estimatedGas: bigint;
  /** Nonce to use */
  nonce: bigint;
  /** Signature deadline */
  deadline: bigint;
  /** Internal hop descriptor for cascade nesting @internal */
  _hop: HopDescriptor;
}

/**
 * @deprecated Use CascadedTxResponse instead.
 * Kept for backward compatibility.
 */
export interface MultiChainTxResponse {
  /** All transaction responses in execution order */
  transactions: UniversalTxResponse[];
  /** Summary of each chain's execution */
  chains: {
    chain: CHAIN;
    hash: string;
    blockNumber: bigint;
    status: 'pending' | 'confirmed' | 'failed';
  }[];
}

/**
 * Response for cascaded multi-chain transactions.
 * Contains the initial tx and tracking info for all hops.
 */
export interface CascadedTxResponse {
  /** The initial Push Chain transaction hash (user-signed) */
  initialTxHash: string;
  /** The initial transaction response */
  initialTxResponse: UniversalTxResponse;
  /** Ordered list of hops with their expected routing */
  hops: CascadeHopInfo[];
  /** Total number of hops in the cascade */
  hopCount: number;
  /** Wait for ALL hops to complete across all chains */
  waitForAll: (opts?: CascadeTrackOptions) => Promise<CascadeCompletionResult>;
  /** Convenience alias for waitForAll() */
  wait: (opts?: CascadeTrackOptions) => Promise<CascadeCompletionResult>;
}

/**
 * Information about a single hop in a cascade
 */
export interface CascadeHopInfo {
  /** Index in the cascade (0 = first hop) */
  hopIndex: number;
  /** Route for this hop */
  route: TransactionRouteType;
  /** Chain where execution occurs */
  executionChain: CHAIN;
  /** Expected universalSubTxId (computed from parent) */
  expectedSubTxId?: string;
  /** Status tracking */
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  /** Resolved tx hash once available */
  txHash?: string;
  /** External chain tx details (for outbound hops) */
  outboundDetails?: OutboundTxDetails;
}

/**
 * Options for cascade tracking
 */
export interface CascadeTrackOptions {
  /** Polling interval (default: 5000ms) */
  pollingIntervalMs?: number;
  /** Total timeout (default: 600000ms = 10 min) */
  timeout?: number;
  /** Per-hop progress callback */
  progressHook?: (event: CascadeProgressEvent) => void;
  /**
   * Unified ProgressEvent stream for SEND-TX-08/99_03-05 telemetry.
   * Fires per outbound hop during external chain polling. Use alongside
   * `progressHook` — they emit complementary views of the same events.
   */
  eventHook?: (
    event: import('../progress-hook/progress-hook.types').ProgressEvent
  ) => void;
}

/**
 * Progress event emitted during cascade tracking
 */
export interface CascadeProgressEvent {
  hopIndex: number;
  route: TransactionRouteType;
  chain: CHAIN;
  status:
    | 'waiting'
    | 'polling'
    | 'found'
    | 'confirmed'
    | 'failed'
    | 'timeout';
  txHash?: string;
  elapsed: number;
}

/**
 * Final result of cascade completion tracking
 */
export interface CascadeCompletionResult {
  /** Whether all hops completed successfully */
  success: boolean;
  /** Final state of all hops */
  hops: CascadeHopInfo[];
  /** Index of first failed hop (if any) */
  failedAt?: number;
}

// ============================================================================
// Track Transaction Options
// ============================================================================

export interface TrackTransactionOptions {
  /**
   * Target chain to track transaction on. Defaults to Push Chain based on client network.
   */
  chain?: import('../constants/enums').CHAIN;

  /**
   * Progress callback for tracking events (replays SEND-TX-* hooks)
   */
  progressHook?: (event: import('../progress-hook/progress-hook.types').ProgressEvent) => void;

  /**
   * Whether to wait for transaction confirmation before returning.
   * - true: Blocks until transaction is confirmed (default)
   * - false: Returns immediately with current status
   */
  waitForCompletion?: boolean;

  /**
   * Advanced configuration options
   */
  advanced?: {
    /**
     * Polling interval in milliseconds (default: 1000)
     */
    pollingIntervalMs?: number;

    /**
     * Timeout in milliseconds (default: 300000 = 5 minutes)
     */
    timeout?: number;

    /**
     * Custom RPC URLs per chain (overrides client defaults)
     */
    rpcUrls?: Partial<Record<import('../constants/enums').CHAIN, string[]>>;
  };
}

// ============================================================================
// Outbound Transaction Tracking
// ============================================================================

/**
 * External chain transaction details after relay completion
 */
export interface OutboundTxDetails {
  /** Transaction hash on the external chain */
  externalTxHash: string;
  /** Target chain enum */
  destinationChain: import('../constants/enums').CHAIN;
  /** Full explorer URL for the transaction */
  explorerUrl: string;
  /** Recipient address on the external chain */
  recipient: string;
  /** Amount transferred */
  amount: string;
  /** Asset address on external chain (address(0) for native) */
  assetAddr: string;
}

/**
 * Progress event for outbound sync operations
 */
export interface OutboundSyncProgress {
  status: 'waiting' | 'polling' | 'success' | 'failed' | 'timeout';
  elapsed: number;
}

/**
 * Options for waitForOutboundTx polling
 */
export interface WaitForOutboundOptions {
  /**
   * Initial wait before first poll (default: 30000ms)
   * Gives relay time to process before we start polling
   */
  initialWaitMs?: number;

  /**
   * Interval between polls (default: 5000ms)
   */
  pollingIntervalMs?: number;

  /**
   * Total timeout in milliseconds (default: 120000ms)
   * Measured from start, includes initial wait
   */
  timeout?: number;

  /**
   * Progress callback for tracking events
   */
  progressHook?: (event: { status: 'waiting' | 'polling' | 'found' | 'failed' | 'timeout'; elapsed: number }) => void;

  /**
   * @internal Pre-resolved universalSubTxId for cascade per-hop tracking.
   * When provided, skips extraction from the Push Chain tx events.
   */
  _resolvedSubTxId?: string;

  /**
   * @internal Expected destination chain CAIP-2 namespace (e.g., 'eip155:97').
   * When provided, only considers an outbound as found if its destinationChain
   * matches this value. Used for multi-outbound cascades where a single utx_id
   * has multiple outbound operations to different chains.
   */
  _expectedDestinationChain?: string;
}

// ============================================================================
// Account Status Types (UEA Migration / Upgrade)
// ============================================================================

/**
 * UEA deployment and version status.
 * Versions are stored as strings (e.g. "1.0.2") matching the on-chain format.
 * Comparison uses parseUEAVersion() to convert to numeric for ordering.
 */
export interface UEAStatus {
  /** Whether status has been fetched from chain */
  loaded: boolean;
  /** Whether the UEA proxy is deployed on Push Chain */
  deployed: boolean;
  /** Current UEA implementation version string (e.g. "1.0.0", empty if not deployed) */
  version: string;
  /** Latest required version from UEAFactory (e.g. "1.0.2", empty if unknown) */
  minRequiredVersion: string;
  /** True when deployed && parseUEAVersion(version) < parseUEAVersion(minRequiredVersion) */
  requiresUpgrade: boolean;
}

/**
 * Account status returned by pushChainClient.getAccountStatus()
 */
export interface AccountStatus {
  mode: 'read-only' | 'signer';
  uea: UEAStatus;
}

// ============================================================================
// UEA Version Utilities
// ============================================================================

/**
 * Parse a semver string into the numeric UEA version format.
 * e.g. "1.0.2" → 1000002
 */
export function parseUEAVersion(version: string): number {
  const parts = version.split('.');
  if (parts.length !== 3) return 0;
  const major = parseInt(parts[0], 10) || 0;
  const minor = parseInt(parts[1], 10) || 0;
  const patch = parseInt(parts[2], 10) || 0;
  return major * 1000000 + minor * 1000 + patch;
}
