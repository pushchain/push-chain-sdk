/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { createWalletClient, http, Hex } from 'viem';
import { sepolia } from 'viem/chains';
import { PushChain } from '../../src';
import { ProgressEvent } from '../../src/lib/progress-hook/progress-hook.types';
import {
  UniversalTxResponse,
  type UniversalExecuteParams,
} from '../../src/lib/orchestrator/orchestrator.types';
import { TransactionRoute, detectRoute } from '../../src/lib/orchestrator/route-detector';
import { getCEAAddress } from '../../src/lib/orchestrator/cea-utils';
import { buildErc20WithdrawalMulticall } from '../../src/lib/orchestrator/payload-builders';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { getToken } from '@e2e/shared/constants';
import { TEST_TARGET, ensureCeaErc20Balance } from '@e2e/shared/outbound-helpers';
import {
  COUNTER_ADDRESS_PAYABLE,
  COUNTER_ABI_PAYABLE,
} from '@e2e/shared/inbound-helpers';
import {
  PUSH_CHAIN_DEF,
  fundSepoliaUoa,
  fundUeaPC,
  makeSepoliaContext,
  makePushContext,
} from '../docs-examples/_helpers/docs-fund';

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
    expect(trackProgressEvents.some((e) => e.id === 'SEND-TX-101')).toBe(true);
    expect(trackProgressEvents.some((e) => e.id === 'SEND-TX-199-01')).toBe(true);
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
    expect(replayedEvents.some((e) => e.id === 'SEND-TX-101')).toBe(true);
    expect(replayedEvents.some((e) => e.id === 'SEND-TX-199-01')).toBe(true);

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
    expect(events.some((e) => e.id === 'SEND-TX-101')).toBe(true);
    const hasSuccess = events.some((e) => e.id === 'SEND-TX-199-01');
    const hasFailure = events.some((e) => e.id === 'SEND-TX-199-02');
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

    // R2 trackTransaction reconstructs the route-correct sequence (no R1
    // 101 leakage). 201 is the route entry; 207 closes the execute backbone
    // before wait() drives the external poll terminal. The intermediate
    // 299-99 marker is emitted internally but suppressed at the consumer
    // dispatch boundary, so we don't check for it here.
    expect(events.some((e) => e.id === 'SEND-TX-201')).toBe(true);
    expect(events.some((e) => e.id === 'SEND-TX-207')).toBe(true);
    // R1 IDs must not leak into an R2 stream
    expect(events.some((e) => e.id === 'SEND-TX-101')).toBe(false);
    expect(events.some((e) => e.id === 'SEND-TX-199-01')).toBe(false);

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
    // R2 (no inbound round-trip): finalTxHash resolves to the external outbound leg.
    expect(receipt.finalTxHash).toBe(receipt.externalTxHash);

    console.log('✓ Known outbound transaction tracking passed');
  }, 120000);
});

