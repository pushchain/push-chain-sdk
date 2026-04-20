/**
 * detectUniversalTxSvm — SVM counterpart to the EVM detector.
 *
 * Fetches the tx via Solana RPC, walks `meta.logMessages`, decodes each
 * `Program data:` entry with Anchor's BorshEventCoder against the gateway
 * IDL, normalizes field names to match classify.ts's EVM-derived shape,
 * and hands the result to the same classifier used by the EVM branch.
 *
 * Behavior deliberately mirrors detector.ts: same UniversalTxDetection
 * return, same universalTxId derivation strategy (primary-log fallback
 * via deriveChildUniversalTxId on source-chain inbounds).
 *
 * Open contract with the push-chain cosmos keeper (documented in the
 * plan): the keeper must derive SVM inbound universalTxIds using the
 * Solana base58 signature verbatim inside `${caip}:${sig}:${logIndex}`.
 * If the keeper uses a different representation (hex bytes, sub_tx_id
 * field, etc.) the `rawSource` argument to deriveChildUniversalTxId below
 * needs to swap — single line.
 */
import { BorshEventCoder } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import type { Connection, TransactionResponse, VersionedTransactionResponse } from '@solana/web3.js';
import { bytesToHex, hexToBytes, sha256, toBytes } from 'viem';
import { bs58 } from '../internal/bs58';

import SVM_GATEWAY_IDL from '../constants/abi/universalGatewayV0.json';
import { CHAIN_INFO } from '../constants/chain';
import { CHAIN } from '../constants/enums';

import { classify, classifyAll } from './classify';
import {
  SVM_EVENT_DISCRIMINATORS,
  SVM_EVENT_FIELD_ALIASES,
  SVM_FIELD_RENAMES,
  discriminatorHex,
} from './svm-events';
import type {
  DetectUniversalTxOptions,
  MatchingLog,
  UniversalTxDetection,
  UniversalTxKind,
} from './types';

const INBOUND_KINDS = new Set<UniversalTxKind>([
  'INBOUND_FROM_EOA',
  'INBOUND_FROM_CEA',
]);

export interface DetectUniversalTxSvmOptions extends DetectUniversalTxOptions {
  /**
   * Injected Solana connection for tests. In production, the detector
   * constructs a Connection from CHAIN_INFO.defaultRPC (or opts.rpcUrls).
   */
  connection?: Connection;
}

/**
 * SVM detector entry. Accepts a base58 Solana signature and returns the
 * same UniversalTxDetection shape as the EVM detector so every downstream
 * consumer (classify, cascade, child-inbounds, inbound-tracker) can treat
 * EVM and SVM results uniformly.
 */
