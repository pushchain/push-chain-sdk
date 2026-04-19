/**
 * detectUniversalTx — given a source-chain tx hash + chain, fetch the receipt,
 * decode all universal-tx events, classify the tx, and (optionally) cross-
 * reference the corresponding universalTx on Push Chain via cosmos.
 *
 * Read-only. No signer required. No Push block-explorer dependency.
 *
 * TODO(svm): Solana/SVM detection is not implemented in v1. Add a branch on
 * CHAIN_INFO[chain].vm === VM.SVM that uses the SDK's SVM client
 * (packages/core/src/lib/vm-client/svm-client.ts) to fetch program logs and
 * decode the SVM-gateway universal-tx instruction.
 */
import {
  createPublicClient,
  fallback,
  http,
  parseEventLogs,
  type Log,
  type PublicClient,
  type TransactionReceipt,
} from 'viem';

import { CHAIN_INFO } from '../constants/chain';
import { CHAIN, VM } from '../constants/enums';
import { computeUniversalTxId } from '../orchestrator/internals/outbound-tracker';
import type { PushClient } from '../push-client/push-client';

import { UNIVERSAL_TX_EVENT_ABI } from './events';
import { classify, classifyAll } from './classify';
import {
  deriveChildUniversalTxId,
  derivePcUniversalTxId,
} from './child-inbounds';
import type {
  DetectUniversalTxOptions,
  MatchingLog,
  PushChainCrossRef,
  PushChainOutboundSummary,
  UniversalTxDetection,
  UniversalTxKind,
} from './types';

// ── Status name table (copied from scripts/poll-outbound.ts:33-44) ────
const UNIVERSAL_TX_STATUS_NAMES: Record<number, string> = {
  0: 'UNIVERSAL_TX_STATUS_UNSPECIFIED',
  1: 'INBOUND_SUCCESS',
  2: 'PENDING_INBOUND_EXECUTION',
  3: 'PC_EXECUTED_SUCCESS',
  4: 'PC_EXECUTED_FAILED',
  5: 'PC_PENDING_REVERT',
  6: 'OUTBOUND_PENDING',
  7: 'OUTBOUND_SUCCESS',
  8: 'OUTBOUND_FAILED',
  9: 'CANCELED',
};

const INBOUND_KINDS = new Set<UniversalTxKind>([
  'INBOUND_FROM_EOA',
  'INBOUND_FROM_CEA',
]);