// ============================================================================
// trackTransaction — response field accuracy
// Validates that trackTransaction() returns a response whose from/to/value/
// origin/hash/route fields are consistent with sendTransaction()'s response.
// ============================================================================
describe('trackTransaction — response field accuracy', () => {
  const TARGET_ADDRESS_TTF = '0x35B84d6848D16415177c64D64504663b998A6ab4';
  const SEND_VALUE_TTF = BigInt(1000);

  let pushClientTTF: PushChain;
  let pushClientPushOriginTTF: PushChain;
  let sendResponseTTF: UniversalTxResponse;
  let signerAddressTTF: string;

  const evmPrivateKeyTTF = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E_TTF = !evmPrivateKeyTTF;

  beforeAll(async () => {
    if (skipE2E_TTF) {
      console.log('EVM_PRIVATE_KEY not set — skipping all tests');
      return;
    }

    const account = privateKeyToAccount(evmPrivateKeyTTF);
    signerAddressTTF = account.address;

    const evmSetup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey: evmPrivateKeyTTF,
      printTraces: true,
    });
    pushClientTTF = evmSetup.pushClient;

    const pushSetup = await createEvmPushClient({
      chain: CHAIN.PUSH_TESTNET_DONUT,
      privateKey: evmPrivateKeyTTF,
    });
    pushClientPushOriginTTF = pushSetup.pushClient;

    console.log('\n=== [beforeAll] Sending value-only transaction ===');
    sendResponseTTF = await pushClientTTF.universal.sendTransaction({
      to: TARGET_ADDRESS_TTF as `0x${string}`,
      value: SEND_VALUE_TTF,
      data: '0x',
    });
    console.log('Send TX Hash:', sendResponseTTF.hash);

    await sendResponseTTF.wait();
    console.log('Send TX confirmed!\n');
  }, 180000);

  it('S1: should track a value-only transfer (data:0x) successfully', async () => {
    if (skipE2E_TTF || !sendResponseTTF) return;

    const tracked = await pushClientTTF.universal.trackTransaction(
      sendResponseTTF.hash,
      { waitForCompletion: true, advanced: { timeout: 30000 } }
    );

    expect(tracked).toBeDefined();
    expect(tracked.hash).toBe(sendResponseTTF.hash);
    expect(tracked.blockNumber).toBeGreaterThan(BigInt(0));
    expect(typeof tracked.wait).toBe('function');
    expect(typeof tracked.progressHook).toBe('function');
  }, 60000);

  it('S2: tracked response fields must match send response fields', async () => {
    if (skipE2E_TTF || !sendResponseTTF) return;

    const tracked = await pushClientTTF.universal.trackTransaction(
      sendResponseTTF.hash,
      { waitForCompletion: true }
    );

    expect(tracked.hash).toBe(sendResponseTTF.hash);
    expect(tracked.blockNumber).toBe(sendResponseTTF.blockNumber);
    expect(tracked.blockHash).toBe(sendResponseTTF.blockHash);
    expect(tracked.origin).toBe(sendResponseTTF.origin);
    expect(tracked.from.toLowerCase()).toBe(sendResponseTTF.from.toLowerCase());
    expect(tracked.to.toLowerCase()).toBe(sendResponseTTF.to.toLowerCase());
    expect(tracked.value).toBe(sendResponseTTF.value);
    expect(tracked.nonce).toBe(sendResponseTTF.nonce);
  }, 60000);

  it('S3: wait() on tracked response returns valid receipt', async () => {
    if (skipE2E_TTF || !sendResponseTTF) return;

    const tracked = await pushClientTTF.universal.trackTransaction(
      sendResponseTTF.hash,
      { waitForCompletion: true }
    );

    const receipt = await tracked.wait();

    expect(receipt).toBeDefined();
    expect(receipt.hash).toBe(sendResponseTTF.hash);
    expect(receipt.status).toBe(1);
    expect(receipt.blockNumber).toBeGreaterThan(BigInt(0));
  }, 60000);

  it('S4: explorer URL contains the correct tx hash', async () => {
    if (skipE2E_TTF || !sendResponseTTF) return;

    const url = pushClientTTF.explorer.getTransactionUrl(sendResponseTTF.hash);

    expect(url).toContain(sendResponseTTF.hash);
    expect(url).toMatch(/^https?:\/\//);
    expect(url).toContain('/tx/');
  }, 10000);

  it('S5: cross-origin tracking should still produce correct origin chain', async () => {
    if (skipE2E_TTF || !sendResponseTTF) return;

    const trackedCross = await pushClientPushOriginTTF.universal.trackTransaction(
      sendResponseTTF.hash,
      { waitForCompletion: true }
    );

    expect(trackedCross.hash).toBe(sendResponseTTF.hash);

    const sendOriginParts = sendResponseTTF.origin.split(':');
    const trackOriginParts = trackedCross.origin.split(':');

    expect(trackOriginParts[0]).toBe(sendOriginParts[0]);
    expect(trackOriginParts[1]).toBe(sendOriginParts[1]);
  }, 60000);

  it('S6: tracked `to` field shows intended recipient, not UEA address', async () => {
    if (skipE2E_TTF || !sendResponseTTF) return;

    const tracked = await pushClientTTF.universal.trackTransaction(
      sendResponseTTF.hash,
      { waitForCompletion: true }
    );

    expect(tracked.to.toLowerCase()).toBe(TARGET_ADDRESS_TTF.toLowerCase());
    expect(tracked.from.toLowerCase()).not.toBe(TARGET_ADDRESS_TTF.toLowerCase());
  }, 60000);

  it('S7: track immediately after send (before wait) should succeed', async () => {
    if (skipE2E_TTF) return;

    const freshSend = await pushClientTTF.universal.sendTransaction({
      to: TARGET_ADDRESS_TTF as `0x${string}`,
      value: BigInt(500),
    });

    const tracked = await pushClientTTF.universal.trackTransaction(
      freshSend.hash,
      {
        waitForCompletion: true,
        advanced: { timeout: 60000 },
      }
    );

    expect(tracked.hash).toBe(freshSend.hash);
    expect(tracked.blockNumber).toBeGreaterThan(BigInt(0));

    const receipt = await tracked.wait();
    expect(receipt.status).toBe(1);
  }, 120000);

  it('S8: tracking emits SEND-TX-01 and outcome events with correct data', async () => {
    if (skipE2E_TTF || !sendResponseTTF) return;

    const events: ProgressEvent[] = [];
    await pushClientTTF.universal.trackTransaction(
      sendResponseTTF.hash,
      {
        waitForCompletion: true,
        progressHook: (event) => {
          events.push(event);
        },
      }
    );

    const startEvent = events.find((e) => e.id === 'SEND-TX-101');
    expect(startEvent).toBeDefined();
    expect(startEvent!.message).toContain(signerAddressTTF);

    const successEvent = events.find((e) => e.id === 'SEND-TX-199-01');
    const failEvent = events.find((e) => e.id === 'SEND-TX-199-02');
    expect(successEvent || failEvent).toBeTruthy();

    const hasTrackEvents = events.some((e) => e.id.startsWith('TRACK-TX'));
    expect(hasTrackEvents).toBe(false);
  }, 60000);

  it('S9: value transfer should detect UOA_TO_PUSH or no route', async () => {
    if (skipE2E_TTF || !sendResponseTTF) return;

    const tracked = await pushClientTTF.universal.trackTransaction(
      sendResponseTTF.hash,
      { waitForCompletion: true }
    );

    if (tracked.route) {
      expect(['UOA_TO_PUSH', 'CEA_TO_PUSH']).toContain(tracked.route);
    }
  }, 60000);
});

