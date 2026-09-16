import { PushClient } from '../../push-client/push-client';
import { PUSH_NETWORK } from '../../constants/enums';

describe('EndBlock RPC transport', () => {
  let fetchMock: jest.SpyInstance;
  let client: PushClient;
  const events = [{ type: 'tx_log', attributes: [{ key: 'mode', value: 'EndBlock' }] }];
  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
    client = new PushClient({ rpcUrls: ['https://unused.invalid'], network: PUSH_NETWORK.TESTNET_DONUT });
  });
  afterEach(() => fetchMock.mockRestore());

  it.each(['finalize_block_events', 'end_block_events'])('retains %s without passing through a lossy decoder', async (field) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ result: { [field]: events } })));
    expect(await client.getBlockResultEvents(42)).toEqual(events);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/block_results\?height=42$/);
  });

  it('prefers CometBFT finalize events when legacy events also exist', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ result: { finalize_block_events: events, end_block_events: [] } })));
    expect(await client.getBlockResultEvents(42)).toEqual(events);
  });

  it('retries a transient HTTP failure without treating it as an empty successful block', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { finalize_block_events: events } })));
    expect(await client.getBlockResultEvents(42)).toEqual(events);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces a pruned-height JSON-RPC error for the tracker to classify as unknown', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: { message: 'Internal error', data: 'height pruned' } })));
    await expect(client.getBlockResultEvents(42)).rejects.toThrow('height pruned');
  });
});
