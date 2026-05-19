/**
 * Decoder for revert-error messages surfaced by Cosmos `tx.rawLog`.
 *
 * Two extraction paths:
 *   1. 4-byte custom selector (e.g. `0xacfdb444:` or `0xf4d678b8000000…`) —
 *      looked up against `KNOWN_ERROR_SELECTORS` for a friendly name + hint.
 *   2. `Error(string)` ABI-encoded revert (`0x08c379a0` selector + offset +
 *      length + data) — decoded into the original UTF-8 string.
 *
 * Unknown selectors fall through with `kind: 'unknown'` so callers can log
 * them at INFO and grow the table from real reverts.
 *
 * The selector→name mappings below come from source-verified custom errors
 * where available, with production/e2e observations kept as provenance.
 */

export interface KnownErrorSelector {
  /** Best-effort error name. Worded as a likely cause until source-traced. */
  name: string;
  /** User-facing remediation hint. */
  hint: string;
  /** Where this mapping was first observed (log path or fixture). */
  provenance: string;
}

export const KNOWN_ERROR_SELECTORS: Record<`0x${string}`, KnownErrorSelector> = {
  '0xacfdb444': {
    name: 'ExecutionFailed',
    hint:
      'Likely cause: subcall reverted (target contract or internal gas-swap precompile). ' +
      'Check that the target accepts native value (has receive/fallback) and that calldata matches a valid signature. ' +
      'Note: this selector also fires from internal SDK paths (e.g. fresh-wallet gas-swap) — see route2-fresh-wallet-gas-bug.spec.ts.',
    provenance:
      'Production e2e: e2e-2026-04-09T13-58-42-237Z.log:103 (R2 EVM target revert)',
  },
  '0x179a867c': {
    name: 'ExpiredDeadline',
    hint:
      'Likely cause: transaction deadline passed before relay. Retry — the SDK will set a new deadline.',
    provenance:
      'Production e2e (associated with deadline-related reverts)',
  },
  '0xf4d678b8': {
    name: 'InsufficientBalance',
    hint:
      'Likely cause: the executing account does not hold enough of the token being moved. ' +
      'For Push outbounds, verify the UEA PRC-20 burn-token balance. For CEA→Push routes, verify the source-chain CEA balance.',
    provenance:
      'CommonErrors/CEAErrors.InsufficientBalance(); production e2e: e2e-2026-04-16T16-27-58-082Z.log:342',
  },
  '0xb4fa3fb3': {
    name: 'InvalidInput',
    hint:
      'Likely cause: contract-level input validation failed. For CEA self-calls, the multicall entry must use value=0 and the encoded sendUniversalTxToUEA amount/revertRecipient must be valid.',
    provenance:
      'CommonErrors/CEAErrors.InvalidInput(); observed while replaying failed Route 3 CEA self-call tx 0x6fc0635d76edae0659ff131fd4bbf3349e01946708ce56dc2668d878f34a6077',
  },
  '0x66f9d09e': {
    name: 'GasLimitBelowBase',
    hint:
      'Likely cause: provided gasLimit is below the chain minimum. Omit `gasLimit` to use the per-chain default.',
    provenance:
      'Observed in dev (selector source unverified — see plan §9 #5)',
  },
  '0x05aab006': {
    name: 'GasPriceBelowBase',
    hint:
      'Likely cause: an explicit outbound gasPrice override is below the current UniversalCore base price. ' +
      'Omit gasPrice so the gateway resolves the live base price at execution time.',
    provenance:
      'TypesUGPC/UniversalGatewayPC live Route 2 docs e2e, 2026-05-19: gateway tx 0xe1b549eb47c3cbf1abc69ba6e85927832e482147b49a01a0364206098367dbf7.',
  },
};

/** Selector for `Error(string)` (Solidity `require(false, "msg")`). */
export const ERROR_STRING_SELECTOR = '0x08c379a0' as `0x${string}`;

/** Hard cap on the decoded string length; protects against malformed data. */
const MAX_DECODED_STRING_LEN = 1024;

export type DecodedRevertCustom = {
  kind: 'custom';
  selector: `0x${string}`;
  name: string;
  hint: string;
  provenance: string;
};

export type DecodedRevertString = {
  kind: 'string';
  selector: `0x${string}`;
  decoded: string;
};

export type DecodedRevertUnknown = {
  kind: 'unknown';
  selector: `0x${string}`;
};

export type DecodedRevert =
  | DecodedRevertCustom
  | DecodedRevertString
  | DecodedRevertUnknown;

/**
 * Extracts the first hex blob after `ret ` from a Cosmos tx error message,
 * pulls the 4-byte selector, and looks it up. Returns `null` when no blob
 * is found.
 *
 * **Assumption**: today's Cosmos `tx.rawLog` format contains a single
 * `ret 0x…:` substring per failed message. If a future log format includes
 * nested call traces with multiple `ret` substrings, this regex will pick
 * the first selector — which may not be the most relevant one. Revisit
 * if multi-revert log formats appear in production.
 */
export function decodeRevert(errorMsg: string): DecodedRevert | null {
  if (!errorMsg) return null;
  const m = errorMsg.match(/ret (0x[0-9a-fA-F]+)/);
  if (!m) return null;
  const blob = m[1].toLowerCase();
  if (blob.length < 10) return null;
  const sel = blob.slice(0, 10) as `0x${string}`;

  const entry = KNOWN_ERROR_SELECTORS[sel];
  if (entry) {
    return {
      kind: 'custom',
      selector: sel,
      name: entry.name,
      hint: entry.hint,
      provenance: entry.provenance,
    };
  }

  if (sel === ERROR_STRING_SELECTOR) {
    try {
      const data = blob.slice(10);
      // Error(string) ABI: offset(32 bytes) + length(32 bytes) + data
      // Skip the 32-byte offset (always 0x20).
      const lengthHex = data.slice(64, 128);
      if (lengthHex.length === 64) {
        const length = parseInt(lengthHex, 16);
        if (
          Number.isFinite(length) &&
          length > 0 &&
          length < MAX_DECODED_STRING_LEN
        ) {
          const strHex = data.slice(128, 128 + length * 2);
          if (strHex.length === length * 2) {
            const decoded = Buffer.from(strHex, 'hex').toString('utf8');
            return { kind: 'string', selector: sel, decoded };
          }
        }
      }
    } catch {
      /* fall through to unknown */
    }
  }

  return { kind: 'unknown', selector: sel };
}
