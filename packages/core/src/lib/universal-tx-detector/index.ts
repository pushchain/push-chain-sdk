/**
 * Universal-Tx Detector — read-only SDK utility that, given a source-chain tx
 * hash + chain, decodes any universal-tx events in the receipt and (optionally)
 * cross-references the corresponding universalTx on Push Chain.
 *
 * Entrypoint: `detectUniversalTx(txHash, chain, opts?)`.
 */
export { detectUniversalTx } from './detector';
export { classify, classifyAll } from './classify';
export {
  deriveChildUniversalTxId,
  derivePcUniversalTxId,
  resolveChildInboundsFromDetection,
  resolveChildInboundsFromLogs,
} from './child-inbounds';
export type { ChildInboundResolution } from './child-inbounds';
export { traceUniversalTxCascade, flattenCascade } from './cascade';
export type {
  CascadeEdge,
  CascadeNode,
  PcRefundSummary,
  TraceCascadeOptions,
} from './cascade';
export {
  detectUniversalTxAuto,
  listAutoProbeChains,
} from './auto-detect';
export type {
  AutoDetectionResult,
  DetectUniversalTxAutoOptions,
} from './auto-detect';
export {
  EVENT_UNIVERSAL_TX,
  EVENT_UNIVERSAL_TX_EXECUTED,
  EVENT_REVERT_UNIVERSAL_TX,
  EVENT_FUNDS_RESCUED,
  EVENT_UNIVERSAL_TX_FINALIZED,
  EVENT_UNIVERSAL_TX_REVERTED,
  EVENT_UNIVERSAL_TX_OUTBOUND,
  UNIVERSAL_TX_EVENT_ABI,
} from './events';
export type { KnownEventName } from './events';
export type {
  DecodedIdentifiers,
  DetectionEntry,
  DetectUniversalTxOptions,
  MatchingLog,
  PushChainCrossRef,
  PushChainOutboundSummary,
  TxTypeName,
  UniversalTxDetection,
  UniversalTxKind,
} from './types';
