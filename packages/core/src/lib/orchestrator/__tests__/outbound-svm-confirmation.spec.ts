import { Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import { CHAIN } from '../../constants/enums';
import {
  waitForOutboundTx,
  OutboundFailedError,
  OutboundTimeoutError,
} from '../internals/outbound-sync';
import { OutboundStatus } from '../../generated/uexecutor/v2/types';
import type { OrchestratorContext } from '../internals/context';
jest.mock('@solana/web3.js', () => ({
  ...jest.requireActual('@solana/web3.js'),
  Connection: jest.fn(),
}));
const bytes = Buffer.alloc(64, 12),
  signature = bs58.encode(bytes),
  hex = '0x' + bytes.toString('hex');
const statuses = jest.fn(),
  genesis = jest.fn();
beforeEach(() => {
  statuses.mockReset();
  genesis
    .mockReset()
    .mockResolvedValue(CHAIN.SOLANA_DEVNET.slice(7) + 'abcdefghijk');
  (Connection as unknown as jest.Mock).mockImplementation(() => ({
    getGenesisHash: genesis,
    getSignatureStatuses: statuses,
  }));
});
function context(hash: string): OrchestratorContext {
  return {
    printTraces: false,
    pushNetwork: 'TESTNET_DONUT',
    rpcUrls: { [CHAIN.SOLANA_DEVNET]: ['http://fixture'] },
    pushClient: {
      getCosmosTx: jest.fn().mockResolvedValue({ events: [] }),
      getUniversalTxByIdV2: jest
        .fn()
        .mockResolvedValue({
          universalTx: {
            universalStatus: 6,
            pcTx: [],
            outboundTx: [
              {
                destinationChain: CHAIN.SOLANA_DEVNET,
                outboundStatus: OutboundStatus.PENDING,
                recipient: 'fixture',
                amount: '0',
                externalAssetAddr: '',
                observedTx: { txHash: hash },
              },
            ],
          },
        }),
    },
  } as unknown as OrchestratorContext;
}
const opts = { initialWaitMs: 0, pollingIntervalMs: 1, timeout: 100 };
it.each([signature, hex])(
  'confirms pending Cosmos signature %s through Solana RPC',
  async (hash) => {
    statuses.mockResolvedValue({
      value: [{ confirmationStatus: 'confirmed', err: null }],
    });
    const out = await waitForOutboundTx(context(hash), '0xpush', opts);
    expect(out.externalTxHash).toBe(hash);
    expect(statuses).toHaveBeenCalledWith([signature], {
      searchTransactionHistory: true,
    });
  }
);
it('waits through processed status before finalization', async () => {
  statuses
    .mockResolvedValueOnce({
      value: [{ confirmationStatus: 'processed', err: null }],
    })
    .mockResolvedValue({
      value: [{ confirmationStatus: 'finalized', err: null }],
    });
  await waitForOutboundTx(context(signature), '0xpush', opts);
  expect(statuses).toHaveBeenCalledTimes(2);
});
it('reports a confirmed signature error as failure, preserving the hash', async () => {
  statuses.mockResolvedValue({
    value: [
      {
        confirmationStatus: 'confirmed',
        err: { InstructionError: [0, 'Custom'] },
      },
    ],
  });
  await expect(
    waitForOutboundTx(context(hex), '0xpush', opts)
  ).rejects.toMatchObject({ code: 'OUTBOUND_FAILED', externalTxHash: hex });
});
it.each([
  'wrong-cluster',
  'missing',
  'processed-error',
  'rpc-error',
  'malformed-hash',
])('keeps %s pending until timeout', async (kind) => {
  statuses.mockResolvedValue({ value: [null] });
  if (kind === 'wrong-cluster') genesis.mockResolvedValue('wrong');
  if (kind === 'processed-error')
    statuses.mockResolvedValue({
      value: [{ confirmationStatus: 'processed', err: { failure: true } }],
    });
  if (kind === 'rpc-error')
    statuses.mockRejectedValue(new Error('RPC unavailable'));
  const hash = kind === 'malformed-hash' ? '0x1234' : signature;
  await expect(
    waitForOutboundTx(context(hash), '0xpush', { ...opts, timeout: 20 })
  ).rejects.toBeInstanceOf(OutboundTimeoutError);
  if (kind === 'wrong-cluster' || kind === 'malformed-hash')
    expect(statuses).not.toHaveBeenCalled();
});
it('keeps an authoritative Cosmos revert ahead of the RPC tiebreaker', async () => {
  const ctx = context(signature);
  (ctx.pushClient.getUniversalTxByIdV2 as jest.Mock).mockResolvedValue({
    universalTx: { universalStatus: 8, pcTx: [], outboundTx: [] },
  });
  await expect(waitForOutboundTx(ctx, '0xpush', opts)).rejects.toBeInstanceOf(
    OutboundFailedError
  );
  expect(statuses).not.toHaveBeenCalled();
});