// ============================================================================
// Route 1 progress-hook parity (live vs tx.progressHook vs trackTransaction replay)
// ============================================================================
describe('Route 1 progress-hook parity (live vs tx.progressHook vs trackTransaction replay)', () => {
  const evmKeyR1 = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;
  const pushKeyR1 = process.env['PUSH_PRIVATE_KEY'] as Hex | undefined;

  const R1_PUSH_ORIGIN_EXPECTED = [
    'SEND-TX-101',
    'SEND-TX-102-01',
    'SEND-TX-103-03-04',
    'SEND-TX-107',
    'SEND-TX-199-01',
  ];

  const R1_PUSH_ORIGIN_RECONSTRUCTED = R1_PUSH_ORIGIN_EXPECTED;

  const R1_FUNDS_BRIDGE_EXPECTED = [
    'SEND-TX-101',
    'SEND-TX-102-01',
    'SEND-TX-103-01',
    'SEND-TX-103-02',
    'SEND-TX-103-03',
    'SEND-TX-103-03-01',
    'SEND-TX-103-03-04',
    'SEND-TX-106-01',
    'SEND-TX-106-02',
    'SEND-TX-106-03',
    'SEND-TX-106-03-02',
    'SEND-TX-106-04',
    'SEND-TX-106-05',
    'SEND-TX-106-06',
    'SEND-TX-107',
    'SEND-TX-199-01',
  ];

  const R1_EXTERNAL_ORIGIN_RECONSTRUCTED = [
    'SEND-TX-101',
    'SEND-TX-102-01',
    'SEND-TX-103-01',
    'SEND-TX-103-02',
    'SEND-TX-103-03-04',
    'SEND-TX-107',
    'SEND-TX-199-01',
  ];

  const R1_FEE_LOCK_EXPECTED = [
    'SEND-TX-101',
    'SEND-TX-102-01',
    'SEND-TX-103-01',
    'SEND-TX-103-02',
    'SEND-TX-103-03-04',
    'SEND-TX-104-01',
    'SEND-TX-105-01',
    'SEND-TX-105-02',
    'SEND-TX-107',
    'SEND-TX-199-01',
  ];

  (pushKeyR1 ? it : it.skip)(
    'A. Push UOA signature path — three streams match spec',
    async () => {
      const pushCtx = makePushContext(pushKeyR1 as Hex);
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        chain: PUSH_CHAIN_DEF,
        transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
      });
      await fundUeaPC(pushCtx, account.address, '1');

      const signer = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
        chain: CHAIN.PUSH_TESTNET_DONUT,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      });

      const liveEvents: ProgressEvent[] = [];
      const client = await PushChain.initialize(signer, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        progressHook: (e) => liveEvents.push(e),
      });

      const tx = await client.universal.sendTransaction({
        to: '0x35B84d6848D16415177c64D64504663b998A6ab4',
        value: BigInt(100),
      });

      const hookEvents: ProgressEvent[] = [];
      tx.progressHook((e) => hookEvents.push(e));

      await tx.wait();

      const trackReplay: ProgressEvent[] = [];
      const trackClient: ProgressEvent[] = [];
      const trackSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
        chain: CHAIN.PUSH_TESTNET_DONUT,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      });
      const trackClientInstance = await PushChain.initialize(trackSigner, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        progressHook: (e) => trackClient.push(e),
      });
      const tracked = await trackClientInstance.universal.trackTransaction(tx.hash, {
        waitForCompletion: true,
        progressHook: (e) => trackReplay.push(e),
      });
      await tracked.wait();

      const liveIds = liveEvents.map((e) => e.id);
      const hookIds = hookEvents.map((e) => e.id);
      const replayIds = trackReplay.map((e) => e.id);

      expect(liveIds).toEqual(R1_PUSH_ORIGIN_EXPECTED);
      expect(hookIds).toEqual(R1_PUSH_ORIGIN_EXPECTED);
      expect(replayIds).toEqual(R1_PUSH_ORIGIN_RECONSTRUCTED);
    },
    180_000
  );

  (evmKeyR1 ? it : it.skip)(
    'B. Sepolia UOA funds-bridge path — three streams match spec',
    async () => {
      const sepoliaCtx = makeSepoliaContext(evmKeyR1 as Hex);
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
      });
      await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');

      const signer = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      });

      const liveEvents: ProgressEvent[] = [];
      const client = await PushChain.initialize(signer, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        progressHook: (e) => liveEvents.push(e),
      });

      const tx = await client.universal.sendTransaction({
        to: client.universal.account,
        funds: {
          amount: BigInt(1),
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH,
        },
      });

      const hookEvents: ProgressEvent[] = [];
      tx.progressHook((e) => hookEvents.push(e));

      await tx.wait();

      const trackReplay: ProgressEvent[] = [];
      const trackClient: ProgressEvent[] = [];
      const trackSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      });
      const trackClientInstance = await PushChain.initialize(trackSigner, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        progressHook: (e) => trackClient.push(e),
      });
      const tracked = await trackClientInstance.universal.trackTransaction(tx.hash, {
        waitForCompletion: true,
        progressHook: (e) => trackReplay.push(e),
      });
      await tracked.wait();

      const liveIds = liveEvents.map((e) => e.id);
      const hookIds = hookEvents.map((e) => e.id);
      const replayIds = trackReplay.map((e) => e.id);

      expect(liveIds).toEqual(R1_FUNDS_BRIDGE_EXPECTED);
      expect(hookIds).toEqual(R1_FUNDS_BRIDGE_EXPECTED);
      expect(replayIds).toEqual(R1_EXTERNAL_ORIGIN_RECONSTRUCTED);
    },
    300_000
  );

  (evmKeyR1 ? it : it.skip)(
    'C. Sepolia UOA fee-lock signature path — three streams match spec',
    async () => {
      const sepoliaCtx = makeSepoliaContext(evmKeyR1 as Hex);
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
      });
      await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');

      const signer = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      });

      const liveEvents: ProgressEvent[] = [];
      const client = await PushChain.initialize(signer, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        progressHook: (e) => liveEvents.push(e),
      });

      const incrementData = PushChain.utils.helpers.encodeTxData({
        abi: [...COUNTER_ABI_PAYABLE],
        functionName: 'increment',
      });
      const tx = await client.universal.sendTransaction({
        to: COUNTER_ADDRESS_PAYABLE,
        data: incrementData,
      });

      const hookEvents: ProgressEvent[] = [];
      tx.progressHook((e) => hookEvents.push(e));

      await tx.wait();

      const trackReplay: ProgressEvent[] = [];
      const trackClient: ProgressEvent[] = [];
      const trackSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      });
      const trackClientInstance = await PushChain.initialize(trackSigner, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        progressHook: (e) => trackClient.push(e),
      });
      const tracked = await trackClientInstance.universal.trackTransaction(tx.hash, {
        waitForCompletion: true,
        progressHook: (e) => trackReplay.push(e),
      });
      await tracked.wait();

      const liveIds = liveEvents.map((e) => e.id);
      const hookIds = hookEvents.map((e) => e.id);
      const replayIds = trackReplay.map((e) => e.id);

      expect(liveIds).toEqual(R1_FEE_LOCK_EXPECTED);
      expect(hookIds).toEqual(R1_FEE_LOCK_EXPECTED);
      expect(replayIds).toEqual(R1_EXTERNAL_ORIGIN_RECONSTRUCTED);
    },
    420_000
  );
});

