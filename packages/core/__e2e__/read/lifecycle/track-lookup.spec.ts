import '@e2e/shared/setup';
/**
 * E2E · read state · trackRead on an old, terminal read (read-only, no funds).
 *
 * The request (USDC totalSupply() on Sepolia, stored at Push block 23283349) is
 * older than the public RPC's prune window, so its fulfil/settle receipts only
 * exist on the archive. Before 2026-09-23 this took ~19 s: each receipt miss on
 * the prune node answers after ~8 s, fetched in series. Now: one lookup plus a
 * parallel prune/archive race per receipt, and lookup progress events.
 */
import { PushChain } from '../../../src';
import { makePushEoaClient, pushKey } from '../_shared';

const DOCS_REQUEST = '0x9d276d87071f8478f817ef893d8fbb1ca4d8319f14bbf1dfba12cd73d02867f3' as const;
const READ = PushChain.CONSTANTS.READ;

const d = pushKey ? describe : describe.skip;

d('read state › trackRead lookup', () => {
  it('returns a terminal read quickly, with lookup events and settlement facts from archive receipts', async () => {
    const { client } = await makePushEoaClient(pushKey!);
    const events: string[] = [];
    const start = Date.now();
    const r = await client.universal.trackRead({ requestId: DOCS_REQUEST }, { progressHook: (e) => events.push(e.id) });
    const elapsed = Date.now() - start;

    expect(r.status).toBe(READ.STATUS.FULFILLED);
    expect(r.outcome).toBe(READ.OUTCOME.SUCCESS);
    expect(r.callbackDelivered).toBe(true); // needs the fulfil receipt → archive path worked
    expect(r.fees.burned).toBeGreaterThan(0n); // needs the settle receipt
    expect(events.slice(0, 2)).toEqual(['READ-TX-104-03', 'READ-TX-104-04']);
    expect(elapsed).toBeLessThan(5_000);
  }, 60_000);
});
