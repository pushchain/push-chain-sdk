import '@e2e/shared/setup';
/**
 * SVM UEA → Push Chain: Inbound Transactions (Route 1)
 *
 * Tests for inbound transactions from Solana Devnet to Push Chain.
 * Covers: Transfer, Error Handling, Funds (SOL Bridge), Progress Hooks.
 */
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { createSvmPushClient } from '@e2e/shared/svm-client';
import {
  createProgressTracker,
  expectBridgeHooks,
} from '@e2e/shared/progress-tracker';
import { txValidator } from '@e2e/shared/validators';
import { getToken, DIFFERENT_ADDRESS, TEST_TARGET_ADDRESS } from '@e2e/shared/constants';

const solanaPrivateKey = process.env['SOLANA_PRIVATE_KEY'];
const skipE2E = !solanaPrivateKey;

describe('SVM UEA → Push Chain: Inbound Transactions (Route 1)', () => {
  let pushClient: PushChain;
  const tracker = createProgressTracker();

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping SVM E2E tests - SOLANA_PRIVATE_KEY not set');
      return;
    }

    const setup = await createSvmPushClient({
      privateKeyBase58: solanaPrivateKey as string,
      chain: CHAIN.SOLANA_DEVNET,
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: tracker.hook,
    });
    pushClient = setup.pushClient;

    console.log(`UEA Address: ${pushClient.universal.account}`);
  }, 60000);

  // ============================================================================
  // 1. Transfer
  // ============================================================================
  describe('1. Transfer', () => {
    it('should send transfer to Push Chain address', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM Transfer ===');

      const tx = await pushClient.universal.sendTransaction({
        to: TEST_TARGET_ADDRESS,
        value: BigInt(1),
      });

      const after = await PushChain.utils.account.convertOriginToExecutor(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pushClient as any).universal.origin,
        { onlyCompute: true }
      );
      expect(after.deployed).toBe(true);

      await txValidator(
        tx,
        pushClient.universal.origin.address,
        TEST_TARGET_ADDRESS
      );
    }, 300000);
  });

  // ============================================================================
  // 2. Error Handling
  // ============================================================================
  describe('2. Error Handling', () => {
    // Note: feeLockTxHash is an EVM-only concept — SVM ignores it and proceeds normally.
    // Instead, test that sending with no value/funds/data still succeeds (minimal tx).
    it('should handle minimal transaction without error', async () => {
      if (skipE2E) return;

      const tx = await pushClient.universal.sendTransaction({
        to: TEST_TARGET_ADDRESS,
        value: BigInt(1),
      });

      expect(tx.hash).toBeDefined();
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    }, 300000);
  });

  // ============================================================================
  // 3. Funds — SOL Bridge
  // ============================================================================
  describe('3. Funds — SOL Bridge', () => {
    beforeEach(() => {
      tracker.reset();
    });

    it('should bridge SOL to different address', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SOL to Different Address ===');

      const solToken = getToken(CHAIN.SOLANA_DEVNET, 'SOL');

      const tx = await pushClient.universal.sendTransaction({
        to: DIFFERENT_ADDRESS,
        funds: {
          amount: PushChain.utils.helpers.parseUnits('0.001', 9), // SOL has 9 decimals
          token: solToken,
        },
      });

      console.log(`Hash: ${tx.hash}`);
      expect(tx.hash).toBeDefined();

      expectBridgeHooks(tracker.getIds(), { expectConfirmation: true });
    }, 300000);

    it('should bridge SOL to self', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SOL to Self ===');

      const solToken = getToken(CHAIN.SOLANA_DEVNET, 'SOL');
      const UEA = pushClient.universal.account as `0x${string}`;

      const tx = await pushClient.universal.sendTransaction({
        to: UEA,
        funds: {
          amount: PushChain.utils.helpers.parseUnits('0.001', 9),
          token: solToken,
        },
      });

      console.log(`Hash: ${tx.hash}`);
      expect(tx.hash).toBeDefined();

      expectBridgeHooks(tracker.getIds(), { expectConfirmation: true });
    }, 300000);
  });

  // ============================================================================
  // 4. Progress Hooks
  // ============================================================================
  describe('4. Progress Hooks', () => {
    beforeEach(() => {
      tracker.reset();
    });

    it('should emit all hooks and measure timing', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM Progress Hooks Timing ===');

      const solToken = getToken(CHAIN.SOLANA_DEVNET, 'SOL');
      const UEA = pushClient.universal.account as `0x${string}`;

      const tx = await pushClient.universal.sendTransaction({
        to: UEA,
        funds: {
          amount: PushChain.utils.helpers.parseUnits('0.001', 9),
          token: solToken,
        },
      });

      console.log(`Hash: ${tx.hash}`);

      // Log step durations
      const durations = tracker.getDurations();
      console.log('\n=== STEP DURATIONS ===');
      durations.forEach((d, i) => {
        console.log(`${i + 1}. ${d.duration.toFixed(2)}s: ${d.step}`);
      });

      // Log confirmations
      const confirmationHooks = tracker.events.filter((p) =>
        p.event.id.startsWith('SEND-TX-06-03')
      );
      console.log(`\nConfirmation hooks: ${confirmationHooks.length}`);
      confirmationHooks.forEach((c) => {
        console.log(`  - ${c.event.id}: ${c.event.message}`);
      });

      expectBridgeHooks(tracker.getIds(), { expectConfirmation: true });
    }, 300000);
  });
});
