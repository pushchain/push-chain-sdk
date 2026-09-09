import type { Abi, Address, Hex } from 'viem';
import type { CHAIN } from '../constants/enums';
import type { ReadNamespace } from '../constants/read-state';

// ---------------------------------------------------------------------------
// Destination
// ---------------------------------------------------------------------------

/**
 * Where a read goes. `CHAIN` enum values are CAIP-2 and split cleanly; the
 * explicit form is the escape hatch and the only way to address web2
 * (`WEB2_DESTINATION`).
 */
export type ReadDestination = { chain: CHAIN } | { chainNamespace: string; chainId: string };

export type ResolvedDestination = {
  chainNamespace: string;
  chainId: string;
  /** `${chainNamespace}:${chainId}` — the key the oracle and the node route on. */
  caip2: string;
  namespace: ReadNamespace;
};

// ---------------------------------------------------------------------------
// Queries — kind is the `type` discriminant
// ---------------------------------------------------------------------------

export type EvmReadQuery =
  | { type: 'accountBalance'; target: Address }
  | { type: 'contractCall'; target: Address; callData: Hex }
  | {
      type: 'contractCall';
      target: Address;
      /** encodes the call AND decodes the result */
      abi: Abi;
      functionName: string;
      args?: readonly unknown[];
    }
  | { type: 'storageSlot'; target: Address; slot: Hex | bigint };

/** The account being read rides in `ReadSpec.account.owner` as a raw 32-byte pubkey, not in the envelope. */
export type SvmReadQuery =
  | { type: 'lamportBalance'; account: string | Uint8Array }
  | { type: 'splTokenAccount'; account: string | Uint8Array }
  | { type: 'rawAccountData'; account: string | Uint8Array };

export type Web2ValueType = 'uint256' | 'int256' | 'bool' | 'string' | 'bytes';

export interface Web2Extract {
  /** JSONPath, e.g. "$.data.price" */
  path: string;
  valueType: Web2ValueType;
  /** Numeric only. Value × 10^decimals, TRUNCATED before encoding. */
  decimals?: number;
}

export interface Web2ReadQuery {
  type: 'http';
  method?: 'GET' | 'POST';
  url: string;
  /** ⚠ Written to a public event log, forever. */
  headers?: Record<string, string>;
  /** POST only */
  body?: string | Uint8Array;
  timeoutMs?: number;
  /** 1–16 entries; result values come back in this order. */
  extract: readonly Web2Extract[];
}

export type ReadQuery = EvmReadQuery | SvmReadQuery | Web2ReadQuery;

// ---------------------------------------------------------------------------
// Encoded query — carries what is needed to decode the eventual result
// ---------------------------------------------------------------------------

export type ReadResultShape =
  | { kind: 'uint256' }
  | { kind: 'bytes32' }
  | { kind: 'raw' }
  | { kind: 'evmCall'; abi: Abi; functionName: string }
  | { kind: 'web2'; extract: readonly Web2Extract[] };

export interface EncodedReadQuery {
  namespace: ReadNamespace;
  queryType: number;
  /** abi.encode(envelope tuple) — goes into ReadSpec.query */
  encoded: Hex;
  /** EVM: pinned block. SVM: minSlot floor. Web2: 0. Mirrored into ReadSpec.blockNumber by the spec builder. */
  blockRef: bigint;
  resultShape: ReadResultShape;
  /** SVM only: the raw 32-byte pubkey that MUST go in ReadSpec.account.owner. */
  ownerBytes?: Hex;
  /** Non-fatal advisories (e.g. a sensitive-looking web2 header). */
  warnings: string[];
}

export type DecodedReadResult =
  | { kind: 'uint256'; value: bigint }
  | { kind: 'bytes32'; value: Hex }
  | { kind: 'raw'; value: Hex }
  | { kind: 'evmCall'; values: readonly unknown[] }
  | { kind: 'web2'; values: readonly unknown[] };

// ---------------------------------------------------------------------------
// Preflight — the on-chain values a valid ReadSpec depends on
// ---------------------------------------------------------------------------