export async function detectUniversalTxSvm(
  signature: string,
  chain: CHAIN,
  opts: DetectUniversalTxSvmOptions = {}
): Promise<UniversalTxDetection> {
  const notes: string[] = [];
  const chainInfo = CHAIN_INFO[chain];
  const castHash = signature as `0x${string}`; // intentional — we widen downstream

  if (!chainInfo) {
    throw new Error(`detectUniversalTxSvm: unknown chain ${chain}`);
  }

  const connection = await resolveConnection(chain, opts);

  // The cascade (and cosmos) stores Solana signatures as 0x-prefixed hex of
  // the 64-byte signature bytes. Solana RPC needs base58 — normalize here
  // so callers can pass either form interchangeably.
  const rpcSig = normalizeSolanaSignature(signature);

  let tx: TransactionResponse | VersionedTransactionResponse | null;
  try {
    tx = await connection.getTransaction(rpcSig, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
  } catch (err) {
    notes.push(
      `svm tx fetch failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return emptyDetection(castHash, chain, notes);
  }

  if (!tx || !tx.meta) {
    notes.push('no svm tx returned by RPC');
    return emptyDetection(castHash, chain, notes);
  }

  // Reverted with no logs — same early-out as EVM path.
  const err = (tx.meta as { err?: unknown }).err;
  const logMessages: string[] = (tx.meta.logMessages ?? []) as string[];
  if (err && logMessages.length === 0) {
    notes.push('svm tx reverted with no logs');
    return emptyDetection(castHash, chain, notes);
  }

  // Emitter for SVM is the gateway program id from CHAIN_INFO.
  // Encoded as 0x-prefixed 32-byte hex so MatchingLog.address stays
  // assignable to the `0x${string}` type without widening.
  const emitterBase58 = chainInfo.lockerContract || '';
  let emitter: `0x${string}` = '0x';
  if (emitterBase58 && emitterBase58 !== 'TBD') {
    try {
      emitter = bytesToHex(new PublicKey(emitterBase58).toBytes());
    } catch {
      emitter = '0x';
    }
  }

  const eventCoder = new BorshEventCoder(SVM_GATEWAY_IDL as never);
  const matchingLogs: MatchingLog[] = [];

  // Walk logMessages for `Program data:` entries. Each matched event gets
  // assigned an ordinal logIndex — its position among matching events.
  // This is the deterministic integer the cosmos keeper is expected to use
  // when it derives an inbound universalTxId for SVM sources.
  let ordinal = 0;
  for (const rawLog of logMessages) {
    if (typeof rawLog !== 'string') continue;
    const prefix = 'Program data: ';
    if (!rawLog.startsWith(prefix)) continue;
    const base64Data = rawLog.slice(prefix.length).trim();

    // Fast discriminator check — skip non-universal events without running
    // the full Borsh decode.
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(Buffer.from(base64Data, 'base64'));
    } catch {
      continue;
    }
    const disc = discriminatorHex(bytes);
    const eventName = SVM_EVENT_DISCRIMINATORS[disc];
    if (!eventName) continue;

    // BorshEventCoder can throw when the on-chain layout drifts from the
    // bundled IDL (seen with older UniversalTx emissions). Isolate the
    // failure to this event so the rest of the matching logs still surface.
    let decoded: { name: string; data: unknown } | null = null;
    try {
      decoded = eventCoder.decode(base64Data);
    } catch (e) {
      notes.push(
        `svm: borsh decode threw for ${eventName}: ${e instanceof Error ? e.message : String(e)}`
      );
      continue;
    }
    if (!decoded || decoded.name !== eventName) {
      notes.push(`svm: discriminator matched ${eventName} but borsh decode failed`);
      continue;
    }

    const args = normalizeSvmEventArgs(eventName, decoded.data);
    matchingLogs.push({
      eventName,
      address: emitter,
      logIndex: ordinal,
      args,
    });
    ordinal += 1;
  }

  if (matchingLogs.length === 0) {
    notes.push('svm tx has no decoded universal-tx events');
    return emptyDetection(castHash, chain, notes);
  }

  const classified = classify(matchingLogs);
  notes.push(...classified.notes);

  const decoded = { ...classified.decoded };

  // Inbound fallback for universalTxId: same formula the EVM branch uses,
  // but the raw signature flows through untouched (no 0x-prefix rewrite,
  // see deriveSvmChildUniversalTxId in child-inbounds.ts).
  if (!decoded.universalTxId) {
    const caip: string = chain;
    if (
      INBOUND_KINDS.has(classified.kind) &&
      classified.primaryLog &&
      classified.primaryLog.logIndex >= 0
    ) {
      // Use the hex form (matches cosmos keeper's on-chain storage).
      const hexSig = solanaSigToHex(rpcSig);
      const input = `${caip}:${hexSig}:${classified.primaryLog.logIndex}`;
      decoded.universalTxId = sha256(toBytes(input));
      notes.push(
        `universalTxId derived via sha256("${caip}:<hexSig>:${classified.primaryLog.logIndex}") — svm`
      );
    }
  }

  const detections = classifyAll(classified.matchingLogs);

  return {
    txHash: castHash,
    chain,
    kind: classified.kind,
    emitters: classified.emitters,
    decoded,
    matchingLogs: classified.matchingLogs,
    detections,
    // SVM detector doesn't do the cosmos cross-reference itself; upstream
    // (orchestrator / cascade) already does its own lookup when needed.
    notes,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

async function resolveConnection(
  chain: CHAIN,
  opts: DetectUniversalTxSvmOptions
): Promise<Connection> {
  if (opts.connection) return opts.connection;

  const info = CHAIN_INFO[chain];
  const rpcUrls =
    opts.rpcUrls?.[chain] && opts.rpcUrls[chain]!.length > 0
      ? opts.rpcUrls[chain]!
      : (info?.defaultRPC ?? []).filter((r) => r && r.length > 0);

  if (rpcUrls.length === 0) {
    throw new Error(`detectUniversalTxSvm: no RPC URL configured for ${chain}`);
  }

  // Lazy import to avoid a top-level dependency cycle through @solana/web3.js
  // for consumers of the EVM-only path.
  const { Connection } = await import('@solana/web3.js');
  return new Connection(rpcUrls[0], 'confirmed');
}

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

/**
 * Convert an Anchor-decoded event struct into the shape classify.ts expects.
 *
 *  - snake_case → camelCase for known keys (subTxId, universalTxId, etc.)
 *  - PublicKey → `0x${hex}` 32-byte string
 *  - Buffer/Uint8Array fixed arrays → `0x${hex}`
 *  - BN/bigint numerics → bigint
 *  - Anchor enum objects for tx_type → numeric variant index
 *  - Event-specific aliases (UniversalTxFinalized.payload → data,
 *    RevertUniversalTx.revertRecipient → to) so downstream switch arms find
 *    the expected keys.
 */
function normalizeSvmEventArgs(
  eventName: string,
  raw: unknown
): Record<string, unknown> {
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [srcKey, value] of Object.entries(src)) {
    const renamed = SVM_FIELD_RENAMES[srcKey] ?? srcKey;
    out[renamed] = coerceArgValue(srcKey, renamed, value);
  }

  const aliases = SVM_EVENT_FIELD_ALIASES[eventName] ?? [];
  for (const { from, to } of aliases) {
    if (out[to] === undefined && out[from] !== undefined) {
      out[to] = out[from];
    }
  }

  return out;
}

function coerceArgValue(
  srcKey: string,
  renamedKey: string,
  value: unknown
): unknown {
  // Anchor returns PublicKey instances for `pubkey` types. Normalize to
  // `0x${hex}` so asAddress() in classify.ts accepts them.
  if (value && typeof value === 'object' && value instanceof PublicKey) {
    return bytesToHex(value.toBytes());
  }

  // Fixed-size byte arrays (u8; N) come through as Buffer/Uint8Array.
  if (
    value &&
    typeof value === 'object' &&
    (value instanceof Uint8Array ||
      (globalThis.Buffer && value instanceof globalThis.Buffer))
  ) {
    return bytesToHex(new Uint8Array(value as Uint8Array));
  }

  // Some @coral-xyz/anchor versions return `array:[u8,N]` fields as plain
  // number arrays rather than Buffers. Treat a homogeneous byte-array
  // exactly like a Uint8Array here.
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === 'number' && v >= 0 && v <= 255)
  ) {
    return bytesToHex(new Uint8Array(value as number[]));
  }

  // BN from anchor — has toString().
  if (value && typeof value === 'object' && typeof (value as { toString: () => string }).toString === 'function') {
    const proto = Object.getPrototypeOf(value);
    const ctorName = proto?.constructor?.name;
    if (ctorName === 'BN') {
      try {
        return BigInt((value as { toString: (r?: number) => string }).toString(10));
      } catch {
        return undefined;
      }
    }
  }

  // Anchor enum → { [variantName]: {} }. tx_type must be surfaced as a
  // numeric index to match classify.ts's setTxType expectations.
  if (renamedKey === 'txType' && value && typeof value === 'object' && !Array.isArray(value)) {
    return extractTxTypeIndex(value as Record<string, unknown>);
  }

  return value;
}

/**
 * Resolve a Borsh-decoded Anchor enum value into its numeric variant index.
 *
 * The SVM IDL `TxType` enum is declared in the same order as the EVM solidity
 * enum (GAS, GAS_AND_PAYLOAD, FUNDS, FUNDS_AND_PAYLOAD, RESCUE_FUNDS), so a
 * positional lookup suffices.
 */
const TX_TYPE_ORDER = [
  'gas',
  'gasAndPayload',
  'funds',
  'fundsAndPayload',
  'rescueFunds',
];

function extractTxTypeIndex(v: Record<string, unknown>): number | undefined {
  const key = Object.keys(v)[0];
  if (!key) return undefined;
  const norm = key.toLowerCase();
  const i = TX_TYPE_ORDER.findIndex((k) => k.toLowerCase() === norm);
  return i < 0 ? undefined : i;
}

/**
 * Accept either a base58 Solana signature (native form) or a 0x-prefixed
 * 128-char hex of the 64-byte signature bytes (the form used by cosmos
 * keeper storage and by the cascade walker when it hands off an
 * `observedTx.txHash`). Return the base58 form the RPC expects.
 */
function normalizeSolanaSignature(input: string): string {
  if (input.startsWith('0x') && input.length === 2 + 128) {
    return bs58.encode(hexToBytes(input as `0x${string}`));
  }
  return input;
}

function solanaSigToHex(base58Sig: string): `0x${string}` {
  return bytesToHex(bs58.decode(base58Sig));
}

export const __svmInternal = {
  normalizeSvmEventArgs,
  extractTxTypeIndex,
  normalizeSolanaSignature,
  solanaSigToHex,
};