// ============================================================================
// Route 2 progress-hook parity (live vs trackTransaction replay)
// ============================================================================
describe('Route 2 progress-hook parity (live vs trackTransaction replay)', () => {
  const privateKeyR2P = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipR2P = !privateKeyR2P;

  const EXECUTE_IDS_EXPECTED_R2 = [
    'SEND-TX-201',
    'SEND-TX-202-01',
    'SEND-TX-202-02',
    'SEND-TX-203-01',
    'SEND-TX-203-02',
    'SEND-TX-203-03',
    'SEND-TX-203-03',
    'SEND-TX-204-01',
    'SEND-TX-204-02',
    'SEND-TX-204-03',
    'SEND-TX-207',
  ];

  const WAIT_IDS_EXPECTED_R2 = [
    'SEND-TX-209-01',
    'SEND-TX-209-02',
    'SEND-TX-299-01',
  ];

  it('live sendTransaction + trackTransaction replay emit the spec-ordered hooks', async () => {
    if (skipR2P) {
      console.log('Skipping — EVM_PRIVATE_KEY unset');
      return;
    }

    const liveClientEvents: ProgressEvent[] = [];
    const liveSetup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey: privateKeyR2P,
      progressHook: (e: ProgressEvent) => liveClientEvents.push(e),
    });

    const usdt = getToken(CHAIN.ETHEREUM_SEPOLIA, 'USDT');
    const amount = BigInt(10000);
    const params: UniversalExecuteParams = {
      to: { address: TEST_TARGET, chain: CHAIN.ETHEREUM_SEPOLIA },
      funds: { amount, token: usdt },
      data: buildErc20WithdrawalMulticall(
        usdt.address as `0x${string}`,
        TEST_TARGET,
        amount
      ),
    };
    expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

    const liveTx = await liveSetup.pushClient.universal.sendTransaction(params);
    const liveReceipt = await liveTx.wait();
    expect(liveReceipt.status).toBe(1);
    expect(liveReceipt.externalTxHash).toBeDefined();

    const liveIds = liveClientEvents.map((e) => e.id);

    const LIVE_EXPECTED = [...EXECUTE_IDS_EXPECTED_R2, ...WAIT_IDS_EXPECTED_R2];
    expect(liveIds).toEqual(LIVE_EXPECTED);

    const trackReplayEvents: ProgressEvent[] = [];
    const trackClientEvents: ProgressEvent[] = [];
    const trackSetup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey: privateKeyR2P,
      progressHook: (e: ProgressEvent) => trackClientEvents.push(e),
    });

    const tracked = await trackSetup.pushClient.universal.trackTransaction(
      liveTx.hash,
      {
        waitForCompletion: true,
        progressHook: (e: ProgressEvent) => trackReplayEvents.push(e),
      }
    );
    expect(tracked.hash).toBe(liveTx.hash);
    expect(tracked.route).toBe(TransactionRoute.UOA_TO_CEA);
    await tracked.wait();

    const replayIds = trackReplayEvents.map((e) => e.id);
    const trackClientIds = trackClientEvents.map((e) => e.id);

    const REPLAY_EXPECTED = [...EXECUTE_IDS_EXPECTED_R2, ...WAIT_IDS_EXPECTED_R2];
    expect(replayIds).toEqual(REPLAY_EXPECTED);

    for (const id of WAIT_IDS_EXPECTED_R2) {
      expect(trackClientIds).toContain(id);
    }
  }, 420000);
});