export async function detectUniversalTx(
  txHash: `0x${string}`,
  chain: CHAIN,
  opts: DetectUniversalTxOptions = {}
): Promise<UniversalTxDetection> {
  const notes: string[] = [];
  const chainInfo = CHAIN_INFO[chain];

  if (!chainInfo) {
    throw new Error(`detectUniversalTx: unknown chain ${chain}`);
  }
  if (chainInfo.vm !== VM.EVM) {
    throw new Error(
      `detectUniversalTx: only EVM chains are supported in v1 (got vm=${chainInfo.vm} for ${chain})`
    );
  }

  const rpcUrls =
    opts.rpcUrls?.[chain] && opts.rpcUrls[chain]!.length > 0
      ? opts.rpcUrls[chain]!
      : chainInfo.defaultRPC.filter((r) => r && r.length > 0);

  if (rpcUrls.length === 0) {
    throw new Error(
      `detectUniversalTx: no RPC URL configured for chain ${chain}`
    );
  }

  const publicClient: PublicClient = createPublicClient({
    transport: fallback(rpcUrls.map((url) => http(url))),
  });

  let receipt: TransactionReceipt | null;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  } catch (err) {
    // viem throws if the tx isn't found yet; treat as no-receipt.
    notes.push(
      `receipt fetch failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return emptyDetection(txHash, chain, notes);
  }

  if (!receipt) {
    notes.push('no receipt returned by RPC');
    return emptyDetection(txHash, chain, notes);
  }

  if (receipt.status === 'reverted' && receipt.logs.length === 0) {
    notes.push('tx reverted with no logs');
    return emptyDetection(txHash, chain, notes);
  }

  const parsed = parseEventLogs({
    abi: UNIVERSAL_TX_EVENT_ABI,
    logs: receipt.logs as Log[],
    strict: false,
  });

  const matchingLogs: MatchingLog[] = parsed.map((p) => ({
    eventName: (p as unknown as { eventName: string }).eventName,
    address: (p as unknown as { address: `0x${string}` }).address,
    logIndex:
      typeof (p as unknown as { logIndex?: number | bigint }).logIndex ===
      'bigint'
        ? Number((p as unknown as { logIndex: bigint }).logIndex)
        : (p as unknown as { logIndex?: number }).logIndex ?? -1,
    args: ((p as unknown as { args?: Record<string, unknown> }).args ??
      {}) as Record<string, unknown>,
  }));

  const classified = classify(matchingLogs);
  notes.push(...classified.notes);

  const decoded = { ...classified.decoded };

  // Deterministic universalTxId derivation for primary kinds whose event
  // doesn't carry it. Formulas from push-chain/x/uexecutor/types/keys.go:
  //   - Inbound (any external-chain UniversalTx log):
  //       sha256(`<caip>:<txHash>:<logIndex>`)   — GetInboundUniversalTxKey:49
  //   - Push-initiated outbound (UniversalTxOutbound on Push Chain):
  //       sha256(`<caip>:<txHash>`)              — GetPcUniversalTxKey:63
  if (!decoded.universalTxId) {
    const caip: string = chain; // CHAIN enum values are CAIP-2 strings.
    if (
      INBOUND_KINDS.has(classified.kind) &&
      classified.primaryLog &&
      classified.primaryLog.logIndex >= 0
    ) {
      decoded.universalTxId = deriveChildUniversalTxId(
        caip,
        txHash,
        classified.primaryLog.logIndex
      );
      notes.push(
        `universalTxId derived via sha256("${caip}:<txHash>:${classified.primaryLog.logIndex}")`
      );
    } else if (classified.kind === 'OUTBOUND_INITIATED') {
      decoded.universalTxId = derivePcUniversalTxId(caip, txHash);
      notes.push(
        `universalTxId derived via sha256("${caip}:<txHash>") — pc outbound`
      );
    }
  }

  // Optional cosmos cross-reference.
  let pushChainTx: PushChainCrossRef | undefined;
  if (
    opts.pushClient &&
    !opts.skipPushChainLookup &&
    decoded.universalTxId
  ) {
    pushChainTx = await crossReferencePushChain(
      opts.pushClient,
      decoded.universalTxId,
      classified.kind,
      notes
    );
  } else if (decoded.universalTxId && !opts.pushClient) {
    notes.push('push cross-reference skipped (no pushClient provided)');
  }

  const detections = classifyAll(classified.matchingLogs);

  return {
    txHash,
    chain,
    kind: classified.kind,
    emitters: classified.emitters,
    decoded,
    matchingLogs: classified.matchingLogs,
    detections,
    pushChainTx,
    notes,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

function emptyDetection(
  txHash: `0x${string}`,
  chain: CHAIN,
  notes: string[]
): UniversalTxDetection {
  return {
    txHash,
    chain,
    kind: 'UNKNOWN',
    emitters: [],
    decoded: {},
    matchingLogs: [],
    detections: [],
    notes,
  };
}

async function crossReferencePushChain(
  pushClient: PushClient,
  universalTxId: `0x${string}`,
  kind: UniversalTxKind,
  notes: string[]
): Promise<PushChainCrossRef | undefined> {
  const id = universalTxId.startsWith('0x')
    ? universalTxId.slice(2)
    : universalTxId;

  try {
    const resp = await pushClient.getUniversalTxByIdV2(id);
    const utx = resp?.universalTx;
    if (!utx || !utx.id) {
      return {
        id,
        status: 0,
        statusName: UNIVERSAL_TX_STATUS_NAMES[0],
        pcTxHashes: [],
        outboundHashes: [],
        notFound: true,
      };
    }

    const status = (utx.universalStatus ?? 0) as number;
    const statusName =
      UNIVERSAL_TX_STATUS_NAMES[status] ?? `UNKNOWN(${status})`;

    const pcTxHashes = (utx.pcTx ?? [])
      .map((p) => p?.txHash)
      .filter((h): h is string => Boolean(h));

    const outboundHashes: PushChainOutboundSummary[] = (utx.outboundTx ?? []).map(
      (ob) => ({
        subTxId: ob.id ?? '',
        status: outboundStatusName(ob.outboundStatus),
        destinationChain: ob.destinationChain ?? '',
        externalTxHash: ob.observedTx?.txHash || undefined,
        amount: ob.amount,
        recipient: ob.recipient,
      })
    );

    let stuckObservation: PushChainCrossRef['stuckObservation'];
    if (INBOUND_KINDS.has(kind)) {
      if (status === 0) stuckObservation = 'UNSPECIFIED';
      else if (status === 2 && outboundHashes.length === 0)
        stuckObservation = 'PENDING_INBOUND_ONLY';
    }

    return {
      id,
      status,
      statusName,
      pcTxHashes,
      outboundHashes,
      stuckObservation,
    };
  } catch (err) {
    notes.push(
      `push cross-reference failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return undefined;
  }
}

function outboundStatusName(n: number | undefined): string {
  switch (n) {
    case 0:
      return 'OUTBOUND_STATUS_UNSPECIFIED';
    case 1:
      return 'PENDING';
    case 2:
      return 'OBSERVED';
    case 3:
      return 'REVERTED';
    default:
      return `UNKNOWN(${n ?? '?'})`;
  }
}

export const __internalStatusNames = UNIVERSAL_TX_STATUS_NAMES;

/**
 * Re-export the push-side legacy helper (keccak-based; retained for
 * backwards-compat with orchestrator paths that already use it). For accurate
 * universalTxId derivation matching the chain module, use
 * {@link deriveChildUniversalTxId} or {@link derivePcUniversalTxId} from
 * child-inbounds.ts.
 */
export { computeUniversalTxId };
