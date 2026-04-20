import { bs58 } from '../../internal/bs58';

/**
 * Canonical internal form of a Solana program / account address.
 * All validation and payload paths key off this `0x`-prefixed 32-byte hex string.
 */
export type SvmHexAddress = `0x${string}`;

const HEX_FORM = /^0x[0-9a-fA-F]{64}$/;

/**
 * Normalize an SVM address supplied by an end user to the internal `0x`-prefixed
 * 32-byte hex form. Accepts either:
 *   - `0x`-prefixed 64-hex-char string (the internal form), or
 *   - base58 string that decodes to exactly 32 bytes (the native Solana form).
 *
 * Throws with a message naming both accepted forms if the input matches neither.
 */
export function toSvmHexAddress(input: unknown): SvmHexAddress {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error(
      `SVM address must be a non-empty string (base58 or 0x-prefixed 32-byte hex), got ${typeof input}`
    );
  }

  if (input.startsWith('0x')) {
    if (!HEX_FORM.test(input)) {
      throw new Error(
        `SVM address in hex form must be 0x + 64 hex chars (32 bytes), got '${input}' (length ${input.length})`
      );
    }
    return input.toLowerCase() as SvmHexAddress;
  }

  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(input);
  } catch {
    throw new Error(
      `SVM address '${input}' is not valid base58 and does not start with 0x. ` +
        `Expected base58 (e.g. 'So11111111111111111111111111111111111111112') ` +
        `or 0x-prefixed 32-byte hex.`
    );
  }

  if (decoded.length !== 32) {
    throw new Error(
      `SVM address '${input}' decodes to ${decoded.length} bytes; expected 32.`
    );
  }

  let hex = '0x';
  for (let i = 0; i < decoded.length; i++) {
    hex += decoded[i].toString(16).padStart(2, '0');
  }
  return hex as SvmHexAddress;
}

/**
 * Predicate form of {@link toSvmHexAddress} — returns true if the input is a
 * valid SVM address in either accepted form.
 */
export function isValidSvmAddress(input: unknown): boolean {
  try {
    toSvmHexAddress(input);
    return true;
  } catch {
    return false;
  }
}
