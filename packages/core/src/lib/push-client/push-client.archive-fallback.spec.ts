/**
 * Unit tests for PushClient's prune-first → archive-fallback.
 *
 * The fallback is the explicit "prune returned empty/not-found → re-query
 * archive" logic that the per-URL transport machinery can't do on its own
 * (a pruned tx comes back as a *successful* empty result, not a transport
 * error). It is always on, and inert for chains without an archive endpoint
 * configured (mainnet/localnet). These tests mock the Cosmos transport so
 * they're network-free and assert: (1) an empty prune result triggers an
 * archive re-query that wins, (2) a non-empty prune result short-circuits
 * (archive untouched), and (3) a chain with no archive endpoint never
 * consults archive.
 */
import { StargateClient } from '@cosmjs/stargate';
import { PushClient } from './push-client';
import { PUSH_CHAIN_INFO } from '../constants/chain';
import { CHAIN, PUSH_NETWORK } from '../constants/enums';

// Mock only StargateClient.connect; keep the rest of @cosmjs/stargate real
// (PushClient also imports QueryClient/createProtobufRpcClient/etc from it).
jest.mock('@cosmjs/stargate', () => {
  const actual = jest.requireActual('@cosmjs/stargate');
  return { ...actual, StargateClient: { connect: jest.fn() } };
});

const connectMock = StargateClient.connect as unknown as jest.Mock;

const PRUNE_TM = PUSH_CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].tendermintRpc[0];
const ARCHIVE_TM =
  PUSH_CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].archiveTendermintRpc![0];

const isArchiveUrl = (url: string) => url.includes('archive');

// A minimal, JSON-serializable indexed-tx stand-in.
const HIT = { height: 123, hash: 'DEADBEEF', events: [] };

// Donut has archive endpoints → fallback active.
const donutClient = () =>
  new PushClient({
    rpcUrls: PUSH_CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
    network: PUSH_NETWORK.TESTNET_DONUT,
  });

// Localnet has NO archive endpoints → fallback inert (prune-only).
const localnetClient = () =>
  new PushClient({
    rpcUrls: PUSH_CHAIN_INFO[CHAIN.PUSH_LOCALNET].defaultRPC,
    network: PUSH_NETWORK.LOCALNET,
  });

beforeEach(() => {
  connectMock.mockReset();
});

describe('PushClient archive fallback — searchCosmosByQuery', () => {
  it('re-queries archive when prune returns empty, and returns the archive hit', async () => {
    // prune → [], archive → [HIT]
    connectMock.mockImplementation(async (url: string) => ({
      searchTx: async () => (isArchiveUrl(url) ? [HIT] : []),
    }));

    const results = await donutClient().searchCosmosByQuery("foo='bar'");

    expect(results).toHaveLength(1);
    const urls = connectMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain(PRUNE_TM);
    expect(urls).toContain(ARCHIVE_TM);
    // prune is consulted before archive
    expect(urls.indexOf(PRUNE_TM)).toBeLessThan(urls.indexOf(ARCHIVE_TM));
  });

  it('does NOT touch archive when prune already has a result', async () => {
    connectMock.mockImplementation(async () => ({
      searchTx: async () => [HIT],
    }));

    const results = await donutClient().searchCosmosByQuery("foo='bar'");

    expect(results).toHaveLength(1);
    const urls = connectMock.mock.calls.map((c) => c[0]);
    expect(urls.some(isArchiveUrl)).toBe(false);
  });

  it('chain without an archive endpoint never consults archive (inert)', async () => {
    connectMock.mockImplementation(async (url: string) => ({
      searchTx: async () => (isArchiveUrl(url) ? [HIT] : []),
    }));

    const results = await localnetClient().searchCosmosByQuery("foo='bar'");

    expect(results).toHaveLength(0); // prune-only empty, no archive rescue
    const urls = connectMock.mock.calls.map((c) => c[0]);
    expect(urls.some(isArchiveUrl)).toBe(false);
  });
});

describe('PushClient archive fallback — getCosmosTx', () => {
  it('falls back to archive when prune has no indexed tx (op throws on empty)', async () => {
    const txHash = '0xabc';
    connectMock.mockImplementation(async (url: string) => ({
      searchTx: async () =>
        isArchiveUrl(url) ? [{ ...HIT }] : [], // prune empty → op throws → archive
    }));

    const tx = await donutClient().getCosmosTx(txHash);

    expect(tx.transactionHash).toBe(txHash);
    const urls = connectMock.mock.calls.map((c) => c[0]);
    expect(urls.some(isArchiveUrl)).toBe(true);
  });

  it('chain without an archive endpoint throws when prune has no indexed tx', async () => {
    connectMock.mockImplementation(async () => ({
      searchTx: async () => [],
    }));

    await expect(localnetClient().getCosmosTx('0xabc')).rejects.toThrow();
    const urls = connectMock.mock.calls.map((c) => c[0]);
    expect(urls.some(isArchiveUrl)).toBe(false);
  });
});
