/**
 * Pure classification: parsed-logs → kind + decoded identifiers.
 *
 * Split from detector.ts so unit specs can hit this with hand-rolled fixtures
 * without touching viem or the SDK's PushClient.
 */
import type { Hex } from 'viem';
import type { KnownEventName } from './events';
import type {
  DecodedIdentifiers,
  MatchingLog,
  TxTypeName,
  UniversalTxKind,
} from './types';

/**
 * TX_TYPE enum from push-chain-gateway-contracts/src/libraries/Types.sol:5-22.
 */
const TX_TYPE_NAMES: Record<number, TxTypeName> = {
  0: 'GAS',
  1: 'GAS_AND_PAYLOAD',
  2: 'FUNDS',
  3: 'FUNDS_AND_PAYLOAD',
  4: 'RESCUE_FUNDS',
};

/**
 * Priority order: the first match wins. Mirrors the plan doc.
 */
const CLASSIFICATION_PRIORITY: Array<{
  eventName: KnownEventName;
  kind: UniversalTxKind | ((args: Record<string, unknown>) => UniversalTxKind);
}> = [
  { eventName: 'UniversalTxFinalized', kind: 'OUTBOUND_FINALIZED' },
  { eventName: 'UniversalTxReverted', kind: 'OUTBOUND_REVERTED' },
  { eventName: 'UniversalTxOutbound', kind: 'OUTBOUND_INITIATED' },
  { eventName: 'RevertUniversalTx', kind: 'INBOUND_REVERTED' },
  {
    eventName: 'UniversalTx',
    kind: (args) =>
      args['fromCEA'] === true ? 'INBOUND_FROM_CEA' : 'INBOUND_FROM_EOA',
  },
  { eventName: 'UniversalTxExecuted', kind: 'EXECUTED_ON_DEST' },
  { eventName: 'FundsRescued', kind: 'RESCUED_FUNDS' },
];

export interface ClassifyResult {
  kind: UniversalTxKind;
  decoded: DecodedIdentifiers;
  matchingLogs: MatchingLog[];
  emitters: `0x${string}`[];
  notes: string[];
  /** The log that determined the kind (for downstream enrichment). */
  primaryLog?: MatchingLog;
}

export interface DetectionEntry {
  kind: UniversalTxKind;
  decoded: DecodedIdentifiers;
  log: MatchingLog;
}

export function classify(parsedLogs: MatchingLog[]): ClassifyResult {
  const emitters = Array.from(new Set(parsedLogs.map((l) => l.address)));

  if (parsedLogs.length === 0) {
    return {
      kind: 'UNKNOWN',
      decoded: {},
      matchingLogs: [],
      emitters: [],
      notes: ['no universal-tx events decoded'],
    };
  }

  for (const { eventName, kind } of CLASSIFICATION_PRIORITY) {
    const hit = parsedLogs.find((l) => l.eventName === eventName);
    if (!hit) continue;
    const resolvedKind =
      typeof kind === 'function' ? kind(hit.args) : kind;
    const decoded = buildDecoded(resolvedKind, hit, parsedLogs);
    return {
      kind: resolvedKind,
      decoded,
      matchingLogs: parsedLogs,
      emitters,
      notes: [],
      primaryLog: hit,
    };
  }

  return {
    kind: 'UNKNOWN',
    decoded: {},
    matchingLogs: parsedLogs,
    emitters,
    notes: ['no known universal-tx event among decoded logs'],
  };
}

// ── Identifier extraction ─────────────────────────────────────────────

