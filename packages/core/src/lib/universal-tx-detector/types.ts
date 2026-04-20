/**
 * Public types for the universal-tx detector.
 */
import type { CHAIN, PUSH_NETWORK } from '../constants/enums';
import type { PushClient } from '../push-client/push-client';

/**
 * High-level classification for a transaction.
 * Priority when multiple universal-tx events exist in the same receipt:
 *   OUTBOUND_FINALIZED > OUTBOUND_REVERTED > OUTBOUND_INITIATED
 *   > INBOUND_REVERTED > INBOUND_FROM_CEA > INBOUND_FROM_EOA
 *   > EXECUTED_ON_DEST > RESCUED_FUNDS > UNKNOWN
 */
export type UniversalTxKind =
  | 'INBOUND_FROM_EOA'
  | 'INBOUND_FROM_CEA'
  | 'OUTBOUND_INITIATED'
  | 'OUTBOUND_FINALIZED'
  | 'OUTBOUND_REVERTED'
  | 'INBOUND_REVERTED'
  | 'EXECUTED_ON_DEST'
  | 'RESCUED_FUNDS'
  | 'UNKNOWN';

export type TxTypeName =
  | 'GAS'
  | 'GAS_AND_PAYLOAD'
  | 'FUNDS'
  | 'FUNDS_AND_PAYLOAD'
  | 'RESCUE_FUNDS'
  | 'UNKNOWN';

export interface DecodedIdentifiers {
  subTxId?: `0x${string}`;
  universalTxId?: `0x${string}`;
  sender?: `0x${string}`;
  recipient?: `0x${string}` | string;
  pushAccount?: `0x${string}`;
  token?: `0x${string}`;
  amount?: bigint;
  payloadPreview?: `0x${string}`;
  payloadLength?: number;
  txType?: number;
  txTypeName?: TxTypeName;
  fromCEA?: boolean;
  destinationChainNamespace?: string;
  gasFee?: bigint;
  gasLimit?: bigint;
  protocolFee?: bigint;
  revertRecipient?: `0x${string}`;
  revertMsgPreview?: `0x${string}`;
}

export interface MatchingLog {
  eventName: string;
  address: `0x${string}`;
  logIndex: number;
  args: Record<string, unknown>;
}

export interface PushChainOutboundSummary {
  subTxId: string;
  status: string;
  destinationChain: string;
  externalTxHash?: string;
  amount?: string;
  recipient?: string;
}

export interface PushChainCrossRef {
  id: string;
  status: number;
  statusName: string;
  pcTxHashes: string[];
  outboundHashes: PushChainOutboundSummary[];
  /** Set when cosmos has not progressed the status for an inbound tx. */
  stuckObservation?: 'UNSPECIFIED' | 'PENDING_INBOUND_ONLY';
  /** Cosmos query returned no record for this universalTxId. */
  notFound?: boolean;
}

export interface DetectionEntry {
  kind: UniversalTxKind;
  decoded: DecodedIdentifiers;
  log: MatchingLog;
}

export interface UniversalTxDetection {
  txHash: `0x${string}`;
  chain: CHAIN;
  /**
   * Primary classification (highest-priority event in the receipt).
   * See `detections` for the per-log list when a receipt carries multiple
   * universal events (e.g. outbound finalize + CEA-originated inbound).
   */
  kind: UniversalTxKind;
  /** Decoded identifiers for the primary log. */
  decoded: DecodedIdentifiers;
  /** Unique emitter addresses of the matching logs. */
  emitters: `0x${string}`[];
  matchingLogs: MatchingLog[];
  /** One entry per matching universal-tx log. Empty when kind is UNKNOWN. */
  detections: DetectionEntry[];
  pushChainTx?: PushChainCrossRef;
  notes: string[];
}

export interface DetectUniversalTxOptions {
  /**
   * PushClient used to cross-reference the cosmos side. When omitted
   * (or skipPushChainLookup=true), `pushChainTx` stays undefined.
   */
  pushClient?: PushClient;
  /**
   * Per-chain RPC overrides. Falls back to CHAIN_INFO[chain].defaultRPC.
   */
  rpcUrls?: Partial<Record<CHAIN, string[]>>;
  skipPushChainLookup?: boolean;
  /**
   * PUSH_NETWORK used for deriving universalTxId on inbound txs where the
   * emitted UniversalTx event does not carry one. Defaults to TESTNET_DONUT.
   */
  pushNetwork?: PUSH_NETWORK;
}
