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
