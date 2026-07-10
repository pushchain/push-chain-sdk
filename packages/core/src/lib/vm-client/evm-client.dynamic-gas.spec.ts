import { bytesToHex, parseTransaction } from 'viem';
import { CHAIN } from '../constants/enums';
import type { UniversalSigner } from '../universal/universal.types';
import { EvmClient } from './evm-client';

const ACCOUNT = '0x3333333333333333333333333333333333333333' as const;
const TARGET = '0x4444444444444444444444444444444444444444' as const;
const TX_HASH = `0x${'55'.repeat(32)}` as `0x${string}`;

describe('EvmClient dynamic gas estimation', () => {
  it('serializes an estimate above the former 500k multicall limit', async () => {
    const estimatedGas = BigInt(808_000);
    const client = new EvmClient({ rpcUrls: ['http://localhost:8545'] });
    client.publicClient = {
      estimateGas: jest.fn().mockResolvedValue(estimatedGas),
      estimateFeesPerGas: jest.fn().mockResolvedValue({
        maxFeePerGas: BigInt(10),
        maxPriorityFeePerGas: BigInt(1),
      }),
      getChainId: jest.fn().mockResolvedValue(42101),
      getTransactionCount: jest.fn().mockResolvedValue(9),
    } as unknown as typeof client.publicClient;

    const signAndSendTransaction = jest
      .fn()
      .mockImplementation(async (unsignedTx: Uint8Array) => {
        const parsed = parseTransaction(bytesToHex(unsignedTx));
        expect(parsed.gas).toBe(estimatedGas);
        expect(parsed.nonce).toBe(9);
        return Uint8Array.from(Buffer.from(TX_HASH.slice(2), 'hex'));
      });
    const signer: UniversalSigner = {
      account: { chain: CHAIN.PUSH_TESTNET_DONUT, address: ACCOUNT },
      signMessage: async (data) => data,
      signAndSendTransaction,
    };

    const hash = await client.sendTransaction({
      to: TARGET,
      data: '0x12345678',
      value: BigInt(0),
      signer,
      nonce: 9,
    });

    expect(client.publicClient.estimateGas).toHaveBeenCalledWith({
      account: ACCOUNT,
      to: TARGET,
      data: '0x12345678',
      value: BigInt(0),
    });
    expect(signAndSendTransaction).toHaveBeenCalledTimes(1);
    expect(hash).toBe(TX_HASH);
  });
});
