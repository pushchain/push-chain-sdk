/**
 * Unit tests for the detector-first child-utxId lookup in
 * `findChildUtxIdFromExternalTx`.
 *
 * The primary path calls `detectUniversalTx` + `resolveChildInboundsFromDetection`
 * to derive a child utxId deterministically from the source-chain receipt.
 * The fallback path is the original cosmos text search.
 *
 * We mock the detector module at the module boundary so we can drive the
 * behavior of both paths without hitting network.
 */
jest.mock('../../universal-tx-detector/detector');
jest.mock('../../universal-tx-detector/child-inbounds');

import {
  findChildUtxIdFromExternalTx,
  waitForInboundPushTx,
} from '../internals/inbound-tracker';
import type { OrchestratorContext } from '../internals/context';
import { UniversalTxStatus } from '../../generated/uexecutor/v2/types';
import { detectUniversalTx } from '../../universal-tx-detector/detector';
import {
  resolveChildInboundsFromDetection,
  type ChildInboundResolution,
} from '../../universal-tx-detector/child-inbounds';

const mockedDetect = detectUniversalTx as jest.MockedFunction<
  typeof detectUniversalTx
>;
const mockedResolve =
  resolveChildInboundsFromDetection as jest.MockedFunction<
    typeof resolveChildInboundsFromDetection
  >;

function makeCtx(
  cosmosSearchImpl?: (query: string) => Promise<unknown[]>
): OrchestratorContext {
  return {
    pushClient: {
      searchCosmosByQuery: jest.fn(
        cosmosSearchImpl ?? (async () => [])
      ),
      getUniversalTxByIdV2: jest.fn(),
    },
    rpcUrls: {},
    printTraces: false,
    pushNetwork: 'TESTNET_DONUT',
  } as unknown as OrchestratorContext;
}

function resolution(
  overrides: Partial<ChildInboundResolution>
): ChildInboundResolution {
  return {
    universalTxId: '0xdeadbeef' as `0x${string}`,
    sourceLogIndex: 0,
    sourceEventName: 'UniversalTx',
    status: 0,
    statusName: 'UNIVERSAL_TX_STATUS_UNSPECIFIED',
    pcTxHashes: [],
    outboundHashes: [],
    ...overrides,
  };
}

