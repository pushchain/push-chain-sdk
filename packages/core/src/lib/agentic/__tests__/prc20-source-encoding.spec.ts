import { getAddress, zeroAddress } from 'viem';
import { readOriginToken, CORE_ADDRESS } from '../contracts/prc20-metadata';
import { Snapshot } from '../reads/snapshot';
import type { ChainReader } from '../contracts/reader';
import { ADDR } from './fake-chain';

it.each(['string', 'address'] as const)(
  'reads exact non-native source identity from the %s ABI',
  async (encoding) => {
    const readContract = jest.fn(async (request) => {
      const output = request.abi.find(
        (f: { name: string }) => f.name === request.functionName
      ).outputs[0].type;
      if (output !== encoding) throw new Error('different source ABI');
      return ADDR.target;
    });
    const snap = new Snapshot(
      { readContract } as unknown as ChainReader,
      BigInt(123)
    );
    expect(await readOriginToken(snap, ADDR.other, 'eip155:11155111')).toBe(
      getAddress(ADDR.target)
    );
    expect(
      readContract.mock.calls.every(([r]) => r.blockNumber === BigInt(123))
    ).toBe(true);
  }
);
it('accepts an address-word zero only for the registered native gas token', async () => {
  const readContract = jest.fn(async (request) => {
    if (request.address === CORE_ADDRESS) return ADDR.other;
    const output = request.abi.find(
      (f: { name: string }) => f.name === request.functionName
    ).outputs[0].type;
    if (output === 'string') throw new Error('address ABI');
    return zeroAddress;
  });
  const snap = new Snapshot(
    { readContract } as unknown as ChainReader,
    BigInt(123)
  );
  expect(await readOriginToken(snap, ADDR.other, 'eip155:11155111')).toBe(
    zeroAddress
  );
  await expect(
    readOriginToken(snap, ADDR.target, 'eip155:11155111')
  ).rejects.toThrow(/non-native.*empty source/);
});
it('preserves a failed read when neither source encoding can be read', async () => {
  const snap = new Snapshot(
    {
      readContract: async () => {
        throw new Error('rpc offline');
      },
    } as unknown as ChainReader,
    BigInt(123)
  );
  await expect(
    readOriginToken(snap, ADDR.other, 'eip155:11155111')
  ).rejects.toMatchObject({
    details: { blockNumber: BigInt(123), functionName: 'SOURCE_TOKEN_ADDRESS' },
  });
});
