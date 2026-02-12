import { PushChain } from '../src';
import { PUSH_NETWORK, CHAIN } from '../src/lib/constants/enums';
import { CHAIN_INFO } from '../src/lib/constants/chain';
import { MOVEABLE_TOKENS } from '../src/lib/constants/tokens';
import { ProgressEvent } from '../src/lib/progress-hook/progress-hook.types';
import { UniversalTxResponse } from '../src/lib/orchestrator/orchestrator.types';
import { createWalletClient, http, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

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
        progress: (event: ProgressEvent) => {
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

/**
 * Cross-Chain Fund Transfer Progress Hooks Tests
 *
 * Tests verify that progress hooks capture all events during:
 * 1. Native ETH bridging from Ethereum Sepolia to Push Chain
 * 2. USDT (ERC-20) bridging from Ethereum Sepolia to Push Chain
 */
describe('Cross-Chain Fund Transfer Progress Hooks (e2e)', () => {
  const pushNetwork = PUSH_NETWORK.TESTNET_DONUT;
  const originChain = CHAIN.ETHEREUM_SEPOLIA;

  let pushClient: PushChain;
  let orchestratorEvents: ProgressEvent[];

  beforeAll(async () => {
    const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!privateKey) {
      console.log('EVM_PRIVATE_KEY not set, skipping cross-chain tests');
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

    orchestratorEvents = [];
    pushClient = await PushChain.initialize(universalSigner, {
      network: pushNetwork,
      progressHook: (event: ProgressEvent) => {
        orchestratorEvents.push(event);
        console.log(`[HOOK] ${event.id}: ${event.message}`);
      },
    });

    console.log(`\nUEA Address: ${pushClient.universal.account}`);
  }, 60000);

  beforeEach(() => {
    orchestratorEvents = [];
  });

  it('should emit all progress hooks when bridging native ETH', async () => {
    if (!pushClient) {
      console.log('Setup failed, skipping test');
      return;
    }

    const tokens = MOVEABLE_TOKENS[originChain] || [];
    const ethToken = tokens.find((t) => t.symbol === 'ETH');
    if (!ethToken) {
      console.log('ETH token not found for origin chain');
      return;
    }

    orchestratorEvents = [];
    const txEvents: ProgressEvent[] = [];
    const UEA = pushClient.universal.account;

    console.log('\n=== Test: Bridging native ETH (0.0001 ETH) ===');

    const tx = await pushClient.universal.sendTransaction({
      to: UEA as `0x${string}`,
      funds: {
        amount: PushChain.utils.helpers.parseUnits('0.0001', 18),
        token: ethToken,
      },
    });

    console.log(`TX Hash: ${tx.hash}`);

    // Register callback - should replay SEND_TX_* events immediately from buffer
    tx.progressHook((event: ProgressEvent) => {
      txEvents.push(event);
      console.log(`[TX.HOOK] ${event.id}: ${event.message}`);
    });

    // Log buffered events that were replayed
    console.log('\n=== Buffered Events Replayed via tx.progressHook() ===');
    txEvents.forEach((e, i) => {
      console.log(`${i + 1}. ${e.id}: ${e.title}`);
    });

    // Verify SEND_TX_* events were replayed from buffer via tx.progressHook()
    expect(txEvents.some((e) => e.id === 'SEND-TX-01')).toBe(true);
    expect(txEvents.some((e) => e.id === 'SEND-TX-06-01')).toBe(true);
    expect(txEvents.some((e) => e.id === 'SEND-TX-06-04')).toBe(true);
    expect(txEvents.some((e) => e.id === 'SEND-TX-06-05')).toBe(true);
    expect(txEvents.some((e) => e.id === 'SEND-TX-06-06')).toBe(true);
    expect(txEvents.some((e) => e.id === 'SEND-TX-99-01')).toBe(true);

    // Log orchestrator events
    console.log('\n=== Orchestrator Events ===');
    orchestratorEvents.forEach((e, i) => {
      console.log(`${i + 1}. ${e.id}: ${e.title}`);
    });

    // Verify orchestrator also received events
    expect(orchestratorEvents.some((e) => e.id === 'SEND-TX-01')).toBe(true);
    expect(orchestratorEvents.some((e) => e.id === 'SEND-TX-99-01')).toBe(true);

    console.log(
      `\n✓ tx.progressHook() received ${txEvents.length} buffered events, orchestrator received ${orchestratorEvents.length} events`
    );
  }, 300000);

  it('should emit all progress hooks when bridging USDT', async () => {
    if (!pushClient) {
      console.log('Setup failed, skipping test');
      return;
    }

    const tokens = MOVEABLE_TOKENS[originChain] || [];
    const usdtToken = tokens.find((t) => t.symbol === 'USDT');
    if (!usdtToken) {
      console.log('USDT token not found for origin chain');
      return;
    }

    orchestratorEvents = [];
    const txEvents: ProgressEvent[] = [];
    const UEA = pushClient.universal.account;

    console.log('\n=== Test: Bridging USDT (0.01 USDT) ===');

    const tx = await pushClient.universal.sendTransaction({
      to: UEA as `0x${string}`,
      funds: {
        amount: PushChain.utils.helpers.parseUnits('0.01', 6), // USDT has 6 decimals
        token: usdtToken,
      },
    });

    console.log(`TX Hash: ${tx.hash}`);

    // Register callback - should replay SEND_TX_* events immediately from buffer
    tx.progressHook((event: ProgressEvent) => {
      txEvents.push(event);
      console.log(`[TX.HOOK] ${event.id}: ${event.message}`);
    });

    // Log buffered events that were replayed
    console.log('\n=== Buffered Events Replayed via tx.progressHook() ===');
    txEvents.forEach((e, i) => {
      console.log(`${i + 1}. ${e.id}: ${e.title}`);
    });

    // Verify SEND_TX_* events were replayed from buffer via tx.progressHook()
    expect(txEvents.some((e) => e.id === 'SEND-TX-01')).toBe(true);
    // USDT may require approval - check for approval hooks if not already approved
    const hasApprovalHooks = txEvents.some(
      (e) => e.id === 'SEND-TX-04-01' || e.id === 'SEND-TX-04-02'
    );
    console.log(`Approval hooks emitted: ${hasApprovalHooks}`);
    expect(txEvents.some((e) => e.id === 'SEND-TX-06-01')).toBe(true);
    expect(txEvents.some((e) => e.id === 'SEND-TX-06-04')).toBe(true);
    expect(txEvents.some((e) => e.id === 'SEND-TX-06-05')).toBe(true);
    expect(txEvents.some((e) => e.id === 'SEND-TX-06-06')).toBe(true);
    expect(txEvents.some((e) => e.id === 'SEND-TX-99-01')).toBe(true);

    // Log orchestrator events
    console.log('\n=== Orchestrator Events ===');
    orchestratorEvents.forEach((e, i) => {
      console.log(`${i + 1}. ${e.id}: ${e.title}`);
    });

    // Verify orchestrator also received events
    expect(orchestratorEvents.some((e) => e.id === 'SEND-TX-01')).toBe(true);
    expect(orchestratorEvents.some((e) => e.id === 'SEND-TX-99-01')).toBe(true);

    console.log(
      `\n✓ tx.progressHook() received ${txEvents.length} buffered events, orchestrator received ${orchestratorEvents.length} events`
    );
  }, 300000);
});
