import type { Idl } from '@coral-xyz/anchor';
import { isAnchorIdl } from './ix-encoder';
import { toSvmHexAddress, type SvmHexAddress } from './normalize-address';

const store = new Map<SvmHexAddress, Idl>();

/**
 * Register an Anchor IDL so the SDK can resolve accounts, PDAs, and CEA
 * authorities when building SVM gateway payloads.
 *
 * Normal usage never needs this — `PushChain.utils.helpers.encodeTxData`
 * auto-registers the IDL whenever you pass it as `abi`. Use this only when
 * building `data` manually (raw discriminator + Borsh bytes).
 *
 * The program address is pulled from `idl.address` (Anchor ≥ 0.30 spec).
 */
export function registerIdl(idl: unknown): void {
  if (!isAnchorIdl(idl)) {
    throw new Error(
      `registerIdl: input is not a recognized Anchor IDL (missing 'instructions' or 'address')`
    );
  }
  const key = toSvmHexAddress(idl.address);
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