export interface ReadPreflight {
  destination: ResolvedDestination;
  /** `UniversalCallback.estimateFee(ns, chainId)` — the protocol fee ONLY. 0 on Donut today. */
  protocolFee: bigint;
  /**
   * `UniversalCore.chainHeightByChainNamespace(caip2)` — the oracle-observed height of the
   * destination and the ceiling for `blockNumber`. Lags the real head. 0 for heightless
   * namespaces (web2), where `blockNumber` must then be 0.
   */
  observedChainHeight: bigint;
  /** Current Push Chain height, for expiry. */
  pushBlockNumber: bigint;
  /** Push gas price used to size the callback budget. */
  pushGasPrice: bigint;
  universalCallback: Address;
  universalCore: Address;
  /** Date.now() at fetch — pushBlockNumber moves every block; a stale preflight can miss expiry. */
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// ReadSpec — exactly the deployed Solidity struct (7 fields)
// ---------------------------------------------------------------------------

export interface ReadSpec {
  account: { chainNamespace: string; chainId: string; owner: Hex };
  query: Hex;
  /** uint16, ≥ 1 */
  minConfirmations: number;
  /** uint64. Heightless namespaces (web2) MUST be 0; else 1..oracleHeight */
  blockNumber: bigint;
  /** uint64, > current Push height */
  expiryPushChainHeight: bigint;
  /** ≥ msg.value */
  maxFee: bigint;
  /** ≠ 0. Refunds are PUSHED here. */
  revertRecipient: Address;
}

/** Positional form for `encodeFunctionData` / `encodeAbiParameters`. */
export type ReadSpecTuple = readonly [
  readonly [string, string, Hex],
  Hex,
  number,
  bigint,
  bigint,
  bigint,
  Address,
];

// ---------------------------------------------------------------------------
// prepareRead
// ---------------------------------------------------------------------------

export interface BuildReadSpecParams {
  destination: ReadDestination;
  query: ReadQuery;
  /** 1n..1_000_000n. Execution bound on YOUR callback; also sizes the budget. */
  callbackGasLimit: bigint;
  /**
   * Where unspent budget is PUSHED (ReadSpec.revertRecipient). Required by the contract.
   * Default: the sending account (a UEA has a payable receive()). A non-UEA contract
   * without one forfeits the refund — prepareRead warns.
   */
  refundTo?: Address;
  /** EVM/web2 only: ReadSpec.account.owner. Ignored by validators for EVM; defaults to refundTo. SVM derives it from the query. */
  owner?: Hex;
  /** ≥ 1. Default 1. */
  minConfirmations?: number;
  /** Pinned destination height. Default observedChainHeight − minConfirmations (≥ 1). Web2: forced to 0. */
  blockNumber?: bigint;
  /** Default 300n. */
  expiryBlocks?: bigint;
  /** Absolute override for expiryBlocks. */
  expiryPushChainHeight?: bigint;
  /** Escrowed on top of the protocol fee. Default sizeCallbackBudget(gasLimit, gasPrice). Must be > 0. */
  callbackBudget?: bigint;
  /** Multiplier used by the default budget. */
  budgetBuffer?: number;
  /** Cap on msg.value. Default value × (1 + maxFeeBufferBps/10_000). */
  maxFee?: bigint;
  maxFeeBufferBps?: number;
}

export interface PreparedRead {
  spec: ReadSpec;
  /** Positional form for viem calls. */
  specTuple: ReadSpecTuple;
  /** abi.encode(spec) for hand-assembled calldata. */
  encodedSpec: Hex;
  /** msg.value to send: protocolFee + callbackBudget. */
  value: bigint;
  protocolFee: bigint;
  callbackBudget: bigint;
  callbackGasLimit: bigint;
  /** Carries the result shape for decoding, and any encoder warnings. */
  encodedQuery: EncodedReadQuery;
  preflight: ReadPreflight;
  /** Advisories: sensitive headers, refundTo is a non-UEA contract, … */
  warnings: string[];
}

export type SimulateReadResult =
  | { ok: true }
  | { ok: false; error: string; errorName?: string; args?: readonly unknown[] };

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface ParsedReadRequest {
  /** 32-byte topic hex, lowercase — the node's primary key */
  requestId: Hex;
  requestIdUint: bigint;
  callbackTarget: Address;
  originalFunder: Address;
  spec: ReadSpec;
  callbackGasLimit: bigint;
  totalPaid: bigint;
  protocolFee: bigint;
  callbackBudget: bigint;
  logIndex: number;
}

/** What the fulfil / settle / expiry transactions said, parsed from UniversalCallback logs. */
export interface FulfilOutcome {
  /** true = ReadFulfilled, false = CallbackFailed, undefined = neither seen in this receipt */
  delivered?: boolean;
  /** revert data from CallbackFailed */
  failReason?: Hex;
  gasReported?: bigint;
  burned?: bigint;
  refunded?: bigint;
  refundTo?: Address;
  /** RefundFailed seen — budget forfeited to the admin rescue pool */
  refundFailed?: boolean;
  /** RequestExpired seen */
  expired?: boolean;
}

/** Minimal structural receipt — works with viem receipts and `cast receipt --json`. */
export interface ReceiptLike {
  logs: readonly {
    address: string;
    topics: readonly string[];
    data: string;
    logIndex?: number | string;
  }[];
}

// ---------------------------------------------------------------------------
// Tracking — the shape trackRead / wait / refresh resolve to
// ---------------------------------------------------------------------------

export type ReadRef = { txHash: Hex } | { requestId: Hex | bigint };

export interface ReadLifecycleOptions {
  /** Default `expiryBlocks × PUSH_BLOCK_TIME_MS`, capped at READ_TRACK_MAX_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Default READ_TRACK_POLL_INTERVAL_MS; floor READ_TRACK_MIN_POLL_INTERVAL_MS. */
  pollingIntervalMs?: number;
  /**
   * How to decode `resultData`. When omitted the tracker infers it from the on-chain
   * envelope (balances → uint256, storage → bytes32, web2 → its extract list); a
   * contract call has no ABI on chain and decodes to raw bytes unless given here.
   */
  resultShape?: ReadResultShape;
}

/** Accounting for one read, assembled from the request record and the settlement logs. */
export interface ReadFees {
  /** msg.value at request time (`feesDeposited`) */
  paid: bigint;
  /** gone at request time, never refunded */
  protocolFee: bigint;
  /** escrowed for the callback */
  callbackBudget: bigint;
  /** consumed by the callback — `CallbackGasReported` */
  burned?: bigint;
  /** pushed back to `refundTo` — `RefundSent` / `RequestExpired` */
  refunded?: bigint;
  /** the push was rejected — budget sits in the admin rescue pool */
  refundFailed?: boolean;
}

export interface UniversalReadResponse<T = unknown> {
  // identity
  requestId: Hex;
  /** Push tx that carried the request */
  txHash: Hex;
  destination: ResolvedDestination;
  /** The destination as a `CHAIN` member when it is one (never for web2). */
  chain?: CHAIN;