function buildDecoded(
  kind: UniversalTxKind,
  primary: MatchingLog,
  allLogs: MatchingLog[]
): DecodedIdentifiers {
  const out: DecodedIdentifiers = {};
  const a = primary.args;

  assignHex(out, 'subTxId', a['subTxId']);
  assignHex(out, 'universalTxId', a['universalTxId']);

  switch (primary.eventName) {
    case 'UniversalTx':
      out.sender = asAddress(a['sender']);
      out.recipient = asAddress(a['recipient']);
      out.token = asAddress(a['token']);
      out.amount = asBigint(a['amount']);
      setPayload(out, a['payload']);
      out.revertRecipient = asAddress(a['revertRecipient']);
      setTxType(out, a['txType']);
      out.fromCEA = Boolean(a['fromCEA']);
      break;

    case 'UniversalTxExecuted':
      out.pushAccount = asAddress(a['pushAccount']);
      out.token = asAddress(a['token']);
      out.amount = asBigint(a['amount']);
      setPayload(out, a['data']);
      break;

    case 'RevertUniversalTx':
      out.recipient = asAddress(a['to']);
      out.token = asAddress(a['token']);
      out.amount = asBigint(a['amount']);
      setRevertInstruction(out, a['revertInstruction']);
      break;

    case 'FundsRescued':
      out.token = asAddress(a['token']);
      out.amount = asBigint(a['amount']);
      setRevertInstruction(out, a['revertInstruction']);
      break;

    case 'UniversalTxFinalized':
      out.pushAccount = asAddress(a['pushAccount']);
      out.recipient = asAddress(a['recipient']);
      out.token = asAddress(a['token']);
      out.amount = asBigint(a['amount']);
      setPayload(out, a['data']);
      break;

    case 'UniversalTxReverted':
      out.token = asAddress(a['token']);
      out.amount = asBigint(a['amount']);
      setRevertInstruction(out, a['revertInstruction']);
      break;

    case 'UniversalTxOutbound':
      out.sender = asAddress(a['sender']);
      out.token = asAddress(a['token']);
      out.amount = asBigint(a['amount']);
      if (typeof a['recipient'] === 'string') {
        out.recipient = a['recipient'];
      }
      setPayload(out, a['payload']);
      if (typeof a['chainNamespace'] === 'string') {
        out.destinationChainNamespace = a['chainNamespace'];
      }
      out.gasFee = asBigint(a['gasFee']);
      out.gasLimit = asBigint(a['gasLimit']);
      out.protocolFee = asBigint(a['protocolFee']);
      out.revertRecipient = asAddress(a['revertRecipient']);
      setTxType(out, a['txType']);
      break;
  }

  // Enrichment: OUTBOUND_FINALIZED receipts usually also carry a UniversalTxExecuted
  // fired by the CEA during the inner call. Use it to surface extra fields when
  // the primary log was sparse.
  if (kind === 'OUTBOUND_FINALIZED') {
    const executed = allLogs.find((l) => l.eventName === 'UniversalTxExecuted');
    if (executed && !out.pushAccount) {
      out.pushAccount = asAddress(executed.args['pushAccount']);
    }
  }

  return out;
}

// ── Type coercers ─────────────────────────────────────────────────────

function asAddress(v: unknown): `0x${string}` | undefined {
  return typeof v === 'string' && v.startsWith('0x')
    ? (v as `0x${string}`)
    : undefined;
}

function asBigint(v: unknown): bigint | undefined {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  if (typeof v === 'string') {
    try {
      return BigInt(v);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function assignHex(
  out: DecodedIdentifiers,
  key: 'subTxId' | 'universalTxId',
  v: unknown
): void {
  if (typeof v === 'string' && v.startsWith('0x')) {
    out[key] = v as `0x${string}`;
  }
}

function setTxType(out: DecodedIdentifiers, raw: unknown): void {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'bigint'
      ? Number(raw)
      : undefined;
  if (n === undefined) return;
  out.txType = n;
  out.txTypeName = TX_TYPE_NAMES[n] ?? 'UNKNOWN';
}

function setPayload(out: DecodedIdentifiers, raw: unknown): void {
  if (typeof raw !== 'string' || !raw.startsWith('0x')) return;
  const hex = raw as Hex;
  // byte-length = (hex.length - 2) / 2
  out.payloadLength = Math.max(0, (hex.length - 2) / 2);
  out.payloadPreview = (hex.slice(0, 2 + 64) as `0x${string}`); // 32 bytes hex
}

function setRevertInstruction(
  out: DecodedIdentifiers,
  raw: unknown
): void {
  if (!raw) return;
  // viem decodes a (address,bytes) tuple as either an object with named keys
  // (when ABI has components with names) or a positional array.
  if (Array.isArray(raw)) {
    const [recipient, msg] = raw as [unknown, unknown];
    out.revertRecipient = asAddress(recipient);
    if (typeof msg === 'string' && msg.startsWith('0x')) {
      out.revertMsgPreview = (msg.slice(0, 2 + 64) as `0x${string}`);
    }
  } else if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    out.revertRecipient = asAddress(obj['revertRecipient']);
    const msg = obj['revertMsg'];
    if (typeof msg === 'string' && msg.startsWith('0x')) {
      out.revertMsgPreview = (msg.slice(0, 2 + 64) as `0x${string}`);
    }
  }
}

/**
 * Per-log classification. Each matching universal-tx log yields one detection
 * entry — so a receipt carrying `UniversalTxFinalized` + a CEA-originated
 * `UniversalTx(fromCEA=true)` produces two entries.
 *
 * Unknown event names are dropped (they wouldn't have reached this stage
 * anyway — parseEventLogs only emits logs that matched the ABI).
 */
export function classifyAll(logs: MatchingLog[]): DetectionEntry[] {
  const kindByEventName = new Map<
    KnownEventName,
    UniversalTxKind | ((args: Record<string, unknown>) => UniversalTxKind)
  >(
    CLASSIFICATION_PRIORITY.map(({ eventName, kind }) => [eventName, kind])
  );

  const out: DetectionEntry[] = [];
  for (const log of logs) {
    const resolver = kindByEventName.get(log.eventName as KnownEventName);
    if (!resolver) continue;
    const kind =
      typeof resolver === 'function' ? resolver(log.args) : resolver;
    out.push({ kind, decoded: buildDecoded(kind, log, logs), log });
  }
  return out;
}

export const __internal = { TX_TYPE_NAMES, CLASSIFICATION_PRIORITY };
