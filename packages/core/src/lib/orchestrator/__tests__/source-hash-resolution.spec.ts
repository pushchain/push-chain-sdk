/**
 * Unit tests for resolveUniversalTxFromSourceHash — the source-hash resolution
 * path that lets trackTransaction accept an ORIGIN/source-leg hash (a source
 * EVM tx hash or a Solana signature) on a non-Push `chain`.
 *
 * The detector is mocked (same pattern as inbound-tracker-derivation.spec.ts)
 * and the Push indexer lookup is a fake, so these are pure, offline tests of
 * the resolver's branching: detect → universalTxId → record → pcTx hash.
 */
jest.mock('../../universal-tx-detector/detector');

import { detectUniversalTx } from '../../universal-tx-detector/detector';
import { resolveUniversalTxFromSourceHash } from '../internals/response-builder';
import { CHAIN } from '../../constants/enums';

const mockDetect = detectUniversalTx as jest.MockedFunction<
  typeof detectUniversalTx
>;

function makeCtx(getUniversalTxByIdV2: jest.Mock) {
  return {
    pushClient: { getUniversalTxByIdV2 },
    rpcUrls: {},
  } as any;
}

describe('resolveUniversalTxFromSourceHash', () => {
  afterEach(() => jest.clearAllMocks());

  it('resolves universalTxId → record → first pcTx hash + sender', async () => {
    mockDetect.mockResolvedValue({
      kind: 'INBOUND_FROM_EOA',
      decoded: { universalTxId: '0xutx', sender: '0xsender' },
    } as any);
    const getUtx = jest.fn().mockResolvedValue({
      universalTx: {
        id: '0xutx',
        pcTx: [{ txHash: '0xpushroot', logIndex: '0' }],
        inboundTx: {},
        outboundTx: [],
        universalStatus: 0,
      },
    });

    const res = await resolveUniversalTxFromSourceHash(
      makeCtx(getUtx),
      '0xsource',
      CHAIN.ETHEREUM_SEPOLIA,
      {}
    );

    expect(res.pushTxHash).toBe('0xpushroot');
    expect(res.sourceSender).toBe('0xsender');
    expect(getUtx).toHaveBeenCalledWith('0xutx');
  });

  it('throws an actionable error when the detector resolves no universalTxId', async () => {
    mockDetect.mockResolvedValue({ kind: 'UNKNOWN', decoded: {} } as any);

    await expect(
      resolveUniversalTxFromSourceHash(
        makeCtx(jest.fn()),
        'sig',
        CHAIN.SOLANA_DEVNET,
        {}
      )
    ).rejects.toThrow(/could not resolve a universal transaction/i);
  });

  it('throws when no universal record exists on Push Chain yet', async () => {
    mockDetect.mockResolvedValue({
      kind: 'INBOUND_FROM_EOA',
      decoded: { universalTxId: '0xutx' },
    } as any);
    const getUtx = jest.fn().mockResolvedValue({ universalTx: undefined });

    await expect(
      resolveUniversalTxFromSourceHash(
        makeCtx(getUtx),
        '0xsource',
        CHAIN.ETHEREUM_SEPOLIA,
        {}
      )
    ).rejects.toThrow(/no universal transaction record exists/i);
  });

  it('throws when the record has no Push pcTx recorded yet', async () => {
    mockDetect.mockResolvedValue({
      kind: 'INBOUND_FROM_EOA',
      decoded: { universalTxId: '0xutx' },
    } as any);
    const getUtx = jest.fn().mockResolvedValue({
      universalTx: { id: '0xutx', pcTx: [], outboundTx: [], universalStatus: 0 },
    });

    await expect(
      resolveUniversalTxFromSourceHash(
        makeCtx(getUtx),
        '0xsource',
        CHAIN.ETHEREUM_SEPOLIA,
        {}
      )
    ).rejects.toThrow(/no Push Chain tx recorded/i);
  });
});
