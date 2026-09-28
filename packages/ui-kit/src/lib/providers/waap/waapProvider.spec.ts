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
  it('keeps the EIP712Domain separator and a resolvable type entry', async () => {
    // Mirrors the UniversalPayload Core signs on the non-fee-locking path, with
    // the uint256 fields already stringified by the orchestrator's
    // bigintReplacer before they reach the signer.
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
          { name: 'data', type: 'bytes' },
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
        value: '1000000000000000000',
        data: '0x',
        gasLimit: '10000000',
        maxFeePerGas: '10000000000',
        maxPriorityFeePerGas: '0',
        nonce: '0',
        deadline: '9999999999',
        vType: 1,
      },
    } as unknown as ITypedData;

    await expect(waapSignTypedData(typedData)).resolves.toBeInstanceOf(
      Uint8Array
    );

    const sent = sentTypedData();
    expect(sent.types.UniversalPayload).toHaveLength(9);
    expect(sent.types[sent.primaryType]).toBeDefined();
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