// ============================================================================
// Route 3 progress-hook parity (live vs trackTransaction replay)
// ============================================================================
describe('Route 3 progress-hook parity (live vs trackTransaction replay)', () => {
  const privateKeyR3P = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipR3P = !privateKeyR3P;

  const EXECUTE_IDS_LIVE_R3 = [
    'SEND-TX-301',
    'SEND-TX-302-01',
    'SEND-TX-302-02',
    'SEND-TX-303-01',
    'SEND-TX-303-02',
    'SEND-TX-303-03-01',
    'SEND-TX-303-04',
    'SEND-TX-304-01',
    'SEND-TX-304-02',
    'SEND-TX-304-03',
    'SEND-TX-307',
  ];

  const EXECUTE_IDS_REPLAY_R3 = EXECUTE_IDS_LIVE_R3.filter(
    (id) => !id.startsWith('SEND-TX-303-03')
  );

  const WAIT_IDS_EXPECTED_R3 = [
    'SEND-TX-309-01',
    'SEND-TX-309-02',
    'SEND-TX-399-03',
  ];

  it('live sendTransaction + trackTransaction replay emit the spec-ordered R3 hooks', async () => {
    if (skipR3P) {
      console.log('Skipping — EVM_PRIVATE_KEY unset');
      return;
    }

    const liveClientEvents: ProgressEvent[] = [];
    const liveSetup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey: privateKeyR3P,
      progressHook: (e: ProgressEvent) => liveClientEvents.push(e),
    });

    const ueaAddress = liveSetup.pushClient.universal.account;

    const liveTx = await liveSetup.pushClient.universal.sendTransaction({
      from: { chain: CHAIN.BNB_TESTNET },
      to: ueaAddress,
    });

    const liveReceipt = await liveTx.wait({ outboundTimeoutMs: 30_000 });
    expect(liveReceipt.status).toBe(1);
    expect(liveReceipt.externalStatus).toBe('timeout');

    const liveIds = liveClientEvents.map((e) => e.id);

    const LIVE_EXPECTED = [...EXECUTE_IDS_LIVE_R3, ...WAIT_IDS_EXPECTED_R3];
    expect(liveIds).toEqual(LIVE_EXPECTED);

    const terminalEvent = liveClientEvents.find(
      (e) => e.id === 'SEND-TX-399-03'
    )!;
    expect(
      (terminalEvent.response as { phase?: string } | null)?.phase
    ).toBe('outbound');
    expect(terminalEvent.title).toContain('BNB Testnet');

    const trackReplayEvents: ProgressEvent[] = [];
    const trackClientEvents: ProgressEvent[] = [];
    const trackSetup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey: privateKeyR3P,
      progressHook: (e: ProgressEvent) => trackClientEvents.push(e),
    });

    const tracked = await trackSetup.pushClient.universal.trackTransaction(
      liveTx.hash,
      {
        waitForCompletion: true,
        progressHook: (e: ProgressEvent) => trackReplayEvents.push(e),
      }
    );
    expect(tracked.hash).toBe(liveTx.hash);
    expect(tracked.route).toBe(TransactionRoute.CEA_TO_PUSH);
    await tracked.wait({ outboundTimeoutMs: 30_000 });

    const replayIds = trackReplayEvents.map((e) => e.id);
    const trackClientIds = trackClientEvents.map((e) => e.id);

    const REPLAY_EXPECTED = [...EXECUTE_IDS_REPLAY_R3, ...WAIT_IDS_EXPECTED_R3];
    expect(replayIds).toEqual(REPLAY_EXPECTED);

    for (const id of WAIT_IDS_EXPECTED_R3) {
      expect(trackClientIds).toContain(id);
    }
  }, 300_000);

  it(
    'FUNDS success: live + replay + track-client streams complete full round-trip at 399-01',
    async () => {
      if (skipR3P) {
        console.log('Skipping — EVM_PRIVATE_KEY unset');
        return;
      }

      const usdt = getToken(CHAIN.ETHEREUM_SEPOLIA, 'USDT');
      const bridgeAmount = BigInt(10000);

      const liveClientEvents: ProgressEvent[] = [];
      const liveSetup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey: privateKeyR3P,
        progressHook: (e: ProgressEvent) => liveClientEvents.push(e),
      });

      const ueaAddress = liveSetup.pushClient.universal.account;
      const { cea: ceaAddress } = await getCEAAddress(
        ueaAddress,
        CHAIN.ETHEREUM_SEPOLIA
      );
      await ensureCeaErc20Balance({
        pushClient: liveSetup.pushClient,
        ceaAddress,
        token: usdt,
        requiredAmount: bridgeAmount,
        targetChain: CHAIN.ETHEREUM_SEPOLIA,
      });

      liveClientEvents.length = 0;

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.ETHEREUM_SEPOLIA },
        to: ueaAddress,
        funds: { amount: bridgeAmount, token: usdt },
      };

      const liveTx = await liveSetup.pushClient.universal.sendTransaction(
        params
      );
      const liveReceipt = await liveTx.wait();
      expect(liveReceipt.status).toBe(1);
      expect(liveReceipt.externalStatus).toBe('success');
      expect(liveReceipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const liveIds = liveClientEvents.map((e) => e.id);

      const SUCCESS_WAIT_IDS = [
        'SEND-TX-309-01',
        'SEND-TX-309-02',
        'SEND-TX-309-03',
        'SEND-TX-310-01',
        'SEND-TX-399-01',
      ];
      const LIVE_EXPECTED = [...EXECUTE_IDS_LIVE_R3, ...SUCCESS_WAIT_IDS];
      expect(liveIds).toEqual(LIVE_EXPECTED);

      const successEvent = liveClientEvents.find(
        (e) => e.id === 'SEND-TX-309-03'
      )!;
      expect(successEvent.level).toBe('INFO');
      const successResp = successEvent.response as {
        txHash: string;
        chain: string;
      } | null;
      expect(successResp?.txHash).toBe(liveReceipt.externalTxHash);

      const trackReplayEvents: ProgressEvent[] = [];
      const trackClientEvents: ProgressEvent[] = [];
      const trackSetup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey: privateKeyR3P,
        progressHook: (e: ProgressEvent) => trackClientEvents.push(e),
      });

      const tracked = await trackSetup.pushClient.universal.trackTransaction(
        liveTx.hash,
        {
          waitForCompletion: true,
          progressHook: (e: ProgressEvent) => trackReplayEvents.push(e),
        }
      );
      expect(tracked.hash).toBe(liveTx.hash);
      expect(tracked.route).toBe(TransactionRoute.CEA_TO_PUSH);
      await tracked.wait();

      const replayIds = trackReplayEvents.map((e) => e.id);
      const trackClientIds = trackClientEvents.map((e) => e.id);

      const REPLAY_EXPECTED = [...EXECUTE_IDS_REPLAY_R3, ...SUCCESS_WAIT_IDS];
      expect(replayIds).toEqual(REPLAY_EXPECTED);

      for (const id of SUCCESS_WAIT_IDS) {
        expect(trackClientIds).toContain(id);
      }
    },
    600_000
  );
});

