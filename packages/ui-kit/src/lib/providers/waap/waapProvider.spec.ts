import type { ITypedData } from '../../../lib/types';
import { waapSignTypedData } from './waapProvider';

const SIGNATURE =
  '0x1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c';

const request = jest.fn();

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue(SIGNATURE);
  (globalThis as any).window = { waap: { request } };
});

afterEach(() => {
  delete (globalThis as any).window;
});

/** The payload the params that reach `eth_signTypedData_v4` were serialized from. */
const sentTypedData = () => {
  const call = request.mock.calls
    .map(([arg]) => arg)
    .find((arg) => arg?.method === 'eth_signTypedData_v4');
  if (!call) throw new Error('eth_signTypedData_v4 was never called');
  return JSON.parse(call.params[1] as string);
};

describe('waapSignTypedData', () => {
  it('serializes bigint uint256 fields in a UniversalPayload', async () => {
    // Mirrors the `universalPayload` built in Core's payload-builder, which
    // leaves every uint256 field as a bigint.
    const typedData = {
      domain: {
        version: '0.1.0',
        chainId: 42101,
        verifyingContract: '0x1111111111111111111111111111111111111111',
      },
      types: {
        UniversalPayload: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'gasLimit', type: 'uint256' },
          { name: 'maxFeePerGas', type: 'uint256' },
          { name: 'maxPriorityFeePerGas', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'vType', type: 'uint8' },
        ],
      },
      primaryType: 'UniversalPayload',
      message: {
        to: '0x0000000000000000000000000000000000000000',
        value: BigInt('1000000000000000000'),
        data: '0x',
        gasLimit: BigInt(10000000),
        maxFeePerGas: BigInt('10000000000'),
        maxPriorityFeePerGas: BigInt(0),
        nonce: BigInt(0),
        deadline: BigInt('9999999999'),
        vType: 0,
      },
    } as unknown as ITypedData;

    await expect(waapSignTypedData(typedData)).resolves.toBeInstanceOf(
      Uint8Array
    );

    const sent = sentTypedData();
    expect(sent.message.value).toBe('1000000000000000000');
    expect(sent.message.deadline).toBe('9999999999');
    expect(sent.types.UniversalPayload).toBeDefined();
    expect(sent.types.EIP712Domain).toBeDefined();
  });

  it('keeps the MigrationPayload type when that is the primaryType', async () => {
    // Core's signMigrationPayload sets primaryType to 'MigrationPayload' and
    // never populates types.UniversalPayload.
    const typedData = {
      domain: {
        version: '1.0.0',
        chainId: 42101,
        verifyingContract: '0x1111111111111111111111111111111111111111',
      },
      types: {
        MigrationPayload: [
          { name: 'migration', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'MigrationPayload',
      message: {
        migration: '0x2222222222222222222222222222222222222222',
        nonce: '0',
        deadline: '999',
      },
    } as unknown as ITypedData;

    await expect(waapSignTypedData(typedData)).resolves.toBeInstanceOf(
      Uint8Array
    );

    const sent = sentTypedData();
    // The wallet resolves types[primaryType]; dropping it makes the request
    // unsignable.
    expect(sent.types[sent.primaryType]).toBeDefined();
    expect(sent.types.MigrationPayload).toHaveLength(3);
  });
});
