import type { Idl } from '@coral-xyz/anchor';
import { isAnchorIdl } from './ix-encoder';
import { toSvmHexAddress, type SvmHexAddress } from './normalize-address';

const store = new Map<SvmHexAddress, Idl>();

export function registerIdl(programAddress: string, idl: unknown): void {
  const key = toSvmHexAddress(programAddress);
  if (!isAnchorIdl(idl)) {
    throw new Error(
      `registerIdl: idl for ${programAddress} is not a recognized Anchor IDL (missing 'instructions' or 'address')`
    );
  }
  store.set(key, idl);
}

export function getIdl(programAddress: string): Idl | undefined {
  const key = toSvmHexAddress(programAddress);
  return store.get(key);
}

export function getRegisteredIdls(): Array<{ address: SvmHexAddress; idl: Idl }> {
  return Array.from(store.entries()).map(([address, idl]) => ({ address, idl }));
}

export function clearRegistry(): void {
  store.clear();
}