// ============================================================================
// Route 3 replay parity (trackTransaction on a completed round-trip)
// ============================================================================
describe('Route 3 replay parity (trackTransaction on a completed round-trip)', () => {
  const PUSH_ROOT_COMPLETED =
    '0x80fc70302f8eaac02649b18fe5a09b1580d0f6190b420d3a1058c39ecbf53443' as const;

  const EXECUTE_IDS_REPLAY_COMPLETED = [
    'SEND-TX-301',
    'SEND-TX-302-01',
    'SEND-TX-302-02',
    'SEND-TX-303-01',
    'SEND-TX-303-02',
    'SEND-TX-303-04',
    'SEND-TX-304-01',
    'SEND-TX-304-02',
    'SEND-TX-304-03',
    'SEND-TX-307',
  ];

  const WAIT_IDS_FULL_ROUND_TRIP = [
    'SEND-TX-309-01',
    'SEND-TX-309-02',
    'SEND-TX-309-03',
    'SEND-TX-310-01',
    'SEND-TX-399-01',
  ];

  const privateKeyR3C = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipR3C = !privateKeyR3C;

  it(
    'trackTransaction replay of a completed R3 round-trip emits the full 309-03 + 310-xx + 399-01 sequence',
    async () => {
      if (skipR3C) {
        console.log('Skipping — EVM_PRIVATE_KEY unset');
        return;
      }

      const replayEvents: ProgressEvent[] = [];
      const clientEvents: ProgressEvent[] = [];

      const { pushClient } = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey: privateKeyR3C,
        printTraces: true,
        progressHook: (e: ProgressEvent) => clientEvents.push(e),
      });

      const tracked = await pushClient.universal.trackTransaction(
        PUSH_ROOT_COMPLETED,
        {
          waitForCompletion: true,
          progressHook: (e: ProgressEvent) => replayEvents.push(e),
        }
      );

      expect(tracked.hash).toBe(PUSH_ROOT_COMPLETED);
      expect(tracked.route).toBe(TransactionRoute.CEA_TO_PUSH);

      const receipt = await tracked.wait();
      expect(receipt.status).toBe(1);
      expect(receipt.externalStatus).toBe('success');
      expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(receipt.pushInboundTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(receipt.pushInboundUtxId).toMatch(/^0x[a-fA-F0-9]+$/);
      // R3 success: finalTxHash resolves to the inbound Push tx that closed the round-trip.
      expect(receipt.finalTxHash).toBe(receipt.pushInboundTxHash);

      const replayIds = replayEvents.map((e) => e.id);
      const clientIds = clientEvents.map((e) => e.id);

      const REPLAY_EXPECTED = [
        ...EXECUTE_IDS_REPLAY_COMPLETED,
        ...WAIT_IDS_FULL_ROUND_TRIP,
      ];
      expect(replayIds).toEqual(REPLAY_EXPECTED);

      for (const id of WAIT_IDS_FULL_ROUND_TRIP) {
        expect(clientIds).toContain(id);
      }

      const outboundConfirmed = replayEvents.find(
        (e) => e.id === 'SEND-TX-309-03'
      )!;
      expect(
        (outboundConfirmed.response as { txHash?: string } | null)?.txHash
      ).toBe(receipt.externalTxHash);

      const inboundConfirmed = replayEvents.find(
        (e) => e.id === 'SEND-TX-399-01'
      )!;
      expect(
        (inboundConfirmed.response as { txHash?: string } | null)?.txHash
      ).toBe(receipt.pushInboundTxHash);
    },
    300_000
  );
});

// ============================================================================
// R3 replay of a tx with reverted outbound on source chain
// ============================================================================
describe('R3 replay of a tx with reverted outbound on source chain', () => {
  const PUSH_ROOT_FAILED =
    '0x1f15f1a67150ecc2e6e89b14d95cb718c8613aecd02aa72e46d6fb258f93a78b' as const;

  const EXECUTE_IDS_REPLAY_FAILED = [
    'SEND-TX-301',
    'SEND-TX-302-01',
    'SEND-TX-302-02',
    'SEND-TX-303-01',
    'SEND-TX-303-02',
    'SEND-TX-303-04',
    'SEND-TX-304-01',
    'SEND-TX-304-02',
    'SEND-TX-304-03',
    'SEND-TX-307',
  ];

  const privateKeyR3F = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipR3F = !privateKeyR3F;

  it(
    'emits 399-02 (phase=outbound) when cosmos / source-chain RPC reports REVERTED',
    async () => {
      if (skipR3F) {
        console.log('Skipping — EVM_PRIVATE_KEY unset');
        return;
      }

      const replayEvents: ProgressEvent[] = [];
      const { pushClient } = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey: privateKeyR3F,
        printTraces: true,
      });

      const tracked = await pushClient.universal.trackTransaction(PUSH_ROOT_FAILED, {
        waitForCompletion: true,
        progressHook: (e: ProgressEvent) => replayEvents.push(e),
      });

      expect(tracked.hash).toBe(PUSH_ROOT_FAILED);
      expect(tracked.route).toBe(TransactionRoute.CEA_TO_PUSH);

      const receipt = await tracked.wait();

      expect(receipt.status).toBe(1);
      expect(receipt.externalStatus).toBe('failed');
      expect(typeof receipt.externalError).toBe('string');
      expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(receipt.pushInboundTxHash).toBeUndefined();

      const ids = replayEvents.map((e) => e.id);

      expect(ids.slice(0, EXECUTE_IDS_REPLAY_FAILED.length)).toEqual(EXECUTE_IDS_REPLAY_FAILED);

      expect(ids).toContain('SEND-TX-309-01');
      expect(ids).toContain('SEND-TX-399-02');

      expect(ids).not.toContain('SEND-TX-309-03');
      expect(ids).not.toContain('SEND-TX-310-01');
      expect(ids).not.toContain('SEND-TX-399-01');

      const failedEvent = replayEvents.find((e) => e.id === 'SEND-TX-399-02')!;
      expect(failedEvent.level).toBe('ERROR');
      expect(failedEvent.title.toLowerCase()).toContain('tx failed');
      expect(failedEvent.title.toLowerCase()).not.toContain('inbound');
    },
    300_000
  );
});

