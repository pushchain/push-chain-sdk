import type { Idl } from '@coral-xyz/anchor';
import { isAnchorIdl } from './ix-encoder';

type AddressKey = `0x${string}`;

const store = new Map<AddressKey, Idl>();

function normalizeKey(address: string): AddressKey {
  if (typeof address !== 'string' || !address.startsWith('0x')) {
    throw new Error(
      `registerIdl: programAddress must be 0x-prefixed 32-byte hex, got '${address}'`
    );
  }
  const body = address.slice(2);
  if (body.length !== 64 || !/^[0-9a-fA-F]+$/.test(body)) {
    throw new Error(
      `registerIdl: programAddress must be 32 bytes (66 chars incl. 0x), got length ${address.length}`
    );
  }
  return ('0x' + body.toLowerCase()) as AddressKey;
}

export function registerIdl(programAddress: string, idl: unknown): void {
  const key = normalizeKey(programAddress);
  if (!isAnchorIdl(idl)) {
    throw new Error(
      `registerIdl: idl for ${programAddress} is not a recognized Anchor IDL (missing 'instructions' or 'address')`
    );
  }
  store.set(key, idl);
}

export function getIdl(programAddress: string): Idl | undefined {
  const key = normalizeKey(programAddress);
  return store.get(key);
}

export function getRegisteredIdls(): Array<{ address: AddressKey; idl: Idl }> {
  return Array.from(store.entries()).map(([address, idl]) => ({ address, idl }));
}

export function clearRegistry(): void {
  store.clear();
}
