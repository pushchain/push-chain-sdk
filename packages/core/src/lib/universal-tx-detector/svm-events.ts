/**
 * SVM-side universal-tx event metadata.
 *
 * Current Anchor programs emit events through `emit_cpi!`: an inner
 * instruction whose data is EVENT_IX_TAG || event discriminator || Borsh
 * body. Older deployments emitted the discriminator + body as a base64
 * `Program data:` log line. Helpers in this module support both transports.
 */

import { PublicKey } from '@solana/web3.js';
import { bs58 } from '../internal/bs58';

export const SVM_EVENT_IX_TAG = Uint8Array.from([
  0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d,
]);

export interface SvmGatewayEventPayload {
  /** Base64 discriminator + Borsh body accepted by BorshEventCoder. */
  base64Data: string;
  /** Gateway-event ordinal used by the Push keeper as log_index. */
  eventIndex: number;
}

/**
 * Extract authenticated gateway events from Anchor `emit_cpi!` inner
 * instructions. Only self-CPIs whose program id equals `gatewayAddress` are
 * accepted; matching a discriminator alone is not proof of the emitter.
 */
export function getSvmEventCpiPayloads(
  txResp: any,
  gatewayAddress: string
): SvmGatewayEventPayload[] {
  const groups = txResp?.meta?.innerInstructions;
  if (!Array.isArray(groups) || groups.length === 0) return [];

  let gateway: PublicKey;
  try {
    gateway = new PublicKey(gatewayAddress);
  } catch {
    return [];
  }

  const message = txResp?.transaction?.message;
  const loadedAddresses = txResp?.meta?.loadedAddresses;
  const accountKeyAt = (index: number): PublicKey | undefined => {
    try {
      if (typeof message?.getAccountKeys === 'function') {
        return message
          .getAccountKeys({
            accountKeysFromLookups: loadedAddresses,
          })
          .get(index);
      }

      const keys = [
        ...(message?.accountKeys ?? message?.staticAccountKeys ?? []),
        ...(loadedAddresses?.writable ?? []),
        ...(loadedAddresses?.readonly ?? loadedAddresses?.readOnly ?? []),
      ];
      const key = keys[index];
      return key instanceof PublicKey
        ? key
        : key
        ? new PublicKey(key)
        : undefined;
    } catch {
      return undefined;
    }
  };

  const payloads: SvmGatewayEventPayload[] = [];
  for (const group of groups) {
    for (const instruction of group?.instructions ?? []) {
      const programId = accountKeyAt(Number(instruction?.programIdIndex));
      if (
        !programId?.equals(gateway) ||
        typeof instruction?.data !== 'string'
      ) {
        continue;
      }

      let raw: Uint8Array;
      try {
        raw = bs58.decode(instruction.data);
      } catch {
        continue;
      }
      if (
        raw.length < SVM_EVENT_IX_TAG.length + 8 ||
        !SVM_EVENT_IX_TAG.every((byte, i) => raw[i] === byte)
      ) {
        continue;
      }

      payloads.push({
        base64Data: Buffer.from(raw.subarray(SVM_EVENT_IX_TAG.length)).toString(
          'base64'
        ),
        eventIndex: payloads.length,
      });
    }
  }
  return payloads;
}

const toHex = (bytes: number[]): string =>
  bytes.map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Mapping: 8-byte discriminator (lowercase hex, no 0x) → Anchor event name.
 * Only events with EVM classifier parity are listed; the keeper-agnostic
 * ones (BlockUsdCapUpdated, inbound-fee events, etc.) are intentionally
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