// ============================================================================
// Website Track Transaction Snippets (e2e)
// Mirrors the exact code snippets on docs/.../10-Track-Universal-Transaction.mdx
// ============================================================================
describe('Website Track Transaction Snippets (e2e)', () => {
  const KNOWN_TARGET_WS = '0x35B84d6848D16415177c64D64504663b998A6ab4';

  let pushClientWS: PushChain;
  let knownTxHashWS: string;

  const evmPrivateKeyWS = process.env['PUSH_PRIVATE_KEY'] as Hex;
  const skipE2E_WS = !evmPrivateKeyWS;

  beforeAll(async () => {
    if (skipE2E_WS) {
      console.log('PUSH_PRIVATE_KEY not set — skipping all tests');
      return;
    }

    const setup = await createEvmPushClient({
      chain: CHAIN.PUSH_TESTNET_DONUT,
      privateKey: evmPrivateKeyWS,
      printTraces: true,
    });
    pushClientWS = setup.pushClient;

    const tx = await pushClientWS.universal.sendTransaction({
      to: KNOWN_TARGET_WS as `0x${string}`,
      value: BigInt(100),
    });
    await tx.wait();
    knownTxHashWS = tx.hash;
  }, 180000);

  it('W1: Route 1 progressHook — event.id, event.level, event.message are defined', async () => {
    if (skipE2E_WS || !knownTxHashWS) return;

    const events: ProgressEvent[] = [];

    const response = await pushClientWS.universal.trackTransaction(
      knownTxHashWS,
      {
        waitForCompletion: true,
        progressHook: (event) => {
          events.push(event);
        },
      }
    );

    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      expect(event.id).toBeDefined();
      expect(typeof event.id).toBe('string');
      expect(['INFO', 'SUCCESS', 'WARNING', 'ERROR']).toContain(event.level);
      expect(event.message).toBeDefined();
      expect(typeof event.message).toBe('string');
    }

    expect(response.hash).toBe(knownTxHashWS);
    expect(response.blockNumber).toBeGreaterThan(BigInt(0));
    expect(typeof response.wait).toBe('function');

    const receipt = await response.wait();
    expect(receipt.status).toBe(1);
    expect(receipt.gasUsed).toBeGreaterThan(BigInt(0));
  }, 60000);

  it('W2: events use SEND-TX-* IDs, not TRACK-TX-*', async () => {
    if (skipE2E_WS || !knownTxHashWS) return;

    const events: ProgressEvent[] = [];
    await pushClientWS.universal.trackTransaction(knownTxHashWS, {
      waitForCompletion: true,
      progressHook: (event) => events.push(event),
    });

    for (const event of events) {
      expect(event.id).toMatch(/^SEND-TX-/);
    }

    const trackEvents = events.filter((e) => e.id.startsWith('TRACK-TX'));
    expect(trackEvents).toHaveLength(0);

    expect(events.some((e) => e.id === 'SEND-TX-101')).toBe(true);
    expect(events.some((e) => e.id === 'SEND-TX-199-01')).toBe(true);
  }, 60000);

  it('W3: ProgressEvent has all documented fields (id, title, message, level, timestamp)', async () => {
    if (skipE2E_WS || !knownTxHashWS) return;

    const events: ProgressEvent[] = [];
    await pushClientWS.universal.trackTransaction(knownTxHashWS, {
      waitForCompletion: true,
      progressHook: (event) => events.push(event),
    });

    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      expect(typeof event.id).toBe('string');
      expect(event.id.length).toBeGreaterThan(0);
      expect(typeof event.title).toBe('string');
      expect(event.title.length).toBeGreaterThan(0);
      expect(typeof event.message).toBe('string');
      expect(event.message.length).toBeGreaterThan(0);
      expect(['INFO', 'SUCCESS', 'WARNING', 'ERROR']).toContain(event.level);
      expect(typeof event.timestamp).toBe('string');
      expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
    }
  }, 60000);

  it('W4: wait() and trackTransaction() return consistent results', async () => {
    if (skipE2E_WS) return;

    const tx = await pushClientWS.universal.sendTransaction({
      to: KNOWN_TARGET_WS as `0x${string}`,
      value: BigInt(100),
    });

    const receipt1 = await tx.wait();

    const tracked = await pushClientWS.universal.trackTransaction(tx.hash, {
      waitForCompletion: true,
    });
    const receipt2 = await tracked.wait();

    expect(receipt1.hash).toBe(tracked.hash);
    expect(receipt1.blockNumber).toBe(tracked.blockNumber);
    expect(receipt1.status).toBe(receipt2.status);
  }, 120000);

  it('W5: orchestrator-level progressHook fires during trackTransaction', async () => {
    if (skipE2E_WS || !knownTxHashWS) return;

    const orchestratorEvents: ProgressEvent[] = [];
    const setup = await createEvmPushClient({
      chain: CHAIN.PUSH_TESTNET_DONUT,
      privateKey: evmPrivateKeyWS,
      progressHook: (event: ProgressEvent) => {
        orchestratorEvents.push(event);
      },
    });

    const perCallEvents: ProgressEvent[] = [];
    await setup.pushClient.universal.trackTransaction(knownTxHashWS, {
      waitForCompletion: true,
      progressHook: (event) => {
        perCallEvents.push(event);
      },
    });

    expect(orchestratorEvents.length).toBeGreaterThan(0);
    expect(perCallEvents.length).toBeGreaterThan(0);

    const perCallIds = perCallEvents.map((e) => e.id).sort();
    const orchestratorIds = orchestratorEvents
      .filter((e) => e.id.startsWith('SEND-TX-'))
      .map((e) => e.id)
      .sort();

    expect(perCallIds).toEqual(orchestratorIds);
  }, 60000);
});

