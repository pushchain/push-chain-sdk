/**
 * Unit tests for detectUniversalTxAuto.
 *
 * Stubs `detectUniversalTx` via a jest.mock so each simulated chain returns a
 * pre-planned detection shape — no viem, no network.
 */
import { CHAIN } from '../../constants/enums';
import type { UniversalTxDetection } from '../types';

// Mock detector.ts BEFORE importing the module under test.
const mockDetectUniversalTx = jest.fn();
jest.mock('../detector', () => ({
  detectUniversalTx: (...args: unknown[]) => mockDetectUniversalTx(...args),
}));

import {
  detectUniversalTxAuto,
  listAutoProbeChains,
} from '../auto-detect';

const HASH = '0x0000000000000000000000000000000000000000000000000000000000000001' as const;

function detection(
  chain: CHAIN,
  kind: UniversalTxDetection['kind']
): UniversalTxDetection {
  return {
    txHash: HASH,
    chain,
    kind,
    emitters: [],
    decoded: {},
    matchingLogs: [],
    detections: [],
    notes: [],
  };
}

beforeEach(() => {
  mockDetectUniversalTx.mockReset();
});

describe('listAutoProbeChains', () => {
  it('puts Push CAIPs first', () => {
    const chains = listAutoProbeChains();
    // First entries must be Push CAIPs (subset of [PUSH_TESTNET_DONUT, PUSH_MAINNET, PUSH_LOCALNET]).
    const pushSet = new Set([
      CHAIN.PUSH_TESTNET_DONUT,
      CHAIN.PUSH_MAINNET,
      CHAIN.PUSH_LOCALNET,
    ]);
    expect(pushSet.has(chains[0])).toBe(true);
    // And common destination chains are present later.
    expect(chains).toContain(CHAIN.ETHEREUM_SEPOLIA);
    expect(chains).toContain(CHAIN.BNB_TESTNET);
  });
});

describe('detectUniversalTxAuto', () => {
  it('returns the first non-UNKNOWN detection in probe order', async () => {
    mockDetectUniversalTx.mockImplementation(async (_h: string, chain: CHAIN) => {
      if (chain === CHAIN.ETHEREUM_SEPOLIA) {
        return detection(chain, 'OUTBOUND_FINALIZED');
      }
      return detection(chain, 'UNKNOWN');
    });
    const res = await detectUniversalTxAuto(HASH, {
      chains: [CHAIN.PUSH_TESTNET_DONUT, CHAIN.ETHEREUM_SEPOLIA, CHAIN.BNB_TESTNET],
    });
    expect(res.detection?.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
    expect(res.detection?.kind).toBe('OUTBOUND_FINALIZED');
    expect(res.attempts.length).toBe(3);
    expect(res.attempts.filter((a) => a.matched)).toHaveLength(1);
  });

  it('returns undefined detection and UNKNOWN attempts when no chain matches', async () => {
    mockDetectUniversalTx.mockImplementation(async (_h: string, chain: CHAIN) =>
      detection(chain, 'UNKNOWN')
    );
    const res = await detectUniversalTxAuto(HASH, {
      chains: [CHAIN.PUSH_TESTNET_DONUT, CHAIN.ETHEREUM_SEPOLIA],
    });
    expect(res.detection).toBeUndefined();
    expect(res.attempts.every((a) => !a.matched)).toBe(true);
  });

  it('prefers Push Chain when both Push and Sepolia match', async () => {
    mockDetectUniversalTx.mockImplementation(async (_h: string, chain: CHAIN) => {
      if (chain === CHAIN.PUSH_TESTNET_DONUT)
        return detection(chain, 'OUTBOUND_INITIATED');
      if (chain === CHAIN.ETHEREUM_SEPOLIA)
        return detection(chain, 'OUTBOUND_FINALIZED');
      return detection(chain, 'UNKNOWN');
    });
    const res = await detectUniversalTxAuto(HASH, {
      chains: [CHAIN.PUSH_TESTNET_DONUT, CHAIN.ETHEREUM_SEPOLIA],
      exhaustive: true,
    });
    expect(res.detection?.chain).toBe(CHAIN.PUSH_TESTNET_DONUT);
    expect(res.attempts.filter((a) => a.matched)).toHaveLength(2);
  });

  it('records per-chain errors without failing the overall probe', async () => {
    mockDetectUniversalTx.mockImplementation(async (_h: string, chain: CHAIN) => {
      if (chain === CHAIN.BNB_TESTNET) throw new Error('rpc timeout');
      if (chain === CHAIN.ETHEREUM_SEPOLIA)
        return detection(chain, 'OUTBOUND_FINALIZED');
      return detection(chain, 'UNKNOWN');
    });
    const res = await detectUniversalTxAuto(HASH, {
      chains: [CHAIN.BNB_TESTNET, CHAIN.ETHEREUM_SEPOLIA],
    });
    expect(res.detection?.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
    const err = res.attempts.find((a) => a.chain === CHAIN.BNB_TESTNET);
    expect(err?.error).toContain('rpc timeout');
  });

  it('passes through probe options to detectUniversalTx', async () => {
    mockDetectUniversalTx.mockResolvedValue(detection(CHAIN.ETHEREUM_SEPOLIA, 'UNKNOWN'));
    const rpcUrls = { [CHAIN.ETHEREUM_SEPOLIA]: ['https://x'] };
    await detectUniversalTxAuto(HASH, {
      chains: [CHAIN.ETHEREUM_SEPOLIA],
      rpcUrls,
    });
    expect(mockDetectUniversalTx).toHaveBeenCalledWith(
      HASH,
      CHAIN.ETHEREUM_SEPOLIA,
      expect.objectContaining({ rpcUrls })
    );
  });
});
