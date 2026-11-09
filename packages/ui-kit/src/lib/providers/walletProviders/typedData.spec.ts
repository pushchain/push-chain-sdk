import { hashTypedData } from 'viem';
import { ITypedData } from '../../types/wallet.types';
import { toSignTypedDataV4Payload } from './typedData';

const universalPayload: ITypedData = {
  domain: {
    version: '0.1.0',
    chainId: 11155111,
    verifyingContract: '0x1111111111111111111111111111111111111111',
  },
  types: {
    UniversalPayload: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
  },
  primaryType: 'UniversalPayload',
  message: { to: '0x2222222222222222222222222222222222222222', value: BigInt(5) },
};

const ownerIntent: ITypedData = {
  domain: {
    name: 'AGWFactory',
    version: '1',
    chainId: 11155111,
    verifyingContract: '0x3333333333333333333333333333333333333333',
    salt: '0x00000000000000000000000000000000000000000000000000000000000a5dc2',
  },
  types: {
    OwnerIntent: [
      { name: 'owner', type: 'address' },
      { name: 'nonceKey', type: 'uint192' },
      { name: 'deadline', type: 'uint48' },
    ],
  },
  primaryType: 'OwnerIntent',
  message: {
    owner: '0x4444444444444444444444444444444444444444',
    nonceKey: BigInt(2) ** BigInt(100),
    deadline: 1_800_000_000,
  },
};

/** The digest a wallet computes from the JSON it receives. */
const walletDigest = (payload: string) => {
  const { domain, types, primaryType, message } = JSON.parse(payload);
  const { EIP712Domain: _, ...rest } = types;
  return hashTypedData({ domain, types: rest, primaryType, message });
};

describe('toSignTypedDataV4Payload', () => {
  it('keeps the SDK payload domain as version, chainId, verifyingContract', () => {
    const parsed = JSON.parse(toSignTypedDataV4Payload(universalPayload));
    expect(parsed.types.EIP712Domain).toEqual([
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ]);
    expect(walletDigest(toSignTypedDataV4Payload(universalPayload))).toBe(hashTypedData(universalPayload as never));
  });

  it('keeps caller types for any primary type and every domain field', () => {
    const parsed = JSON.parse(toSignTypedDataV4Payload(ownerIntent));
    expect(parsed.types.OwnerIntent).toEqual(ownerIntent.types['OwnerIntent']);
    expect(parsed.types.EIP712Domain.map((f: { name: string }) => f.name)).toEqual([
      'name',
      'version',
      'chainId',
      'verifyingContract',
      'salt',
    ]);
    expect(walletDigest(toSignTypedDataV4Payload(ownerIntent))).toBe(hashTypedData(ownerIntent as never));
  });

  it('serialises bigints and does not mutate the input', () => {
    const before = JSON.stringify(ownerIntent.types);
    const parsed = JSON.parse(toSignTypedDataV4Payload(ownerIntent));
    expect(parsed.message.nonceKey).toBe((BigInt(2) ** BigInt(100)).toString());
    expect(JSON.stringify(ownerIntent.types)).toBe(before);
  });

  it('respects an EIP712Domain the caller declares', () => {
    const declared = [{ name: 'chainId', type: 'uint256' }];
    const parsed = JSON.parse(
      toSignTypedDataV4Payload({
        ...universalPayload,
        types: { ...universalPayload.types, EIP712Domain: declared } as unknown as ITypedData['types'],
      })
    );
    expect(parsed.types.EIP712Domain).toEqual(declared);
  });
});
