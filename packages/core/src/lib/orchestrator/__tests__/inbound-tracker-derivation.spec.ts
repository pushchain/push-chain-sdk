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

import { findChildUtxIdFromExternalTx } from '../internals/inbound-tracker';
import type { OrchestratorContext } from '../internals/context';
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
});
