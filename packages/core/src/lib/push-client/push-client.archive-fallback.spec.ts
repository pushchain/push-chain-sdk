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

describe('PushClient archive fallback — getTransactionReceiptWithArchiveFallback', () => {
  const hash = `0x${'11'.repeat(32)}` as const;

  it('builds the prune probe without transport retries', () => {
    const probe = (donutClient() as any).pruneProbeClient;
    expect(probe).toBeDefined();
    for (const t of probe.transport.transports) expect(t.config.retryCount).toBe(0);
  });

  it('races the no-retry prune probe against the archive: a pruned receipt costs one archive round trip', async () => {
    const client = donutClient() as any;
    const probe = jest.fn(() => new Promise((_, reject) => setTimeout(() => reject(new Error('Requested resource not available.')), 50)));
    const shared = jest.fn();
    client.pruneProbeClient = { getTransactionReceipt: probe };
    client.publicClient = { getTransactionReceipt: shared };
    const archive = jest.fn().mockResolvedValue({ transactionHash: hash, status: 'success' });
    client.archivePublicClient = { getTransactionReceipt: archive };
    const r = await client.getTransactionReceiptWithArchiveFallback(hash);
    expect(r.transactionHash).toBe(hash);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(archive).toHaveBeenCalledWith({ hash });
    expect(shared).not.toHaveBeenCalled(); // the retrying client is never used for this
  });

  it('a fresh receipt the archive has not indexed yet comes from the prune node', async () => {
    const client = donutClient() as any;
    client.pruneProbeClient = { getTransactionReceipt: jest.fn(() => new Promise((r) => setTimeout(() => r({ transactionHash: hash, from: 'prune' }), 20))) };
    client.archivePublicClient = { getTransactionReceipt: jest.fn().mockRejectedValue(new Error('receipt not found')) };
    expect((await client.getTransactionReceiptWithArchiveFallback(hash)).from).toBe('prune');
  });

  it('rejects with the prune error when neither has it', async () => {
    const client = donutClient() as any;
    client.archivePublicClient = { getTransactionReceipt: jest.fn().mockRejectedValue(new Error('archive miss')) };
    client.pruneProbeClient = { getTransactionReceipt: jest.fn(() => new Promise((_, reject) => setTimeout(() => reject(new Error('prune miss')), 20))) };
    await expect(client.getTransactionReceiptWithArchiveFallback(hash)).rejects.toThrow('prune miss');
  });

  it('without an archive endpoint it is the plain shared-client call (retries intact)', async () => {
    const client = localnetClient() as any;
    expect(client.pruneProbeClient).toBeUndefined();
    const getTransactionReceipt = jest.fn().mockResolvedValue({ transactionHash: hash });
    client.publicClient = { getTransactionReceipt };
    await client.getTransactionReceiptWithArchiveFallback(hash);
    expect(getTransactionReceipt).toHaveBeenCalledWith({ hash });
  });
});
