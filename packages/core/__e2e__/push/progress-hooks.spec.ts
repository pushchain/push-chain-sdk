import '@e2e/shared/setup';
import { PushChain } from '../../src';
import { PUSH_NETWORK, CHAIN } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { ProgressEvent } from '../../src/lib/progress-hook/progress-hook.types';
import { UniversalTxResponse } from '../../src/lib/orchestrator/orchestrator.types';
import { createWalletClient, http, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * E2E tests for tx.progressHook() method feature.
 *
 * Tests verify that:
 * 1. tx.progressHook() method registers callback
 * 2. Registered callback receives TRACK_TX_* events during wait()
 * 3. Both tx.progressHook and orchestrator hooks work together
 * 4. trackTransaction progress callback still works
 */
describe('tx.progressHook() Method (e2e)', () => {
  const pushNetwork = PUSH_NETWORK.TESTNET_DONUT;
  const originChain = CHAIN.PUSH_TESTNET_DONUT;
  const to = '0x35B84d6848D16415177c64D64504663b998A6ab4';

  let pushClient: PushChain;
  let orchestratorEvents: ProgressEvent[];
  let sharedTxResponse: UniversalTxResponse;

  beforeAll(async () => {
    const privateKey = process.env['PUSH_PRIVATE_KEY'] as Hex;
    if (!privateKey) {
      console.log('PUSH_PRIVATE_KEY not set, skipping all tests');
      return;
    }

    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient,
      {
        chain: originChain,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );

    // Initialize client WITH orchestrator-level hook to test both hook scenarios
    orchestratorEvents = [];
    pushClient = await PushChain.initialize(universalSigner, {
      network: pushNetwork,
      progressHook: (event: ProgressEvent) => {
        orchestratorEvents.push({
          ...event,
          _source: 'orchestrator',
        } as ProgressEvent & { _source: string });
      },
    });

    // Send ONE transaction to be reused by tracking tests
    console.log('\n=== [beforeAll] Sending shared transaction ===');
    sharedTxResponse = await pushClient.universal.sendTransaction({
      to,
      value: BigInt(1000),
    });
    console.log('Shared TX Hash:', sharedTxResponse.hash);
    await sharedTxResponse.wait();
    console.log('Shared TX confirmed!\n');
  }, 120000);

  beforeEach(() => {
    // Clear orchestrator events before each test
    orchestratorEvents = [];
  });

  it('should call tx.progressHook callback during wait()', async () => {
    if (!pushClient) {
      console.log('Setup failed, skipping test');
      return;
    }

    const methodEvents: ProgressEvent[] = [];
    orchestratorEvents = []; // Clear

    console.log('\n=== Test: tx.progressHook() method receives events during wait() ===');

    const tx = await pushClient.universal.sendTransaction({
      to,
      value: BigInt(100),
    });

    // Register callback AFTER getting tx (new API)
    tx.progressHook((event: ProgressEvent) => {
      methodEvents.push(event);
      console.log(`[TX.HOOK] ${event.id}: ${event.message}`);
    });

    // Wait triggers tracking events
    await tx.wait();

    // Should have received TRACK_TX_* events
    expect(methodEvents.length).toBeGreaterThan(0);
    expect(methodEvents.some((e) => e.id === 'TRACK-TX-01')).toBe(true);
    expect(methodEvents.some((e) => e.id === 'TRACK-TX-99-01')).toBe(true);

    console.log(`✓ tx.progressHook() received ${methodEvents.length} events`);
  }, 60000);

  it('should call both tx.progressHook and orchestrator hook', async () => {
    if (!pushClient) {
      console.log('Setup failed, skipping test');
      return;
    }

    const methodEvents: ProgressEvent[] = [];
    orchestratorEvents = []; // Clear

    console.log('\n=== Test: Both hooks receive events ===');

    const tx = await pushClient.universal.sendTransaction({
      to,
      value: BigInt(100),
    });

    // Register method callback
    tx.progressHook((event: ProgressEvent) => {
      methodEvents.push(event);
    });

    await tx.wait();

    // Both should have received TRACK_TX_* events
    expect(methodEvents.length).toBeGreaterThan(0);
    expect(orchestratorEvents.length).toBeGreaterThan(0);

    // Verify both have the same events
    for (const methodEvent of methodEvents) {
      const orchestratorEvent = orchestratorEvents.find(
        (e) => e.id === methodEvent.id
      );
      expect(orchestratorEvent).toBeDefined();
    }

    console.log(
      `✓ tx.progressHook received ${methodEvents.length} events, orchestrator received ${orchestratorEvents.length} events`
    );
  }, 60000);

  it('should work with trackTransaction progress callback', async () => {
    if (!pushClient || !sharedTxResponse) {
      console.log('Setup failed, skipping test');
      return;
    }

    const trackEvents: ProgressEvent[] = [];
    orchestratorEvents = []; // Clear

    console.log('\n=== Test: trackTransaction with progress callback ===');
    const receipt = await pushClient.universal.trackTransaction(
      sharedTxResponse.hash,
      {
        waitForCompletion: true,
        progressHook: (event: ProgressEvent) => {
          console.log(`[TRACK] ${event.id}: ${event.message}`);
          trackEvents.push(event);
        },
        advanced: {
          timeout: 30000,
        },
      }
    );

    expect(receipt.hash).toBe(sharedTxResponse.hash);
    expect(trackEvents.some((e) => e.id === 'TRACK-TX-01')).toBe(true);
    expect(trackEvents.some((e) => e.id === 'TRACK-TX-99-01')).toBe(true);

    // Both per-tx and orchestrator hooks should have received events
    expect(orchestratorEvents.length).toBeGreaterThan(0);

    console.log(
      `✓ trackTransaction received ${trackEvents.length} per-tx events and ${orchestratorEvents.length} orchestrator events`
    );
  }, 60000);

  it('should work without tx.progressHook (orchestrator only)', async () => {
    if (!pushClient) {
      console.log('Setup failed, skipping test');
      return;
    }

    orchestratorEvents = []; // Clear

    console.log('\n=== Test: Orchestrator hook only (no tx.progressHook) ===');
    const tx = await pushClient.universal.sendTransaction({
      to,
      value: BigInt(100),
      // No tx.progressHook() called
    });

    await tx.wait();

    // Orchestrator hook should still receive SEND_TX_* events
    expect(orchestratorEvents.length).toBeGreaterThan(0);
    expect(orchestratorEvents.some((e) => e.id === 'SEND-TX-01')).toBe(true);
    expect(orchestratorEvents.some((e) => e.id === 'SEND-TX-99-01')).toBe(true);

    console.log(
      `✓ Orchestrator hook received ${orchestratorEvents.length} events (no tx.progressHook)`
    );
  }, 60000);

  it('should receive events with expected structure via tx.progressHook', async () => {
    if (!pushClient) {
      console.log('Setup failed, skipping test');
      return;
    }

    const methodEvents: ProgressEvent[] = [];

    console.log('\n=== Test: Event structure validation via tx.progressHook ===');
    const tx = await pushClient.universal.sendTransaction({
      to,
      value: BigInt(100),
    });

    tx.progressHook((event: ProgressEvent) => {
      methodEvents.push(event);
    });

    await tx.wait();

    // Verify event structure
    expect(methodEvents.length).toBeGreaterThan(0);

    for (const event of methodEvents) {
      expect(event.id).toBeDefined();
      expect(typeof event.id).toBe('string');
      expect(event.title).toBeDefined();
      expect(typeof event.title).toBe('string');
      expect(event.message).toBeDefined();
      expect(typeof event.message).toBe('string');
      expect(['INFO', 'SUCCESS', 'WARNING', 'ERROR']).toContain(event.level);
      expect(event.timestamp).toBeDefined();
      expect(typeof event.timestamp).toBe('string');
    }

    // Verify expected TRACK_TX events are present
    expect(methodEvents.some((e) => e.id === 'TRACK-TX-01')).toBe(true);
    expect(methodEvents.some((e) => e.id === 'TRACK-TX-99-01')).toBe(true);

    console.log(`✓ All ${methodEvents.length} events have valid structure`);
  }, 60000);
});