// ============================================================================
// Source-leg hash tracking (EVM + SVM origin)
// trackTransaction can be given an ORIGIN/source-leg hash on a non-Push
// `chain` — a source EVM tx hash or a Solana signature — and resolves it to the
// universal tx via the detector, reconstructing from the Push side. Tracking is
// read-only (the client is initialized only to obtain a Push RPC connection).
// Hashes are real, finalized testnet-donut universal transactions.
// ============================================================================
describe('trackTransaction — source-leg hash tracking (EVM + SVM origin)', () => {
  // Originating from Push Chain (native Push root hash)
  const UNIVERSAL_TX_FROM_PUSH =
    '0x169929f61574baf62b84ce68b944e09faf566129d0175b2ee1e020c76ae7bd2f';
  // Originating from Ethereum Sepolia (source tx hash)
  const UNIVERSAL_TX_FROM_ETH_SEPOLIA =
    '0x9b4743376689eb6f90f3aeb9eea58381b3bcc033e1de4709281fd58a77b85098';
  // Originating from Solana devnet (base58 signature)
  const UNIVERSAL_TX_FROM_SOLANA =
    '22SirqSwhcSjgyb3wdrW9Zis19dxcLHD5yy3BtRbRoLmykrv8eCzKnPaRGxrrZ7a4A7yKGRMGMehqKpTcdF2ByFR';

  let pushClient: PushChain;
  const evmPrivateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E = !evmPrivateKey;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('EVM_PRIVATE_KEY not set — skipping source-leg tracking tests');
      return;
    }
    const setup = await createEvmPushClient({
      chain: CHAIN.PUSH_TESTNET_DONUT,
      privateKey: evmPrivateKey,
    });
    pushClient = setup.pushClient;
  }, 60000);

  it('SVM origin: tracks a Solana-origin tx by its base58 signature', async () => {
    if (skipE2E) return;

    const events: ProgressEvent[] = [];
    const res = await pushClient.universal.trackTransaction(
      UNIVERSAL_TX_FROM_SOLANA,
      {
        chain: CHAIN.SOLANA_DEVNET,
        waitForCompletion: true,
        advanced: { timeout: 30000 },
        progressHook: (e) => events.push(e),
      }
    );

    // Resolves to the Push root hash (not the Solana signature), which the
    // EVM-only client could never have fetched directly.
    expect(res.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(res.hash).not.toBe(UNIVERSAL_TX_FROM_SOLANA);
    expect(res.blockNumber).toBeGreaterThan(BigInt(0));

    // Route + source chain/origin reflect the Solana origin.
    expect(res.route).toBe(TransactionRoute.CEA_TO_PUSH);
    expect(res.chain).toBe(CHAIN.SOLANA_DEVNET);
    expect(res.origin.startsWith(`${CHAIN.SOLANA_DEVNET}:`)).toBe(true);

    // Reconstructed SEND-TX-* sequence (no TRACK-TX-* leakage).
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.id.startsWith('SEND-TX-'))).toBe(true);
    expect(events.some((e) => e.id === 'SEND-TX-301')).toBe(true);
  }, 60000);

  it('EVM origin: tracks an Ethereum-Sepolia-origin tx by its source tx hash', async () => {
    if (skipE2E) return;

    const events: ProgressEvent[] = [];
    const res = await pushClient.universal.trackTransaction(
      UNIVERSAL_TX_FROM_ETH_SEPOLIA,
      {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        waitForCompletion: true,
        advanced: { timeout: 30000 },
        progressHook: (e) => events.push(e),
      }
    );

    expect(res.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(res.blockNumber).toBeGreaterThan(BigInt(0));
    expect(res.route).toBe(TransactionRoute.CEA_TO_PUSH);
    expect(res.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
    expect(res.origin.startsWith(`${CHAIN.ETHEREUM_SEPOLIA}:`)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.id.startsWith('SEND-TX-'))).toBe(true);
    expect(events.some((e) => e.id === 'SEND-TX-301')).toBe(true);
  }, 60000);

  it('Push origin: default chain still tracks a Push root hash unchanged', async () => {
    if (skipE2E) return;

    const events: ProgressEvent[] = [];
    const res = await pushClient.universal.trackTransaction(
      UNIVERSAL_TX_FROM_PUSH,
      {
        waitForCompletion: true,
        advanced: { timeout: 30000 },
        progressHook: (e) => events.push(e),
      }
    );

    // Push-native path: the response hash is the hash you passed.
    expect(res.hash).toBe(UNIVERSAL_TX_FROM_PUSH);
    expect(res.blockNumber).toBeGreaterThan(BigInt(0));
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.id.startsWith('SEND-TX-'))).toBe(true);
  }, 60000);

  it('rejects an unsupported chain with an actionable error', async () => {
    if (skipE2E) return;

    await expect(
      pushClient.universal.trackTransaction(UNIVERSAL_TX_FROM_ETH_SEPOLIA, {
        chain: 'eip155:99999999' as CHAIN,
        waitForCompletion: false,
      })
    ).rejects.toThrow(/unsupported chain/i);
  }, 30000);
});