describe('findChildUtxIdFromExternalTx — detector-first derivation', () => {
  beforeEach(() => {
    mockedDetect.mockReset();
    mockedResolve.mockReset();
  });

  it('happy path: detector returns a UniversalTx resolution, utxId is returned with derivedFrom=detector', async () => {
    const ctx = makeCtx();
    mockedDetect.mockResolvedValueOnce({
      txHash: '0xext',
      chain: 'eip155:11155111',
      kind: 'INBOUND_FROM_CEA',
    } as never);
    mockedResolve.mockResolvedValueOnce([
      resolution({
        universalTxId: '0xabc123' as `0x${string}`,
        sourceEventName: 'UniversalTx',
      }),
    ]);

    const result = await findChildUtxIdFromExternalTx(
      ctx,
      '0xext',
      'eip155:11155111'
    );

    expect(result.utxId).toBe('0xabc123');
    expect(result.derivedFrom).toBe('detector');
    // Cosmos fallback must NOT be invoked when detector succeeds.
    expect(ctx.pushClient.searchCosmosByQuery).not.toHaveBeenCalled();
  });

  it('prefers UniversalTx resolution over RevertUniversalTx when both are present', async () => {
    const ctx = makeCtx();
    mockedDetect.mockResolvedValueOnce({
      txHash: '0xext',
      chain: 'eip155:11155111',
      kind: 'INBOUND_FROM_CEA',
    } as never);
    // Revert appears first in the array but UniversalTx should still win.
    mockedResolve.mockResolvedValueOnce([
      resolution({
        universalTxId: '0xrevert' as `0x${string}`,
        sourceEventName: 'RevertUniversalTx',
      }),
      resolution({
        universalTxId: '0xutx' as `0x${string}`,
        sourceEventName: 'UniversalTx',
      }),
    ]);

    const result = await findChildUtxIdFromExternalTx(
      ctx,
      '0xext',
      'eip155:11155111'
    );

    expect(result.utxId).toBe('0xutx');
    expect(result.derivedFrom).toBe('detector');
  });

  it('detector returns empty resolutions → falls through to cosmos search (which also empty) → utxId=null', async () => {
    const cosmosMock = jest.fn(async () => []);
    const ctx = makeCtx(cosmosMock);
    mockedDetect.mockResolvedValueOnce({
      txHash: '0xext',
      chain: 'eip155:11155111',
      kind: 'UNKNOWN',
    } as never);
    mockedResolve.mockResolvedValueOnce([]);

    const result = await findChildUtxIdFromExternalTx(
      ctx,
      '0xext',
      'eip155:11155111'
    );

    expect(result.utxId).toBeNull();
    expect(result.derivedFrom).toBeUndefined();
    expect(cosmosMock).toHaveBeenCalledTimes(1);
    expect(cosmosMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "universal_tx_created.inbound_tx_hash='0xext'"
      )
    );
  });

  it('detector throws → cosmos fallback finds a hit → utxId returned with derivedFrom=cosmos-fallback', async () => {
    const cosmosMock = jest.fn(async () => [
      {
        events: [
          {
            type: 'universal_tx_created',
            attributes: [
              { key: 'utx_id', value: 'fallback123' },
            ],
          },
        ],
      },
    ]);
    const ctx = makeCtx(cosmosMock);
    mockedDetect.mockRejectedValueOnce(new Error('source RPC down'));

    const result = await findChildUtxIdFromExternalTx(
      ctx,
      '0xext',
      'eip155:11155111'
    );

    expect(result.utxId).toBe('0xfallback123');
    expect(result.derivedFrom).toBe('cosmos-fallback');
    expect(cosmosMock).toHaveBeenCalled();
  });

  it('no sourceChain provided: skips detector entirely, uses cosmos fallback only', async () => {
    const cosmosMock = jest.fn(async () => []);
    const ctx = makeCtx(cosmosMock);

    const result = await findChildUtxIdFromExternalTx(ctx, '0xext');

    expect(result.utxId).toBeNull();
    // Detector must not be called without sourceChain.
    expect(mockedDetect).not.toHaveBeenCalled();
    expect(cosmosMock).toHaveBeenCalledTimes(1);
  });

  it('both detector and cosmos fail → returns {utxId:null, error}', async () => {
    const cosmosMock = jest.fn(async () => {
      throw new Error('cosmos RPC down');
    });
    const ctx = makeCtx(cosmosMock);
    mockedDetect.mockRejectedValueOnce(new Error('source RPC down'));

    const result = await findChildUtxIdFromExternalTx(
      ctx,
      '0xext',
      'eip155:11155111'
    );

    expect(result.utxId).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toContain('cosmos RPC down');
  });

  it('normalizes Push Chain native balance errors from failed inbound pcTx', async () => {
    const rawError =
      'Details: failed with 16777216 gas: insufficient funds for gas * price + value: address 0x36cDbAfcDEea9CF912D285017f246e55BaF14f0F have 8000000000000000 want 20517277398607022';
    const ctx = makeCtx();
    (ctx.pushClient.getUniversalTxByIdV2 as jest.Mock).mockResolvedValue({
      universalTx: {
        universalStatus: UniversalTxStatus.PC_EXECUTED_FAILED,
        pcTx: [
          {
            txHash: '0xpush',
            errorMsg: rawError,
          },
        ],
      },
    });
    mockedDetect.mockResolvedValueOnce({
      txHash: '0xext',
      chain: 'eip155:11155111',
      kind: 'INBOUND_FROM_CEA',
    } as never);
    mockedResolve.mockResolvedValueOnce([
      resolution({
        universalTxId: '0xabc123' as `0x${string}`,
        sourceEventName: 'UniversalTx',
      }),
    ]);

    const result = await waitForInboundPushTx(
      ctx,
      '0xext',
      'eip155:11155111',
      {
        initialWaitMs: 0,
        pollingIntervalMs: 1,
        timeout: 1000,
      }
    );

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain(
      'have 0.008 PC (8000000000000000 wei) want 0.020517277398607022 PC (20517277398607022 wei)'
    );
  });

  it('fails fast when inbound pcTx is failed before universalStatus becomes terminal', async () => {
    const ctx = makeCtx();
    (ctx.pushClient.getUniversalTxByIdV2 as jest.Mock).mockResolvedValue({
      universalTx: {
        universalStatus: UniversalTxStatus.UNIVERSAL_TX_STATUS_UNSPECIFIED,
        pcTx: [
          {
            txHash: '',
            status: 'FAILED',
            errorMsg:
              "contract call failed: method 'executeUniversalTx', contract '0x4A701114F991bf75685584c8156Db983c0DF95a0': execution reverted: ret 0x05aab006: evm transaction execution failed",
          },
        ],
      },
    });
    mockedDetect.mockResolvedValueOnce({
      txHash: '0xext',
      chain: 'eip155:97',
      kind: 'INBOUND_FROM_CEA',
    } as never);
    mockedResolve.mockResolvedValueOnce([
      resolution({
        universalTxId: '0xabc123' as `0x${string}`,
        sourceEventName: 'UniversalTx',
      }),
    ]);

    const result = await waitForInboundPushTx(
      ctx,
      '0xext',
      'eip155:97',
      {
        initialWaitMs: 0,
        pollingIntervalMs: 1,
        timeout: 1000,
      }
    );

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('0x05aab006');
  });
});
