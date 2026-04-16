import '@e2e/shared/setup';
import { Hex } from 'viem';
import { PushChain } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';
import { ProgressEvent } from '../../src/lib/progress-hook/progress-hook.types';
import { createEvmPushClient } from '@e2e/shared/evm-client';

/**
 * E2E tests that mirror the exact code snippets on the website
 * docs/chain/03-build/10-Track-Universal-Transaction.mdx
 *
 * Validates:
 *   W1 – Route 1 snippet: progressHook event properties are populated
 *   W2 – Event IDs are SEND-TX-*, NOT TRACK-TX-*
 *   W3 – ProgressEvent structure matches documented type
 *   W4 – wait() vs trackTransaction() comparison returns consistent results
 *   W5 – Orchestrator-level progressHook receives events
 */
describe('Website Track Transaction Snippets (e2e)', () => {
  const KNOWN_TARGET = '0x35B84d6848D16415177c64D64504663b998A6ab4';

  let pushClient: PushChain;
  let knownTxHash: string;

  const evmPrivateKey = process.env['PUSH_PRIVATE_KEY'] as Hex;
  const skipE2E = !evmPrivateKey;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('PUSH_PRIVATE_KEY not set — skipping all tests');
      return;
    }

    const setup = await createEvmPushClient({
      chain: CHAIN.PUSH_TESTNET_DONUT,
      privateKey: evmPrivateKey,
      printTraces: true,
    });
    pushClient = setup.pushClient;

    // Send a transaction so we have a confirmed hash to track
    console.log('\n=== [beforeAll] Sending tx to get a trackable hash ===');
    const tx = await pushClient.universal.sendTransaction({
      to: KNOWN_TARGET as `0x${string}`,
      value: BigInt(100),
    });
    await tx.wait();
    knownTxHash = tx.hash;
    console.log('Trackable hash:', knownTxHash);
  }, 180000);

  // ═══════════════════════════════════════════════════════════════════
  // W1 — Route 1 snippet: event.id, event.level, event.message populated
  // ═══════════════════════════════════════════════════════════════════
  it('W1: Route 1 progressHook — event.id, event.level, event.message are defined', async () => {
    if (skipE2E || !knownTxHash) return;

    console.log('\n=== W1: Route 1 snippet test ===');

    const events: ProgressEvent[] = [];

    // This mirrors the exact website Route 1 snippet
    const response = await pushClient.universal.trackTransaction(
      knownTxHash,
      {
        waitForCompletion: true,
        progressHook: (event) => {
          // Exact line from the website snippet
          console.log(`[${event.level}] ${event.id}: ${event.message}`);
          events.push(event);
        },
      }
    );

    // Verify we got events
    expect(events.length).toBeGreaterThan(0);

    // Verify NO event has undefined properties
    for (const event of events) {
      expect(event.id).toBeDefined();
      expect(event.id).not.toBe('undefined');
      expect(typeof event.id).toBe('string');

      expect(event.level).toBeDefined();
      expect(event.level).not.toBe('undefined');
      expect(['INFO', 'SUCCESS', 'WARNING', 'ERROR']).toContain(event.level);

      expect(event.message).toBeDefined();
      expect(event.message).not.toBe('undefined');
      expect(typeof event.message).toBe('string');
    }

    // Verify response fields from UniversalTxResponse
    expect(response.hash).toBe(knownTxHash);
    expect(response.blockNumber).toBeGreaterThan(BigInt(0));
    // Note: `status` is on UniversalTxReceipt (from wait()), NOT UniversalTxResponse
    expect(typeof response.wait).toBe('function');

    // Confirm status via wait()
    const receipt = await response.wait();
    expect(receipt.status).toBe(1);
    expect(receipt.gasUsed).toBeGreaterThan(BigInt(0));

    console.log(`W1 PASS — ${events.length} events, all properties populated`);
  }, 60000);

  // ═══════════════════════════════════════════════════════════════════
  // W2 — Event IDs are SEND-TX-*, NOT TRACK-TX-*
  //       (docs incorrectly reference TRACK-TX-* which don't exist)
  // ═══════════════════════════════════════════════════════════════════
  it('W2: events use SEND-TX-* IDs, not TRACK-TX-*', async () => {
    if (skipE2E || !knownTxHash) return;

    console.log('\n=== W2: Event ID prefix check ===');

    const events: ProgressEvent[] = [];
    await pushClient.universal.trackTransaction(knownTxHash, {
      waitForCompletion: true,
      progressHook: (event) => events.push(event),
    });

    // All event IDs should start with SEND-TX-
    for (const event of events) {
      expect(event.id).toMatch(/^SEND-TX-/);
    }

    // No TRACK-TX-* events should exist
    const trackEvents = events.filter((e) => e.id.startsWith('TRACK-TX'));
    expect(trackEvents).toHaveLength(0);

    // Must include SEND-TX-01 (origin detection) and SEND-TX-199-01 (success)
    expect(events.some((e) => e.id === 'SEND-TX-101')).toBe(true);
    expect(events.some((e) => e.id === 'SEND-TX-199-01')).toBe(true);

    console.log(
      'Event IDs:',
      events.map((e) => e.id).join(', ')
    );
    console.log('W2 PASS — all SEND-TX-*, no TRACK-TX-*');
  }, 60000);

  // ═══════════════════════════════════════════════════════════════════
  // W3 — Full ProgressEvent structure matches docs
  // ═══════════════════════════════════════════════════════════════════
  it('W3: ProgressEvent has all documented fields (id, title, message, level, timestamp)', async () => {
    if (skipE2E || !knownTxHash) return;

    console.log('\n=== W3: ProgressEvent structure ===');

    const events: ProgressEvent[] = [];
    await pushClient.universal.trackTransaction(knownTxHash, {
      waitForCompletion: true,
      progressHook: (event) => events.push(event),
    });

    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      // id
      expect(typeof event.id).toBe('string');
      expect(event.id.length).toBeGreaterThan(0);

      // title
      expect(typeof event.title).toBe('string');
      expect(event.title.length).toBeGreaterThan(0);

      // message
      expect(typeof event.message).toBe('string');
      expect(event.message.length).toBeGreaterThan(0);

      // level
      expect(['INFO', 'SUCCESS', 'WARNING', 'ERROR']).toContain(event.level);

      // timestamp — ISO-8601
      expect(typeof event.timestamp).toBe('string');
      expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
    }

    console.log(`W3 PASS — ${events.length} events, all fields valid`);
  }, 60000);

  // ═══════════════════════════════════════════════════════════════════
  // W4 — wait() vs trackTransaction() return consistent results
  //       (mirrors the website "Compare wait() vs trackTransaction()" snippet)
  // ═══════════════════════════════════════════════════════════════════
  it('W4: wait() and trackTransaction() return consistent results', async () => {
    if (skipE2E) return;

    console.log('\n=== W4: wait() vs trackTransaction() ===');

    const tx = await pushClient.universal.sendTransaction({
      to: KNOWN_TARGET as `0x${string}`,
      value: BigInt(100),
    });

    // Method 1: tx.wait()
    const receipt1 = await tx.wait();
    console.log(
      'wait() — Block:',
      receipt1.blockNumber.toString(),
      '| Status:',
      receipt1.status
    );

    // Method 2: trackTransaction() with the same hash
    const tracked = await pushClient.universal.trackTransaction(tx.hash, {
      waitForCompletion: true,
    });
    const receipt2 = await tracked.wait();
    console.log(
      'trackTransaction() — Block:',
      tracked.blockNumber.toString(),
      '| Status:',
      receipt2.status
    );

    // Both should return consistent results
    expect(receipt1.hash).toBe(tracked.hash);
    expect(receipt1.blockNumber).toBe(tracked.blockNumber);
    expect(receipt1.status).toBe(receipt2.status);

    console.log(
      'Results match:',
      receipt1.hash === tracked.hash &&
        receipt1.blockNumber === tracked.blockNumber
    );
    console.log('W4 PASS');
  }, 120000);

  // ═══════════════════════════════════════════════════════════════════
  // W5 — Orchestrator-level progressHook receives events during trackTransaction
  // ═══════════════════════════════════════════════════════════════════
  it('W5: orchestrator-level progressHook fires during trackTransaction', async () => {
    if (skipE2E || !knownTxHash) return;

    console.log('\n=== W5: Orchestrator-level progressHook ===');

    // Create a NEW client with orchestrator-level hook
    const orchestratorEvents: ProgressEvent[] = [];
    const setup = await createEvmPushClient({
      chain: CHAIN.PUSH_TESTNET_DONUT,
      privateKey: evmPrivateKey,
      progressHook: (event: ProgressEvent) => {
        const icon =
          event.level === 'SUCCESS'
            ? 'OK'
            : event.level === 'ERROR'
              ? 'ERR'
              : 'INFO';
        console.log(`${icon} [${event.level}] ${event.title}: ${event.message}`);
        orchestratorEvents.push(event);
      },
    });

    const perCallEvents: ProgressEvent[] = [];
    await setup.pushClient.universal.trackTransaction(knownTxHash, {
      waitForCompletion: true,
      progressHook: (event) => {
        perCallEvents.push(event);
      },
    });

    // Both hooks should have received events
    expect(orchestratorEvents.length).toBeGreaterThan(0);
    expect(perCallEvents.length).toBeGreaterThan(0);

    // Per-call and orchestrator should have the same event IDs
    const perCallIds = perCallEvents.map((e) => e.id).sort();
    const orchestratorIds = orchestratorEvents
      .filter((e) => e.id.startsWith('SEND-TX-'))
      .map((e) => e.id)
      .sort();

    expect(perCallIds).toEqual(orchestratorIds);

    console.log(
      `W5 PASS — orchestrator: ${orchestratorEvents.length}, per-call: ${perCallEvents.length}`
    );
  }, 60000);
});
