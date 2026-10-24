import type { Hex } from 'viem';
export interface ArgPinWire {
  offset: number;
  op: 0 | 1;
  value: Hex;
}
export const ARG_PIN_COMPONENTS = [
  { name: 'offset', type: 'uint16' },
  { name: 'op', type: 'uint8' },
  { name: 'value', type: 'bytes32' },
] as const;
export const UNLIMITED_CALLS = 0xffffffff;
export const ANY_ACCOUNT_COUNT = 255;

/** Validate every encoded constraint before signing. */
export function validatePins(pins: readonly ArgPinWire[]): void {
  if (!Array.isArray(pins) || pins.length > 8)
    throw new Error('pins must contain at most eight constraints');
  const seen = new Set<number>();
  for (const p of pins) {
    if (
      !Number.isInteger(p.offset) ||
      p.offset < 4 ||
      p.offset + 32 > 65535 ||
      ![0, 1].includes(p.op) ||
      !/^0x[0-9a-fA-F]{64}$/.test(p.value)
    )
      throw new Error('invalid argument pin');
    if (seen.has(p.offset)) throw new Error('duplicate pin offset');
    seen.add(p.offset);
  }
}
