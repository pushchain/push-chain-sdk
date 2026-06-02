/**
 * Unit tests for the trackTransaction() chain guard.
 *
 * trackTransaction accepts an optional `chain` (TrackTransactionOptions.chain)
 * that selects which chain's RPC the initial getTransaction() poll runs
 * against; it defaults to Push Chain. An explicitly-passed value that isn't a
 * known CHAIN_INFO entry (a raw numeric chainId, a typo, or a chain from a
 * plain-JS caller that skips the CHAIN type) must fail fast with an actionable
 * error instead of crashing later with "Cannot read properties of undefined
 * (reading 'defaultRPC')" at the RPC lookup.
 *
 * The guard runs before any network access — and before the ctx-derived
 * default is evaluated, since an explicit chain is provided — so these are
 * pure, offline unit tests: no RPC, no real ctx needed.
 */
import { trackTransaction } from '../internals/response-builder';

describe('trackTransaction() chain guard', () => {
  // Truthy → passes the `!callbacks` guard; not otherwise dereferenced before
  // the chain guard throws.
  const callbacks = {} as any;
  // Not dereferenced when an explicit (supported or not) chain is passed.
  const ctx = {} as any;

  it('throws an actionable error naming the offending chain', async () => {
    await expect(
      trackTransaction(
        ctx,
        '0xdeadbeef',
        { chain: 'eip155:999999999' as any },
        callbacks
      )
    ).rejects.toThrow(/unsupported chain "eip155:999999999"/i);
  });

  it('points the caller at PushChain.CONSTANTS.CHAIN', async () => {
    await expect(
      trackTransaction(ctx, '0xdeadbeef', { chain: 'not-a-chain' as any }, callbacks)
    ).rejects.toThrow(/PushChain\.CONSTANTS\.CHAIN/);
  });

  it('rejects a raw numeric chainId passed in place of a CHAIN enum', async () => {
    await expect(
      trackTransaction(ctx, '0xdeadbeef', { chain: 11155111 as any }, callbacks)
    ).rejects.toThrow(/unsupported chain/i);
  });
});
