/**
 * SVM-side universal-tx event metadata.
 *
 * Anchor programs emit events as base64-encoded `Program data:` log lines
 * prefixed with an 8-byte discriminator. The map below covers the four SVM
 * gateway events that have EVM parity (source: universalGatewayV0.json
 * events section). The discriminator bytes come from the IDL and are
 * converted to lowercase hex for matching.
 */

const toHex = (bytes: number[]): string =>
  bytes.map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Mapping: 8-byte discriminator (lowercase hex, no 0x) → Anchor event name.
 * Only events with EVM classifier parity are listed; the keeper-agnostic
 * ones (BlockUsdCapUpdated, ProtocolFeeCollected, etc.) are intentionally
 * skipped — they wouldn't classify to any UniversalTxKind anyway.
 */
export const SVM_EVENT_DISCRIMINATORS: Record<string, string> = {
  [toHex([108, 154, 216, 41, 181, 234, 29, 124])]: 'UniversalTx',
  [toHex([179, 64, 150, 112, 117, 140, 156, 37])]: 'UniversalTxFinalized',
  [toHex([249, 74, 39, 203, 149, 54, 48, 186])]: 'RevertUniversalTx',
  [toHex([159, 37, 6, 93, 98, 122, 176, 210])]: 'FundsRescued',
};

/**
 * Classifier field names from classify.ts use EVM-style camelCase
 * (`subTxId`, `universalTxId`, `revertRecipient`, `fromCEA`, `txType`).
 * SVM IDL fields are snake_case. This helper renames the subset that
 * classify.ts reads so the shared decoder logic works unchanged.
 *
 * The mapping is event-agnostic: keys that don't appear in a given event
 * are simply absent from the input and ignored.
 */
export const SVM_FIELD_RENAMES: Record<string, string> = {
  sub_tx_id: 'subTxId',
  universal_tx_id: 'universalTxId',
  revert_recipient: 'revertRecipient',
  push_account: 'pushAccount',
  from_cea: 'fromCEA',
  tx_type: 'txType',
  signature_data: 'signatureData',
};

/**
 * Event-specific field aliases.
 *
 * EVM `UniversalTxFinalized` exposes the payload blob as `data`; on SVM
 * the field is named `payload`. EVM `RevertUniversalTx` exposes the
 * recipient as `to`; SVM names it `revert_recipient` (already renamed
 * to `revertRecipient` via SVM_FIELD_RENAMES). We add both aliases so
 * classify.ts's event-specific switch finds them under the expected key.
 */
export const SVM_EVENT_FIELD_ALIASES: Record<
  string,
  Array<{ from: string; to: string }>
> = {
  UniversalTxFinalized: [{ from: 'payload', to: 'data' }],
  RevertUniversalTx: [{ from: 'revertRecipient', to: 'to' }],
};

/** Lowercase hex discriminator from an Anchor program-data decoded buffer. */
export function discriminatorHex(buf: Uint8Array): string {
  if (buf.length < 8) return '';
  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += buf[i].toString(16).padStart(2, '0');
  }
  return hex;
}
