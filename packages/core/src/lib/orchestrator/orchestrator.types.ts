import type { CHAIN } from '../constants/enums';

// ============================================================================
// Multi-Chain Transaction Types
// ============================================================================

/**
 * Chain target for cross-chain routing (Routes 2, 3, 4)
 * When `to` is a ChainTarget, the transaction executes on the specified external chain
 */
export type ChainTarget = {
  address: `0x${string}`;
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
  wait: () => Promise<UniversalTxReceipt>;

  /**
   * Register a progress callback for events during wait().
   * Call this BEFORE calling wait() to receive tracking events.
   * @param callback - Function called with each progress event
   */
  progressHook: (
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
}

/**
 * New Universal Transaction Receipt interface for transaction receipts
 */
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
   * SVM-specific: CPI execution parameters for Solana targets (Route 2).
   * When present, the outbound transaction will execute a Cross-Program Invocation
   * on the specified Solana program with the given accounts and instruction data.
   * Only applicable when `to.chain` is a Solana chain.
   */
  svmExecute?: SvmExecuteParams;

  /**
   * When true, sends MIGRATION_SELECTOR as raw CEA payload (no multicall wrapping).
   * Used for CEA contract upgrades. Incompatible with value/funds/data/svmExecute.
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
  /** Rent fee in lamports for target program account creation (0 if none) */
  rentFee: bigint;
  /** Instruction ID: 2 = execute (default) */
  instructionId?: number;
}

/**
 * User-facing parameters for CPI execution on a Solana program via Route 2.
 * Passed as `svmExecute` in UniversalExecuteParams when targeting SVM chains.
 */
export interface SvmExecuteParams {
  /** Target Solana program to CPI into (32 bytes, 0x-prefixed hex) */
  targetProgram: `0x${string}`;
  /** Accounts required for the CPI call */
  accounts: SvmGatewayAccountMeta[];
  /** Raw instruction data for the target program */
  ixData: Uint8Array;
  /** Rent fee in lamports for target program account creation (default 0) */
  rentFee?: bigint;
}

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
  /** Chain additional transactions after this one (cascade) */
  thenOn: (nextTx: PreparedUniversalTx) => CascadedTransactionBuilder;
  /** Execute this prepared transaction */
  send: () => Promise<UniversalTxResponse>;
}

/**
 * @deprecated Use CascadedTransactionBuilder instead.
 * Kept for backward compatibility.
 */
export interface ChainedTransactionBuilder {
  /** Add another transaction to the chain */
  thenOn: (nextTx: UniversalExecuteParams) => ChainedTransactionBuilder;
  /** Execute all chained transactions */
  send: () => Promise<MultiChainTxResponse>;
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

// ============================================================================
// Cascaded Transaction Builder (Advance Hopping)
// ============================================================================

/**
 * Builder for composing cascaded (nested) multi-chain transactions.
 * Each call to thenOn() adds another hop to the cascade.
 * send() composes all hops bottom-to-top and executes a single Push Chain tx.
 */
export interface CascadedTransactionBuilder {
  /** Add another hop to the cascade */
  thenOn: (nextTx: PreparedUniversalTx) => CascadedTransactionBuilder;
  /** Compose all hops bottom-to-top and execute the single initial tx */
  send: () => Promise<CascadedTxResponse>;
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
  /** Progress callback */
  progressHook?: (event: CascadeProgressEvent) => void;
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
}
