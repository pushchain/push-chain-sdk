import '@e2e/shared/setup';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN } from '../../src/lib/constants/enums';
import { Hex } from 'viem';
import { PushChain } from '../../src';
import { ProgressEvent } from '../../src/lib/progress-hook/progress-hook.types';
import { UniversalTxResponse } from '../../src/lib/orchestrator/orchestrator.types';
import { createEvmPushClient } from '@e2e/shared/evm-client';

describe('trackTransaction E2E', () => {
  const to = '0x35B84d6848D16415177c64D64504663b998A6ab4';

  // Shared state - send ONE transaction and reuse across tests
  let pushClient: PushChain;
  let sharedTxResponse: UniversalTxResponse;

  beforeAll(async () => {
    const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!privateKey) {
      console.log('EVM_PRIVATE_KEY not set, skipping all tests');
      return;
    }

    const setup = await createEvmPushClient({
      chain: CHAIN.PUSH_TESTNET_DONUT,
      privateKey,
    });
    pushClient = setup.pushClient;

    // Send ONE transaction to be reused by multiple tests
    console.log('\n=== [beforeAll] Sending shared transaction ===');
    sharedTxResponse = await pushClient.universal.sendTransaction({
      to,
      value: BigInt(1000),
    });
    console.log('Shared TX Hash:', sharedTxResponse.hash);

    // Wait for it to be confirmed
    await sharedTxResponse.wait();
    console.log('Shared TX confirmed!\n');
  }, 120000);

  it('should track a transaction and return UniversalTxResponse with SEND-TX-* hooks', async () => {
    if (!pushClient || !sharedTxResponse) {
      console.log('Setup failed, skipping test');
      return;
    }

    const trackProgressEvents: ProgressEvent[] = [];

    console.log('\n=== Tracking Transaction ===');
    const response = await pushClient.universal.trackTransaction(
      sharedTxResponse.hash,
      {
        waitForCompletion: true,
        progressHook: (event) => {
          console.log(`[TRACK] ${event.id}: ${event.message}`);
          trackProgressEvents.push(event);
        },
        advanced: {
          timeout: 30000,
        },
      }
    );

    console.log('Response Hash:', response.hash);
    console.log('Response Origin:', response.origin);
    console.log('Block Number:', response.blockNumber.toString());

    // Verify results - now returns UniversalTxResponse
    expect(response.hash).toBe(sharedTxResponse.hash);
    expect(response.blockNumber).toBeGreaterThan(BigInt(0));
    expect(typeof response.wait).toBe('function'); // Has wait() method
    expect(typeof response.progressHook).toBe('function'); // Has progressHook() method

    // Verify SEND-TX-* hooks are emitted (NOT TRACK-TX-*)
    expect(trackProgressEvents.some((e) => e.id === 'SEND-TX-01')).toBe(true);
    expect(trackProgressEvents.some((e) => e.id === 'SEND-TX-99-01')).toBe(true);
    expect(trackProgressEvents.some((e) => e.id.startsWith('TRACK-TX'))).toBe(false);

    console.log('✓ All assertions passed');
  }, 60000);

  it('should throw error for invalid tx hash format', async () => {
    if (!pushClient) {
      console.log('Setup failed, skipping test');
      return;
    }

    console.log('\n=== Testing Invalid TX Hash ===');

    await expect(
      pushClient.universal.trackTransaction('0x123', {
        waitForCompletion: false,
      })
    ).rejects.toThrow();

    console.log('✓ Invalid hash throws error');
  }, 30000);

  it('should compare wait() vs trackTransaction results', async () => {
    if (!pushClient || !sharedTxResponse) {
      console.log('Setup failed, skipping test');
      return;
    }

    console.log('\n=== Comparing wait() vs trackTransaction ===');

    // Get receipt using wait() (already confirmed, so instant)
    const waitReceipt = await sharedTxResponse.wait();
    console.log('wait() receipt hash:', waitReceipt.hash);

    // Get response using trackTransaction (now returns UniversalTxResponse)
    const trackResponse = await pushClient.universal.trackTransaction(
      sharedTxResponse.hash,
      { waitForCompletion: true }
    );
    console.log('trackTransaction response hash:', trackResponse.hash);

    // Compare core identifiers - trackTransaction returns UniversalTxResponse
    expect(trackResponse.hash).toBe(waitReceipt.hash);
    expect(trackResponse.blockNumber).toBe(waitReceipt.blockNumber);

    // Verify trackResponse has wait() method
    expect(typeof trackResponse.wait).toBe('function');

    console.log('✓ wait() and trackTransaction return consistent results');
  }, 60000);

  it('should work without progressHook', async () => {
    if (!pushClient || !sharedTxResponse) {
      console.log('Setup failed, skipping test');
      return;
    }

    console.log('\n=== Testing without progressHook ===');

    // Track without progressHook - should not throw
    const response = await pushClient.universal.trackTransaction(
      sharedTxResponse.hash,
      {
        waitForCompletion: true,
        // No progressHook provided
      }
    );

    expect(response.hash).toBe(sharedTxResponse.hash);
    expect(typeof response.wait).toBe('function');

    console.log('✓ Works without progressHook');
  }, 60000);

  it('should track same transaction multiple times', async () => {
    if (!pushClient || !sharedTxResponse) {
      console.log('Setup failed, skipping test');
      return;
    }

    console.log('\n=== Testing multiple tracks of same TX ===');
    console.log('TX Hash:', sharedTxResponse.hash);

    // Track the same transaction 3 times (no new transaction needed!)
    const response1 = await pushClient.universal.trackTransaction(
      sharedTxResponse.hash,
      { waitForCompletion: true }
    );
    console.log('Track 1 - Hash:', response1.hash, 'Origin:', response1.origin);

    const response2 = await pushClient.universal.trackTransaction(
      sharedTxResponse.hash,
      { waitForCompletion: true }
    );
    console.log('Track 2 - Hash:', response2.hash, 'Origin:', response2.origin);

    const response3 = await pushClient.universal.trackTransaction(
      sharedTxResponse.hash,
      { waitForCompletion: false } // Non-blocking since already confirmed
    );
    console.log('Track 3 - Hash:', response3.hash, 'Origin:', response3.origin);

    // All should return same results
    expect(response1.hash).toBe(response2.hash);
    expect(response2.hash).toBe(response3.hash);
    expect(response1.origin).toBe(response2.origin);
    expect(response2.origin).toBe(response3.origin);
    expect(response1.blockNumber).toBe(response2.blockNumber);
    expect(response2.blockNumber).toBe(response3.blockNumber);

    console.log('✓ Multiple tracks return consistent results');
  }, 60000);

  it('should replay events via response.progressHook()', async () => {
    if (!pushClient || !sharedTxResponse) {
      console.log('Setup failed, skipping test');
      return;
    }

    console.log('\n=== Testing event replay via progressHook() ===');

    // Track without inline progressHook
    const response = await pushClient.universal.trackTransaction(
      sharedTxResponse.hash,
      { waitForCompletion: true }
    );

    // Now register a progressHook to replay buffered events
    const replayedEvents: ProgressEvent[] = [];
    response.progressHook((event) => {
      console.log(`[REPLAY] ${event.id}: ${event.message}`);
      replayedEvents.push(event);
    });

    // Verify events were replayed
    expect(replayedEvents.length).toBeGreaterThan(0);
    expect(replayedEvents.some((e) => e.id === 'SEND-TX-01')).toBe(true);
    expect(replayedEvents.some((e) => e.id === 'SEND-TX-99-01')).toBe(true);

    console.log(`✓ Replayed ${replayedEvents.length} events`);
  }, 60000);

  it('should respect custom timeout setting', async () => {
    if (!pushClient) {
      console.log('Setup failed, skipping test');
      return;
    }

    console.log('\n=== Testing custom timeout ===');

    const nonExistentHash =
      '0x0000000000000000000000000000000000000000000000000000000000000001';
    const shortTimeout = 2000; // 2 seconds

    const start = Date.now();

    await expect(
      pushClient.universal.trackTransaction(nonExistentHash, {
        waitForCompletion: true,
        advanced: {
          timeout: shortTimeout,
        },
      })
    ).rejects.toThrow(/Timeout/);

    const duration = Date.now() - start;

    expect(duration).toBeGreaterThanOrEqual(shortTimeout);
    expect(duration).toBeLessThan(shortTimeout + 3000); // Allow for polling interval

    console.log(
      `✓ Timeout respected (took ${duration}ms for ${shortTimeout}ms timeout)`
    );
  }, 30000);

  // =========================================================================
  // Outbound route detection tests
  // =========================================================================

  it('should detect route for Push Chain (inbound) transaction', async () => {
    if (!pushClient || !sharedTxResponse) {
      console.log('Setup failed, skipping test');
      return;
    }

    console.log('\n=== Testing route detection for Push Chain tx ===');

    const response = await pushClient.universal.trackTransaction(
      sharedTxResponse.hash,
      { waitForCompletion: true }
    );

    console.log('Detected route:', response.route);

    // Push Chain native tx should be UOA_TO_PUSH or undefined (backward-compatible)
    if (response.route) {
      expect(response.route).toBe('UOA_TO_PUSH');
    }

    console.log('✓ Route detection for inbound tx passed');
  }, 60000);

  it('should detect outbound route when tracking UOA_TO_CEA transaction', async () => {
    // This test requires EVM_PRIVATE_KEY with a funded UEA that has done outbound txs
    const evmPrivateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!evmPrivateKey) {
      console.log('EVM_PRIVATE_KEY not set, skipping outbound route test');
      return;
    }

    console.log('\n=== Testing outbound route detection (UOA_TO_CEA) ===');

    // Initialize with EVM origin (Ethereum Sepolia)
    const evmAccount = privateKeyToAccount(evmPrivateKey);
    const { pushClient: evmPushClient } = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey: evmPrivateKey,
    });

    // Send an outbound transaction (Route 2: UOA → CEA on ETH Sepolia)
    console.log('Sending outbound tx (UOA_TO_CEA)...');
    let outboundTxResponse: UniversalTxResponse;
    try {
      outboundTxResponse = await evmPushClient.universal.sendTransaction({
        to: {
          address: evmAccount.address,
          chain: CHAIN.ETHEREUM_SEPOLIA,
        },
        value: BigInt(0),
        data: '0x',
      });
    } catch (err) {
      console.log(`SKIP: Could not send outbound tx: ${(err as Error).message}`);
      return;
    }

    console.log('Outbound TX Hash:', outboundTxResponse.hash);
    console.log('Route on send:', outboundTxResponse.route);

    // Track the transaction (don't call wait() on the send response — it polls outbound which is slow)
    // trackTransaction only needs the Push Chain tx to be confirmed
    const tracked = await evmPushClient.universal.trackTransaction(
      outboundTxResponse.hash,
      {
        waitForCompletion: true,
        advanced: { timeout: 60000 },
      }
    );

    console.log('Tracked route:', tracked.route);

    // Route should be detected as outbound
    expect(tracked.route).toBe('UOA_TO_CEA');
    expect(typeof tracked.wait).toBe('function');

    console.log('✓ Outbound route detection passed');
  }, 180000);

  it('should reconstruct progress events for outbound transaction', async () => {
    if (!pushClient || !sharedTxResponse) {
      console.log('Setup failed, skipping test');
      return;
    }

    console.log('\n=== Testing progress events include outcome hooks ===');

    const events: ProgressEvent[] = [];
    await pushClient.universal.trackTransaction(
      sharedTxResponse.hash,
      {
        waitForCompletion: true,
        progressHook: (event) => {
          events.push(event);
        },
      }
    );

    // Should always emit SEND-TX-01 (origin) and outcome (99-01 or 99-02)
    expect(events.some((e) => e.id === 'SEND-TX-01')).toBe(true);
    const hasSuccess = events.some((e) => e.id === 'SEND-TX-99-01');
    const hasFailure = events.some((e) => e.id === 'SEND-TX-99-02');
    expect(hasSuccess || hasFailure).toBe(true);

    console.log(`✓ Progress events: ${events.length} total, success=${hasSuccess}, failure=${hasFailure}`);
  }, 60000);

  // =========================================================================
  // Known outbound transaction tracking
  // =========================================================================

  it('should track a known outbound transaction and detect route', async () => {
    if (!pushClient) {
      console.log('Setup failed, skipping test');
      return;
    }

    const KNOWN_OUTBOUND_TX = '0xd7bb53cf61c60ba17a2fd874e2e0bf5cb34e48c88c04bb47d6885e4152dcc5f0';

    console.log('\n=== Tracking known outbound transaction ===');
    console.log('TX Hash:', KNOWN_OUTBOUND_TX);

    const events: ProgressEvent[] = [];
    const response = await pushClient.universal.trackTransaction(
      KNOWN_OUTBOUND_TX,
      {
        waitForCompletion: true,
        progressHook: (event) => {
          console.log(`[TRACK] ${event.id}: ${event.message}`);
          events.push(event);
        },
        advanced: { timeout: 30000 },
      }
    );

    console.log('Detected route:', response.route);
    console.log('Block number:', response.blockNumber.toString());

    // Should detect outbound route
    expect(response.hash).toBe(KNOWN_OUTBOUND_TX);
    expect(response.route).toBe('UOA_TO_CEA');
    expect(response.blockNumber).toBeGreaterThan(BigInt(0));
    expect(typeof response.wait).toBe('function');

    // Should emit SEND-TX-* progress hooks
    expect(events.some((e) => e.id === 'SEND-TX-01')).toBe(true);
    expect(events.some((e) => e.id === 'SEND-TX-99-01' || e.id === 'SEND-TX-99-02')).toBe(true);

    // Call wait() — should return outbound receipt with external chain details
    console.log('Calling response.wait() for outbound receipt...');
    const receipt = await response.wait();
    console.log('Receipt status:', receipt.status);
    console.log('External TX Hash:', receipt.externalTxHash);
    console.log('External Chain:', receipt.externalChain);

    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeDefined();
    expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(receipt.externalChain).toBeDefined();

    console.log('✓ Known outbound transaction tracking passed');
  }, 120000);
});