  // outcome
  status: UNIVERSAL_READ_STATUS;
  isTerminal: boolean;
  /**
   * FULFILLED only. true = `ReadFulfilled`; false = `CallbackFailed` (your callback
   * reverted / ran out of gas). FULFILLED does NOT imply delivered — check both.
   */
  callbackDelivered?: boolean;
  /** Revert data from `CallbackFailed`. */
  callbackFailReason?: Hex;
  /** Decoded result. Present iff FULFILLED && callbackDelivered && result SUCCESS && decodable. */
  value?: T;
  decoded?: DecodedReadResult;
  /** Why `value` is absent although the read succeeded (shape mismatch). */
  decodeError?: string;
  /** Consensus bytes — what ⅔ of validators voted on. `null` before a result exists. */
  raw: { status: READ_STATUS; resultData: Hex; errorCode: READ_ERROR_CODE } | null;
  errorMsg: string;

  fees: ReadFees;

  // provenance — the on-chain record
  request: {
    spec: ReadSpec;
    callbackTarget: Address;
    /** who paid (msg.sender at request) — NOT where refunds go */
    originalFunder: Address;
    /** where refunds go */
    refundTo: Address;
    callbackGasLimit: bigint;
    logIndex: number;
    createdAtHeight: bigint;
  };
  /** Push txs the node sent for this read (fulfil, settle, expiry sweep). */
  pcTx: readonly { txHash: Hex; blockHeight: number; status: string; errorMsg: string }[];
  explorerUrl: string;

  /** Poll until terminal (or already terminal → resolves at once). Only a timeout throws. */
  wait(opts?: ReadLifecycleOptions): Promise<UniversalReadResponse<T>>;
  /** One fresh snapshot, no polling. */
  refresh(): Promise<UniversalReadResponse<T>>;
}

// ---------------------------------------------------------------------------
// Status enums (mirror ucallback.v1 protos; re-exported for the public surface)
// ---------------------------------------------------------------------------

export enum UNIVERSAL_READ_STATUS {
  UNSPECIFIED = 0,
  PENDING = 1,
  VOTING = 2,
  /** fulfil tx succeeded — check `callbackDelivered` before trusting the result */
  FULFILLED = 3,
  EXPIRED = 4,
  /** contract had already settled the request another way */
  FAILED = 5,
  ABORTED = 6,
}

export enum READ_STATUS {
  UNSPECIFIED = 0,
  SUCCESS = 1,
  ERROR = 2,
}

export enum READ_ERROR_CODE {
  UNSPECIFIED = 0,
  INVALID_QUERY = 1,
  UNSUPPORTED = 2,
  REVERTED = 3,
  NOT_FOUND = 4,
  INVALID_RESULT = 5,
  REJECTED = 6,
}

/** On-chain lifecycle (`RequestStatus` in ReadTypes.sol). */
export enum CONTRACT_REQUEST_STATUS {
  NONE = 0,
  PENDING = 1,
  EXECUTED = 2,
  SETTLED = 3,
  EXPIRED = 4,
}

export const TERMINAL_READ_STATUSES: ReadonlySet<UNIVERSAL_READ_STATUS> = new Set([
  UNIVERSAL_READ_STATUS.FULFILLED,
  UNIVERSAL_READ_STATUS.EXPIRED,
  UNIVERSAL_READ_STATUS.FAILED,
  UNIVERSAL_READ_STATUS.ABORTED,
]);
