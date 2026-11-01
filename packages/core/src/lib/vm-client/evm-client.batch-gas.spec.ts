import { bytesToHex, parseTransaction } from 'viem';
import { EvmClient } from './evm-client';
import { CHAIN } from '../constants/enums';
import type { UniversalSigner } from '../universal/universal.types';
const account = '0x3333333333333333333333333333333333333333',
  executor = '0x4444444444444444444444444444444444444444';
function fixture() {
  const client = new EvmClient({ rpcUrls: ['http://localhost:8545'] });
  const estimateGas = jest.fn(),
    send = jest
      .fn<Promise<Uint8Array>, [Uint8Array]>()
      .mockResolvedValue(new Uint8Array(32));
  client.publicClient = {
    estimateGas,
    getCode: jest.fn().mockResolvedValue('0xef0100' + executor.slice(2)),
    estimateFeesPerGas: jest.fn().mockResolvedValue({
      maxFeePerGas: BigInt(10),
      maxPriorityFeePerGas: BigInt(1),
    }),
    getChainId: jest.fn().mockResolvedValue(42101),
    getTransactionCount: jest.fn().mockResolvedValue(5),
  } as never;
  const signer: UniversalSigner = {
    account: { chain: CHAIN.PUSH_TESTNET_DONUT, address: account },
    signMessage: async (x) => x,
    signAuthorization: jest.fn().mockResolvedValue({
      address: executor,
      chainId: 42101,
      nonce: 6,
      yParity: 0,
      r: '0x' + '11'.repeat(32),
      s: '0x' + '22'.repeat(32),
    }),
    signAndSendTransaction: send,
  };
  const run = () =>
    client.sendBatch7702({
      executor,
      signer,
      calls: [
        { to: executor, value: BigInt(0), data: '0x12345678' },
        { to: executor, value: BigInt(0), data: '0x12345678' },
      ],
    });
  return { client, estimateGas, send, run };
}
describe('7702 estimation without guessed per-call ceilings', () => {
  it('uses a real estimate for an already delegated account when authorization RPC support is absent', async () => {
    const f = fixture();
    f.estimateGas
      .mockRejectedValueOnce(new Error('unsupported auth list'))
      .mockResolvedValueOnce(BigInt(1_400_000));
    await f.run();
    const tx = parseTransaction(bytesToHex(f.send.mock.calls[0][0]));
    expect(tx.gas).toBe(BigInt(1_705_000));
    expect(f.estimateGas.mock.calls[1][0]).not.toHaveProperty('stateOverride');
  });
  it('uses a delegation override for a fresh account only when authorization estimation fails', async () => {
    const f = fixture();
    (f.client.publicClient.getCode as jest.Mock).mockResolvedValue('0x');
    f.estimateGas
      .mockRejectedValueOnce(new Error('unsupported'))
      .mockResolvedValueOnce(BigInt(2_000_000));
    await f.run();
    expect(f.estimateGas.mock.calls[1][0].stateOverride[0].code).toBe(
      '0xef0100' + executor.slice(2)
    );
  });
  it('does not broadcast a guessed gas budget when all supported estimates fail', async () => {
    const f = fixture();
    f.estimateGas.mockRejectedValue(new Error('execution rejected'));
    await expect(f.run()).rejects.toThrow('execution rejected');
    expect(f.send).not.toHaveBeenCalled();
  });
});
