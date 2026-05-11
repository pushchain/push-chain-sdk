/**
 * User-facing normalization pass for detector outputs.
 *
 * The detector module's internal pipeline produces `PushChainOutboundSummary`
 * objects with raw `0x`-hex `externalTxHash` for SVM destinations — that's
 * the form Cosmos delivers and the form `findChildUtxIdFromExternalTx` /
 * `inbound_tx_hash='…'` queries require. For USER-facing entry points
 * (`detectUniversalTx`, `traceUniversalTxCascade`,
 * `resolveChildInboundsFromDetection`), the SVM hash should be base58 so
 * consumers can paste it straight into a Solana explorer or
 * `connection.getTransaction(sig)`.
 *
 * These helpers are applied at the three public-API return points (and
 * NOWHERE else) — they walk the result tree and rewrite
 * `PushChainOutboundSummary.externalTxHash` for SVM destinations. The
 * internal pipeline never sees the normalized form.
 *
 * Helpers are idempotent: a value not starting with `0x` or whose
 * `destinationChain` isn't SVM passes through unchanged. New objects are
 * returned only when a field actually changed; otherwise the same reference
 * is reused so EVM-only graphs incur near-zero allocation.
 */

import {
  toExternalTxHashDisplay,
  chainFromNamespace,
} from '../utils/external-tx-hash';
import type {
  PushChainOutboundSummary,
  PushChainCrossRef,
  UniversalTxDetection,
} from './types';
import type { CascadeNode, CascadeEdge, PcRefundSummary } from './cascade';
import type { ChildInboundResolution } from './child-inbounds';

/**
 * Normalize a single outbound summary's `externalTxHash` for user display.
 * Returns the same reference when no change is needed.
 */
export function normalizeOutboundSummaryForUser(
  s: PushChainOutboundSummary
): PushChainOutboundSummary {
  if (!s.externalTxHash) return s;
  const chain = chainFromNamespace(s.destinationChain);
  const next = toExternalTxHashDisplay(chain ?? undefined, s.externalTxHash);
  if (next === s.externalTxHash) return s;
  return { ...s, externalTxHash: next };
}

/**
 * Normalize the outbound summaries inside `PushChainCrossRef.outboundHashes`.
 * Reuses the input when no nested summary changed.
 */
function normalizeCrossRefForUser(
  x: PushChainCrossRef
): PushChainCrossRef {
  if (!x.outboundHashes || x.outboundHashes.length === 0) return x;
  let changed = false;
  const next = x.outboundHashes.map((s) => {
    const n = normalizeOutboundSummaryForUser(s);
    if (n !== s) changed = true;
    return n;
  });
  if (!changed) return x;
  return { ...x, outboundHashes: next };
}

/**
 * Normalize the outbound summaries embedded in `detection.pushChainTx`.
 * The root `detection.txHash` is left untouched — per agreed scope.
 */
export function normalizeDetectionForUser(
  d: UniversalTxDetection
): UniversalTxDetection {
  if (!d.pushChainTx) return d;
  const nextPushChainTx = normalizeCrossRefForUser(d.pushChainTx);
  if (nextPushChainTx === d.pushChainTx) return d;
  return { ...d, pushChainTx: nextPushChainTx };
}

/**
 * Normalize the outbound summaries inside a `ChildInboundResolution`.
 * `pcTxHashes` (Push Chain — always EVM) is left untouched.
 */
export function normalizeChildInboundResolutionForUser(
  r: ChildInboundResolution
): ChildInboundResolution {
  if (!r.outboundHashes || r.outboundHashes.length === 0) return r;
  let changed = false;
  const next = r.outboundHashes.map((s) => {
    const n = normalizeOutboundSummaryForUser(s);
    if (n !== s) changed = true;
    return n;
  });
  if (!changed) return r;
  return { ...r, outboundHashes: next };
}

/**
 * Type guard: identifies a `CascadeEdge.relation` as a
 * `PushChainOutboundSummary`. Outbound summaries carry `destinationChain` and
 * (optionally) `externalTxHash`; refund summaries and child-inbound
 * resolutions don't.
 */
function isOutboundRelation(
  r: PushChainOutboundSummary | ChildInboundResolution | PcRefundSummary
): r is PushChainOutboundSummary {
  return (
    typeof (r as PushChainOutboundSummary).destinationChain === 'string' &&
    !('universalTxId' in r) &&
    !('parentOutboundId' in r)
  );
}

function isChildInboundRelation(
  r: PushChainOutboundSummary | ChildInboundResolution | PcRefundSummary
): r is ChildInboundResolution {
  return 'universalTxId' in r;
}

/** Recursively normalize a cascade tree. */
export function normalizeCascadeNodeForUser(
  n: CascadeNode
): CascadeNode {
  const nextDetection = normalizeDetectionForUser(n.detection);

  let childrenChanged = nextDetection !== n.detection;
  const nextChildren: CascadeEdge[] = n.children.map((edge) => {
    let nextRelation = edge.relation;
    if (isOutboundRelation(edge.relation)) {
      nextRelation = normalizeOutboundSummaryForUser(edge.relation);
    } else if (isChildInboundRelation(edge.relation)) {
      nextRelation = normalizeChildInboundResolutionForUser(edge.relation);
    }
    const nextNode = edge.node ? normalizeCascadeNodeForUser(edge.node) : edge.node;
    if (nextRelation === edge.relation && nextNode === edge.node) return edge;
    childrenChanged = true;
    return { ...edge, relation: nextRelation, node: nextNode };
  });

  if (!childrenChanged) return n;
  return { ...n, detection: nextDetection, children: nextChildren };
}
