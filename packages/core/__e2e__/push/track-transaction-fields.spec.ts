import '@e2e/shared/setup';
import { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN } from '../../src/lib/constants/enums';
import { PushChain } from '../../src';
import { ProgressEvent } from '../../src/lib/progress-hook/progress-hook.types';
import { UniversalTxResponse } from '../../src/lib/orchestrator/orchestrator.types';
import { createEvmPushClient } from '@e2e/shared/evm-client';

/**
 * E2E tests for trackTransaction response field accuracy.
 *
 * Validates that `trackTransaction()` returns a response whose
 * from/to/value/origin/hash/route fields are consistent with what
 * `sendTransaction()` originally produced.
 *
 * Test matrix:
 *   S1 – Value-only transfer (user scenario: value + data:'0x')
 *   S2 – Tracked response fields match send response fields
 *   S3 – wait() on tracked response returns valid receipt
 *   S4 – Explorer URL generation for tracked hash
 *   S5 – Cross-origin tracking (Push Chain origin tracking same tx)
 *   S6 – Tracked response `to` matches intended recipient (not UEA)
 *   S7 – Track before calling wait() on send response
 */
describe('trackTransaction — response field accuracy', () => {
  const TARGET_ADDRESS = '0x35B84d6848D16415177c64D64504663b998A6ab4';
  const SEND_VALUE = BigInt(1000); // 1000 wei

  // ── shared state (one tx, reused) ─────────────────────────────────
  let pushClient: PushChain;
  let pushClientPushOrigin: PushChain; // same pk but Push Chain origin
  let sendResponse: UniversalTxResponse;
  let signerAddress: string;

  const evmPrivateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E = !evmPrivateKey;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('EVM_PRIVATE_KEY not set — skipping all tests');
      return;
    }

    const account = privateKeyToAccount(evmPrivateKey);
    signerAddress = account.address;

    // Client with Ethereum Sepolia origin (the common dApp flow)
    const evmSetup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey: evmPrivateKey,
      printTraces: true,
    });
    pushClient = evmSetup.pushClient;

    // Client with Push Chain origin (same private key)
    const pushSetup = await createEvmPushClient({
      chain: CHAIN.PUSH_TESTNET_DONUT,
      privateKey: evmPrivateKey,
    });
    pushClientPushOrigin = pushSetup.pushClient;

    // ── Send ONE transaction (value-only, data:'0x') ──────────────
    console.log('\n=== [beforeAll] Sending value-only transaction ===');
    sendResponse = await pushClient.universal.sendTransaction({
      to: TARGET_ADDRESS as `0x${string}`,
      value: SEND_VALUE,
      data: '0x',
    });
    console.log('Send TX Hash:', sendResponse.hash);
    console.log('Send origin:', sendResponse.origin);
    console.log('Send from:', sendResponse.from);
    console.log('Send to:', sendResponse.to);
    console.log('Send value:', sendResponse.value.toString());

    // Wait for confirmation so subsequent tracks are instant
    await sendResponse.wait();
    console.log('Send TX confirmed!\n');
  }, 180000);

  // ═══════════════════════════════════════════��═══════════════════════
  // S1 — Value-only transfer track (user scenario)
  // ═══════════════════════════════════════════════════════════════════
  it('S1: should track a value-only transfer (data:0x) successfully', async () => {
    if (skipE2E || !sendResponse) return;

    console.log('\n=== S1: Track value-only transfer ===');

    const tracked = await pushClient.universal.trackTransaction(
      sendResponse.hash,
      { waitForCompletion: true, advanced: { timeout: 30000 } }
    );

    expect(tracked).toBeDefined();
    expect(tracked.hash).toBe(sendResponse.hash);
    expect(tracked.blockNumber).toBeGreaterThan(BigInt(0));
    expect(typeof tracked.wait).toBe('function');
    expect(typeof tracked.progressHook).toBe('function');

    console.log('Tracked hash:', tracked.hash);
    console.log('Tracked origin:', tracked.origin);
    console.log('Tracked from:', tracked.from);
    console.log('Tracked to:', tracked.to);
    console.log('Tracked value:', tracked.value.toString());
    console.log('S1 PASS');
  }, 60000);

  // ═════════════════════════════════════════════════════��═════════════
  // S2 — Field consistency: send vs track
  // ═══════════════════════════════════════════════════════════════════
  it('S2: tracked response fields must match send response fields', async () => {
    if (skipE2E || !sendResponse) return;

    console.log('\n=== S2: Comparing send vs track fields ===');

    const tracked = await pushClient.universal.trackTransaction(
      sendResponse.hash,
      { waitForCompletion: true }
    );

    // Identity
    expect(tracked.hash).toBe(sendResponse.hash);

    // Block Info
    expect(tracked.blockNumber).toBe(sendResponse.blockNumber);
    expect(tracked.blockHash).toBe(sendResponse.blockHash);

    // Origin — must match (same signer context)
    console.log('  send.origin:', sendResponse.origin);
    console.log('  track.origin:', tracked.origin);
    expect(tracked.origin).toBe(sendResponse.origin);

    // Execution Context
    console.log('  send.from:', sendResponse.from);
    console.log('  track.from:', tracked.from);
    expect(tracked.from.toLowerCase()).toBe(sendResponse.from.toLowerCase());

    console.log('  send.to:', sendResponse.to);
    console.log('  track.to:', tracked.to);
    expect(tracked.to.toLowerCase()).toBe(sendResponse.to.toLowerCase());

    // Payload
    console.log('  send.value:', sendResponse.value.toString());
    console.log('  track.value:', tracked.value.toString());
    expect(tracked.value).toBe(sendResponse.value);

    // Nonce
    expect(tracked.nonce).toBe(sendResponse.nonce);

    console.log('S2 PASS — all fields consistent');
  }, 60000);

  // ═══════════════════════════════════════════════════════════════════
  // S3 — wait() on tracked response
  // ═══════════════════════════════════════════════════════════════════
  it('S3: wait() on tracked response returns valid receipt', async () => {
    if (skipE2E || !sendResponse) return;

    console.log('\n=== S3: wait() on tracked response ===');

    const tracked = await pushClient.universal.trackTransaction(
      sendResponse.hash,
      { waitForCompletion: true }
    );

    const receipt = await tracked.wait();

    expect(receipt).toBeDefined();
    expect(receipt.hash).toBe(sendResponse.hash);
    expect(receipt.status).toBe(1);
    expect(receipt.blockNumber).toBeGreaterThan(BigInt(0));
    expect(receipt.from).toBeDefined();
    expect(receipt.to).toBeDefined();

    console.log('Receipt status:', receipt.status);
    console.log('Receipt blockNumber:', receipt.blockNumber.toString());
    console.log('S3 PASS');
  }, 60000);

  // ═══════════════════════════════════════════════════════════════════
  // S4 — Explorer URL generation
  // ═══════════════════════════════════════════════════════════════════
  it('S4: explorer URL contains the correct tx hash', async () => {
    if (skipE2E || !sendResponse) return;

    console.log('\n=== S4: Explorer URL ===');

    const url = pushClient.explorer.getTransactionUrl(sendResponse.hash);

    console.log('Explorer URL:', url);

    expect(url).toContain(sendResponse.hash);
    expect(url).toMatch(/^https?:\/\//);
    // URL should point to Push Chain explorer (testnet donut)
    expect(url).toContain('/tx/');

    console.log('S4 PASS');
  }, 10000);

  // ════════════════════════════════════════════════════════════════��══
  // S5 — Cross-origin tracking: Push Chain origin tracks an ETH-origin tx
  // ════════════════════════════════��══════════════════════════════════
  it('S5: cross-origin tracking should still produce correct origin chain', async () => {
    if (skipE2E || !sendResponse) return;

    console.log('\n=== S5: Cross-origin tracking ===');

    // Track the SAME tx hash using a Push Chain origin client
    const trackedCross = await pushClientPushOrigin.universal.trackTransaction(
      sendResponse.hash,
      { waitForCompletion: true }
    );

    console.log('  send.origin (ETH context):', sendResponse.origin);
    console.log('  track.origin (PUSH context):', trackedCross.origin);
    console.log('  track.from (PUSH context):', trackedCross.from);
    console.log('  track.to (PUSH context):', trackedCross.to);
    console.log('  track.value (PUSH context):', trackedCross.value.toString());

    // Hash must still match
    expect(trackedCross.hash).toBe(sendResponse.hash);

    // The origin should reflect the TRANSACTION's origin chain, not the tracker's
    // The tx was sent from Ethereum Sepolia, so origin should contain Sepolia's chainId
    // BUG CHECK: If origin uses tracker's chainId (42101) instead of tx's origin chainId (11155111)
    const sendOriginParts = sendResponse.origin.split(':');
    const trackOriginParts = trackedCross.origin.split(':');

    console.log('  Expected origin namespace:chainId:', `${sendOriginParts[0]}:${sendOriginParts[1]}`);
    console.log('  Actual origin namespace:chainId:', `${trackOriginParts[0]}:${trackOriginParts[1]}`);

    // The chain namespace:chainId should match the sender's origin, not the tracker's
    expect(trackOriginParts[0]).toBe(sendOriginParts[0]); // same namespace (eip155)
    expect(trackOriginParts[1]).toBe(sendOriginParts[1]); // same chainId (should be 11155111, not 42101)

    console.log('S5 PASS — cross-origin tracking produces correct origin');
  }, 60000);

  // ═══════════════════════════════════════════════════════════════════
  // S6 — `to` field should be the intended recipient, NOT the UEA
  // ═══════════════════════════════════════════════════════════════════
  it('S6: tracked `to` field shows intended recipient, not UEA address', async () => {
    if (skipE2E || !sendResponse) return;

    console.log('\n=== S6: `to` field check ===');

    const tracked = await pushClient.universal.trackTransaction(
      sendResponse.hash,
      { waitForCompletion: true }
    );

    console.log('  Intended to:', TARGET_ADDRESS);
    console.log('  tracked.to:', tracked.to);
    console.log('  tracked.from:', tracked.from);

    // `to` must be the intended recipient, NOT the UEA
    expect(tracked.to.toLowerCase()).toBe(TARGET_ADDRESS.toLowerCase());

    // `from` should be the UEA (executor), not the cosmos sender
    // It should NOT be the target address
    expect(tracked.from.toLowerCase()).not.toBe(TARGET_ADDRESS.toLowerCase());

    console.log('S6 PASS');
  }, 60000);

  // ═══════════════════════════════════════════════════════════════════
  // S7 — Track before calling wait() on send response
  //       (simulates dApp tracking immediately after send)
  // ══════════════════════════════���════════════════════════════════════
  it('S7: track immediately after send (before wait) should succeed', async () => {
    if (skipE2E) return;

    console.log('\n=== S7: Send + immediate track ===');

    // Send a fresh transaction — do NOT call wait()
    const freshSend = await pushClient.universal.sendTransaction({
      to: TARGET_ADDRESS as `0x${string}`,
      value: BigInt(500),
    });

    console.log('Fresh TX Hash:', freshSend.hash);

    // Immediately track it (may need to poll briefly)
    const tracked = await pushClient.universal.trackTransaction(
      freshSend.hash,
      {
        waitForCompletion: true,
        advanced: { timeout: 60000 },
      }
    );

    expect(tracked.hash).toBe(freshSend.hash);
    expect(tracked.blockNumber).toBeGreaterThan(BigInt(0));

    // Also verify wait() works on the tracked response
    const receipt = await tracked.wait();
    expect(receipt.status).toBe(1);

    console.log('Tracked block:', tracked.blockNumber.toString());
    console.log('S7 PASS');
  }, 120000);

  // ══════════════════════════════════════════════════════════════════��
  // S8 — Progress events during tracking should include SEND-TX-01 and outcome
  // ══════════════════════════════════════════���════════════════════════
  it('S8: tracking emits SEND-TX-01 and outcome events with correct data', async () => {
    if (skipE2E || !sendResponse) return;

    console.log('\n=== S8: Progress event data validation ===');

    const events: ProgressEvent[] = [];
    const tracked = await pushClient.universal.trackTransaction(
      sendResponse.hash,
      {
        waitForCompletion: true,
        progressHook: (event) => {
          events.push(event);
          console.log(`  [EVENT] ${event.id}: ${event.message}`);
        },
      }
    );

    // Must have SEND-TX-01 (origin identification)
    const startEvent = events.find((e) => e.id === 'SEND-TX-01');
    expect(startEvent).toBeDefined();
    expect(startEvent!.message).toContain(signerAddress);

    // Must have outcome event (success or failure)
    const successEvent = events.find((e) => e.id === 'SEND-TX-99-01');
    const failEvent = events.find((e) => e.id === 'SEND-TX-99-02');
    expect(successEvent || failEvent).toBeTruthy();

    // No TRACK-TX-* events (those are deprecated)
    const hasTrackEvents = events.some((e) => e.id.startsWith('TRACK-TX'));
    expect(hasTrackEvents).toBe(false);

    console.log(`Total events: ${events.length}`);
    console.log('S8 PASS');
  }, 60000);

  // ═════════════════════���═════════════════════════════════════════════
  // S9 — Route detection for inbound Push Chain value transfer
  // ═══════════════════════════════════════════════════════════════════
  it('S9: value transfer should detect UOA_TO_PUSH or no route', async () => {
    if (skipE2E || !sendResponse) return;

    console.log('\n=== S9: Route detection ===');

    const tracked = await pushClient.universal.trackTransaction(
      sendResponse.hash,
      { waitForCompletion: true }
    );

    console.log('Detected route:', tracked.route);

    // For a simple Push Chain value transfer from Ethereum Sepolia origin,
    // route should be UOA_TO_PUSH or CEA_TO_PUSH or undefined
    if (tracked.route) {
      expect(['UOA_TO_PUSH', 'CEA_TO_PUSH']).toContain(tracked.route);
    }

    console.log('S9 PASS');
  }, 60000);
});
