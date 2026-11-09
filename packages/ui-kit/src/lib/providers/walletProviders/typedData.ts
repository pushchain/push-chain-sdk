import { ITypedData } from '../../types/wallet.types';

/**
 * EIP-712 domain fields in the order the spec, viem and ethers use. The
 * `EIP712Domain` type must list exactly the fields the domain sets, in this
 * order, or the wallet hashes a different domain separator than the verifier.
 */
const DOMAIN_FIELDS = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
  { name: 'salt', type: 'bytes32' },
] as const;

/**
 * The JSON payload for `eth_signTypedData_v4`.
 *
 * Keeps every type the caller declared, so any primary type can be signed, and
 * derives `EIP712Domain` from the domain fields that are present unless the
 * caller declared it. Bigints become decimal strings, since JSON has no bigint.
 */
export function toSignTypedDataV4Payload(typedData: ITypedData): string {
  const domain = (typedData.domain ?? {}) as Record<string, unknown>;
  const declaredDomain = (typedData.types as Record<string, unknown>)['EIP712Domain'];
  const EIP712Domain =
    declaredDomain ?? DOMAIN_FIELDS.filter((field) => domain[field.name] !== undefined);

  return JSON.stringify(
    { ...typedData, types: { ...typedData.types, EIP712Domain } },
    (_key, value) => (typeof value === 'bigint' ? value.toString() : value)
  );
}
