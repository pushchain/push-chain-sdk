/**
 * Stage 2 — resolve child universal-txs spawned by the inbound legs of a
 * destination-chain transaction.
 *
 * The chain derives a universalTxId per inbound log as:
 *   utxId = sha256(`<sourceChainCaip>:<txHash>:<logIndex>`)
 * See push-chain/x/uexecutor/types/keys.go:49-53 (GetInboundUniversalTxKey).
 *
 * For Push-initiated outbounds (pcTx entries) the formula drops the log index:
 *   utxId = sha256(`<pcChainCaip>:<pcTxHash>`)
 * See push-chain/x/uexecutor/types/keys.go:63-67 (GetPcUniversalTxKey).
 *
 * This module derives those ids deterministically and queries cosmos via
 * `pushClient.getUniversalTxByIdV2`, no event-attribute predicate needed.
 */
import { sha256, toBytes, toHex } from 'viem';
import type { PushClient } from '../push-client/push-client';
import type {
  MatchingLog,
  PushChainOutboundSummary,
  UniversalTxDetection,
} from './types';

const STATUS_NAMES: Record<number, string> = {
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

const OUTBOUND_STATUS_NAMES: Record<number, string> = {
  0: 'OUTBOUND_STATUS_UNSPECIFIED',
  1: 'PENDING',
  2: 'OBSERVED',
  3: 'REVERTED',
};

const INBOUND_EVENT_NAMES = new Set([
  'UniversalTx',
  'RevertUniversalTx',
]);

export interface ChildInboundResolution {
  /** Deterministically derived universalTxId for this inbound log. */
  universalTxId: `0x${string}`;
  /** Log that triggered the child inbound. */
  sourceLogIndex: number;
  sourceEventName: string;
  status: number;
  statusName: string;
  /** Push Chain tx hashes that ran the child inbound payload. */
  pcTxHashes: string[];
  /** Any grandchild outbounds spawned from the child inbound. */
  outboundHashes: PushChainOutboundSummary[];
  /** Cosmos has no record for this id (not yet observed / relayer-voted). */
  notFound?: boolean;
}

/**
 * Deterministic child universalTxId for an inbound event on an external chain.
 * Mirrors `GetInboundUniversalTxKey` from the chain module.
 */
export function deriveChildUniversalTxId(
  sourceChainCaip: string,
  externalTxHash: string,
  logIndex: number | string
): `0x${string}` {
  const normHash = externalTxHash.startsWith('0x')
    ? externalTxHash
    : `0x${externalTxHash}`;
  const input = `${sourceChainCaip}:${normHash}:${logIndex}`;
  return sha256(toBytes(input));
}

/**
 * Deterministic universalTxId for a Push-Chain-initiated tx (no log index).
 * Mirrors `GetPcUniversalTxKey` from the chain module.
 */
export function derivePcUniversalTxId(
  pushChainCaip: string,
  pushTxHash: string
): `0x${string}` {
  const normHash = pushTxHash.startsWith('0x') ? pushTxHash : `0x${pushTxHash}`;
  const input = `${pushChainCaip}:${normHash}`;
  return sha256(toBytes(input));
}

/**
 * Given a destination-chain detection, resolve each inbound-log leg by
 * computing its deterministic universalTxId and querying cosmos.
 *
 * Returns one entry per inbound log present in the receipt.
 */
export async function resolveChildInboundsFromDetection(
  pushClient: PushClient,
  detection: UniversalTxDetection,
  diagnostics?: string[]
): Promise<ChildInboundResolution[]> {
  const inboundLogs = detection.detections
    .filter((d) => INBOUND_EVENT_NAMES.has(d.log.eventName))
    .map((d) => d.log);

  return resolveChildInboundsFromLogs(
    pushClient,
    detection.chain,
    detection.txHash,
    inboundLogs,
    diagnostics
  );
}

/**
 * Lower-level variant — resolve children from an explicit list of inbound
 * logs (each with a logIndex).
 */
export async function resolveChildInboundsFromLogs(
  pushClient: PushClient,
  sourceChainCaip: string,
  externalTxHash: string,
  inboundLogs: Pick<MatchingLog, 'eventName' | 'logIndex'>[],
  diagnostics?: string[]
): Promise<ChildInboundResolution[]> {
  const out: ChildInboundResolution[] = [];
  for (const log of inboundLogs) {
    if (log.logIndex < 0) {
      diagnostics?.push(
        `skipped log with negative logIndex (eventName=${log.eventName})`
      );
      continue;
    }
    const utxIdHex = deriveChildUniversalTxId(
      sourceChainCaip,
      externalTxHash,
      log.logIndex
    );
    try {
      const resp = await pushClient.getUniversalTxByIdV2(utxIdHex.slice(2));
      const utx = resp?.universalTx;
      if (!utx || !utx.id) {
        out.push({
          universalTxId: utxIdHex,
          sourceLogIndex: log.logIndex,
          sourceEventName: log.eventName,
          status: 0,
          statusName: STATUS_NAMES[0],
          pcTxHashes: [],
          outboundHashes: [],
          notFound: true,
        });
        continue;
      }
      const status = (utx.universalStatus ?? 0) as number;
      const pcTxHashes = (utx.pcTx ?? [])
        .map((p) => p?.txHash)
        .filter((h): h is string => Boolean(h));
      const outboundHashes: PushChainOutboundSummary[] = (utx.outboundTx ?? []).map(
        (ob) => ({
          subTxId: ob.id ?? '',
          status:
            OUTBOUND_STATUS_NAMES[ob.outboundStatus as number] ??
            `UNKNOWN(${ob.outboundStatus})`,
          destinationChain: ob.destinationChain ?? '',
          externalTxHash: ob.observedTx?.txHash || undefined,
          amount: ob.amount,
          recipient: ob.recipient,
        })
      );
      out.push({
        universalTxId: utxIdHex,
        sourceLogIndex: log.logIndex,
        sourceEventName: log.eventName,
        status,
        statusName: STATUS_NAMES[status] ?? `UNKNOWN(${status})`,
        pcTxHashes,
        outboundHashes,
      });
    } catch (err) {
      diagnostics?.push(
        `getUniversalTxByIdV2(${utxIdHex}) failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      // Cosmos lookup failed (commonly NotFound while the indexer is still
      // catching up). The utxId is deterministically derived from the source
      // log, so surface it as notFound rather than dropping the entry —
      // otherwise callers like inbound-tracker repeatedly re-run the full
      // detector pass instead of advancing to lightweight status polling.
      out.push({
        universalTxId: utxIdHex,
        sourceLogIndex: log.logIndex,
        sourceEventName: log.eventName,
        status: 0,
        statusName: STATUS_NAMES[0],
        pcTxHashes: [],
        outboundHashes: [],
        notFound: true,
      });
    }
  }
  return out;
}

// Debug-only re-export (avoid importing into production paths).
export const __internal = { toHex };
