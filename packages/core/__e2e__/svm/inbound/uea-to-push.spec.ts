import '@e2e/shared/setup';
/**
 * SVM UEA → Push Chain: Inbound Transactions (Route 1)
 *
 * Tests for inbound transactions from Solana Devnet to Push Chain.
 * Covers: Transfer, Error Handling, Funds (SOL Bridge), Progress Hooks.
 *
 * UTX Gap Coverage (S5-S12):
 * UTX-01 Value to Self, UTX-05 Data to Contract, UTX-07 Value+Data,
 * UTX-11 Funds+Data, UTX-17 Native Funds+Data, UTX-21 Multicall (no funds),
 * UTX-22 Funds+Multicall, UTX-23 Native Funds+Payload.
 */
import { Keypair } from '@solana/web3.js';
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { MOVEABLE_TOKENS } from '../../../src/lib/constants/tokens';
import { createSvmPushClient } from '@e2e/shared/svm-client';
import {
  createProgressTracker,
  expectBridgeHooks,
} from '@e2e/shared/progress-tracker';
import { txValidator } from '@e2e/shared/validators';
import { getToken, DIFFERENT_ADDRESS, TEST_TARGET_ADDRESS } from '@e2e/shared/constants';
import {
  COUNTER_ADDRESS_PAYABLE,
  COUNTER_ABI_PAYABLE,
} from '@e2e/shared/inbound-helpers';
import {
  makeSolanaContext,
  fundSolanaUoa,
} from '../../docs-examples/_helpers/docs-fund';

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
          amount: PushChain.utils.helpers.parseUnits('0.00005', 9),
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
          amount: PushChain.utils.helpers.parseUnits('0.00005', 9),
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
          amount: PushChain.utils.helpers.parseUnits('0.00005', 9),
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
        p.event.id.startsWith('SEND-TX-106-03')
      );
      console.log(`\nConfirmation hooks: ${confirmationHooks.length}`);
      confirmationHooks.forEach((c) => {
        console.log(`  - ${c.event.id}: ${c.event.message}`);
      });

      expectBridgeHooks(tracker.getIds(), { expectConfirmation: true });
    }, 300000);
  });

  // ============================================================================
  // 5. Value to Self (UTX-01)
  // ============================================================================
  describe('5. Value to Self (UTX-01)', () => {
    it('should send value to own UEA address', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM Value to Self ===');

      const UEA = pushClient.universal.account as `0x${string}`;

      const tx = await pushClient.universal.sendTransaction({
        to: UEA,
        value: BigInt(1),
      });

      console.log(`TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
    }, 300000);
  });

  // ============================================================================
  // 6. Data to Contract (UTX-05)
  // ============================================================================
  describe('6. Data to Contract (UTX-05)', () => {
    it('should send data-only to counter contract', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM Data to Contract ===');

      const incrementData = PushChain.utils.helpers.encodeTxData({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        abi: COUNTER_ABI_PAYABLE as any[],
        functionName: 'increment',
      });

      const tx = await pushClient.universal.sendTransaction({
        to: COUNTER_ADDRESS_PAYABLE,
        data: incrementData,
      });

      console.log(`TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
    }, 300000);
  });

  // ============================================================================
  // 7. Value + Data to Contract (UTX-07)
  // ============================================================================
  describe('7. Value + Data to Contract (UTX-07)', () => {
    it('should send value + data to counter contract', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM Value + Data to Contract ===');

      const incrementData = PushChain.utils.helpers.encodeTxData({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        abi: COUNTER_ABI_PAYABLE as any[],
        functionName: 'increment',
      });

      const tx = await pushClient.universal.sendTransaction({
        to: COUNTER_ADDRESS_PAYABLE,
        value: BigInt(7),
        data: incrementData,
      });

      console.log(`TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
    }, 300000);
  });

  // ============================================================================
  // 8. Native Funds + Data (UTX-17)
  // ============================================================================
  describe('8. Native Funds + Data (UTX-17)', () => {
    it('should bridge SOL + execute data on counter', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM SOL + Data ===');

      const solToken = getToken(CHAIN.SOLANA_DEVNET, 'SOL');
      const incrementData = PushChain.utils.helpers.encodeTxData({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        abi: COUNTER_ABI_PAYABLE as any[],
        functionName: 'increment',
      });

      const tx = await pushClient.universal.sendTransaction({
        to: COUNTER_ADDRESS_PAYABLE,
        funds: {
          amount: PushChain.utils.helpers.parseUnits('0.00005', 9),
          token: solToken,
        },
        data: incrementData,
      });

      console.log(`TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
    }, 300000);
  });

  // ============================================================================
  // 9. Multicall — no Funds (UTX-21)
  // ============================================================================
  describe('9. Multicall — no Funds (UTX-21)', () => {
    it('should execute multicall without funds', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM Multicall no Funds ===');

      const incrementData = PushChain.utils.helpers.encodeTxData({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        abi: COUNTER_ABI_PAYABLE as any[],
        functionName: 'increment',
      });

      const multicallData = [
        {
          to: COUNTER_ADDRESS_PAYABLE,
          value: BigInt(0),
          data: incrementData,
        },
        {
          to: COUNTER_ADDRESS_PAYABLE,
          value: BigInt(0),
          data: incrementData,
        },
      ];

      const tx = await pushClient.universal.sendTransaction({
        to: COUNTER_ADDRESS_PAYABLE,
        data: multicallData,
      });

      console.log(`TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
    }, 300000);
  });

  // ============================================================================
  // 10. Funds + Multicall (UTX-22)
  // ============================================================================
  describe('10. Funds + Multicall (UTX-22)', () => {
    it('should bridge SOL + execute multicall', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM SOL + Multicall ===');

      const solToken = getToken(CHAIN.SOLANA_DEVNET, 'SOL');
      const incrementData = PushChain.utils.helpers.encodeTxData({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        abi: COUNTER_ABI_PAYABLE as any[],
        functionName: 'increment',
      });

      const UEA = pushClient.universal.account as `0x${string}`;

      const multicallData = [
        {
          to: COUNTER_ADDRESS_PAYABLE,
          value: BigInt(0),
          data: incrementData,
        },
        { to: UEA, value: BigInt(0), data: '0x' as `0x${string}` },
      ];

      const tx = await pushClient.universal.sendTransaction({
        to: COUNTER_ADDRESS_PAYABLE,
        funds: {
          amount: PushChain.utils.helpers.parseUnits('0.00005', 9),
          token: solToken,
        },
        data: multicallData,
      });

      console.log(`TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
    }, 300000);
  });

  // ============================================================================
  // 11. Native Funds + Payload (UTX-23)
  // ============================================================================
  describe('11. Native Funds + Payload (UTX-23)', () => {
    it('should bridge SOL + execute single payload call', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM SOL + Payload ===');

      const solToken = getToken(CHAIN.SOLANA_DEVNET, 'SOL');
      const UEA = pushClient.universal.account as `0x${string}`;

      const singleCall = [
        { to: UEA, value: BigInt(0), data: '0x' as `0x${string}` },
      ];

      const tx = await pushClient.universal.sendTransaction({
        to: UEA,
        funds: {
          amount: PushChain.utils.helpers.parseUnits('0.00005', 9),
          token: solToken,
        },
        data: singleCall,
      });

      console.log(`TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
    }, 300000);
  });

  // ============================================================================
  // 12. Funds + Data to Contract (UTX-11)
  // ============================================================================
  describe('12. Funds + Data to Contract (UTX-11)', () => {
    it('should bridge SOL + send data to counter contract', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM Funds + Data to Contract ===');

      const solToken = getToken(CHAIN.SOLANA_DEVNET, 'SOL');
      const incrementData = PushChain.utils.helpers.encodeTxData({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        abi: COUNTER_ABI_PAYABLE as any[],
        functionName: 'increment',
      });

      const tx = await pushClient.universal.sendTransaction({
        to: COUNTER_ADDRESS_PAYABLE,
        funds: {
          amount: PushChain.utils.helpers.parseUnits('0.00005', 9),
          token: solToken,
        },
        data: incrementData,
      });

      console.log(`TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
    }, 300000);
  });

  // ============================================================================
  // 13. Value + Funds to Self (UTX-09)
  // ============================================================================
  describe('13. Value + Funds to Self (UTX-09)', () => {
    it('should send value + SOL funds to self', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM Value + Funds to Self ===');

      const solToken = getToken(CHAIN.SOLANA_DEVNET, 'SOL');
      const UEA = pushClient.universal.account as `0x${string}`;

      const tx = await pushClient.universal.sendTransaction({
        to: UEA,
        value: BigInt(9),
        funds: {
          amount: PushChain.utils.helpers.parseUnits('0.00005', 9),
          token: solToken,
        },
      });

      console.log(`TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
    }, 300000);
  });

  // ============================================================================
  // 14. Value + Funds to Others (UTX-10)
  // ============================================================================
  describe('14. Value + Funds to Others (UTX-10)', () => {
    it('should send value + SOL funds to different address', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM Value + Funds to Others ===');

      const solToken = getToken(CHAIN.SOLANA_DEVNET, 'SOL');

      const tx = await pushClient.universal.sendTransaction({
        to: DIFFERENT_ADDRESS,
        value: BigInt(10),
        funds: {
          amount: PushChain.utils.helpers.parseUnits('0.00005', 9),
          token: solToken,
        },
      });

      console.log(`TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
    }, 300000);
  });

  // ============================================================================
  // 15. Value + Funds + Data to Contract (UTX-13)
  // ============================================================================
  describe('15. Value + Funds + Data to Contract (UTX-13)', () => {
    it('should send value + SOL funds + data to counter contract', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM V+F+D to Contract ===');

      const solToken = getToken(CHAIN.SOLANA_DEVNET, 'SOL');
      const incrementData = PushChain.utils.helpers.encodeTxData({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        abi: COUNTER_ABI_PAYABLE as any[],
        functionName: 'increment',
      });

      const tx = await pushClient.universal.sendTransaction({
        to: COUNTER_ADDRESS_PAYABLE,
        value: BigInt(13),
        funds: {
          amount: PushChain.utils.helpers.parseUnits('0.00005', 9),
          token: solToken,
        },
        data: incrementData,
      });

      console.log(`TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
    }, 300000);
  });

  // ============================================================================
  // 16. Value + Native Funds (UTX-19)
  // ============================================================================
  describe('16. Value + Native Funds (UTX-19)', () => {
    it('should send value + native SOL funds to self', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM Value + Native Funds ===');

      const solToken = getToken(CHAIN.SOLANA_DEVNET, 'SOL');
      const UEA = pushClient.universal.account as `0x${string}`;

      const tx = await pushClient.universal.sendTransaction({
        to: UEA,
        value: BigInt(19),
        funds: {
          amount: PushChain.utils.helpers.parseUnits('0.00005', 9),
          token: solToken,
        },
      });

      console.log(`TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
    }, 300000);
  });

  // ============================================================================
  // 17. Data to Self (UTX-06)
  // ============================================================================
  describe('17. Data to Self (UTX-06)', () => {
    it('should send empty data to own UEA', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM Data to Self ===');

      const UEA = pushClient.universal.account as `0x${string}`;

      const tx = await pushClient.universal.sendTransaction({
        to: UEA,
        data: '0x',
      });

      console.log(`TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
    }, 300000);
  });

  // ============================================================================
  // 18. Value + Data to Self (UTX-08)
  // ============================================================================
  describe('18. Value + Data to Self (UTX-08)', () => {
    it('should send value + empty data to own UEA', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM Value + Data to Self ===');

      const UEA = pushClient.universal.account as `0x${string}`;

      const tx = await pushClient.universal.sendTransaction({
        to: UEA,
        value: BigInt(8),
        data: '0x',
      });

      console.log(`TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
    }, 300000);
  });

  // ============================================================================
  // 19. Funds + Data to Self (UTX-12)
  // ============================================================================
  describe('19. Funds + Data to Self (UTX-12)', () => {
    it('should send SOL funds + empty data to own UEA', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM Funds + Data to Self ===');

      const solToken = getToken(CHAIN.SOLANA_DEVNET, 'SOL');
      const UEA = pushClient.universal.account as `0x${string}`;

      const tx = await pushClient.universal.sendTransaction({
        to: UEA,
        funds: {
          amount: PushChain.utils.helpers.parseUnits('0.00005', 9),
          token: solToken,
        },
        data: '0x',
      });

      console.log(`TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
    }, 300000);
  });

  // ============================================================================
  // 20. V+F+D to Self (UTX-14)
  // ============================================================================
  describe('20. V+F+D to Self (UTX-14)', () => {
    it('should send value + SOL funds + empty data to own UEA', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM V+F+D to Self ===');

      const solToken = getToken(CHAIN.SOLANA_DEVNET, 'SOL');
      const UEA = pushClient.universal.account as `0x${string}`;

      const tx = await pushClient.universal.sendTransaction({
        to: UEA,
        value: BigInt(14),
        funds: {
          amount: PushChain.utils.helpers.parseUnits('0.00005', 9),
          token: solToken,
        },
        data: '0x',
      });

      console.log(`TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
    }, 300000);
  });

  // ============================================================================
  // 21. Native Funds + Data to Self (UTX-18)
  // ============================================================================
  describe('21. Native Funds + Data to Self (UTX-18)', () => {
    it('should send native SOL funds + empty data to own UEA', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SVM Native Funds + Data to Self ===');

      const solToken = getToken(CHAIN.SOLANA_DEVNET, 'SOL');
      const UEA = pushClient.universal.account as `0x${string}`;

      const tx = await pushClient.universal.sendTransaction({
        to: UEA,
        funds: {
          amount: PushChain.utils.helpers.parseUnits('0.00005', 9),
          token: solToken,
        },
        data: '0x',
      });

      console.log(`TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
    }, 300000);
  });

  // ============================================================================
  // 22. Fresh-Key Repro (mirrors docs-examples `solana_basic`)
  //
  // The suite above uses the master Solana keypair whose UEA is already
  // deployed on Push Chain. This test generates a brand-new keypair and
  // relies on lazy UEA deployment via the SVM inbound relay — matching the
  // failing `send_transaction_solana_basic` test at
  // __e2e__/docs-examples/06-send-universal-transaction/send-universal-transaction.spec.ts.
  //
  // If this test fails with "stuck after Gas Funding Confirmed" while the
  // master-key tests above pass, the failure is scoped to fresh-key / lazy-UEA
  // SVM inbound (worth chain-infra attention). If both fail, it's a global
  // SVM inbound regression.
  // ============================================================================
  describe('22. Fresh-Key Repro (solana_basic pattern)', () => {
    it('should bridge 0.001 PC from a freshly generated Solana keypair', async () => {
      if (skipE2E) return;

      const ctx = makeSolanaContext(solanaPrivateKey as string);
      const keypair = Keypair.generate();
      // solana_basic funds 0.02 SOL; we use 0.013 here because master devnet
      // wallet is tight and 0.013 is enough to pass deposit.rs:23 balance check
      // (0.01 failed there) while still hitting the fresh-UEA Push-side path.
      await fundSolanaUoa(ctx, keypair.publicKey.toBase58(), '0.013');

      const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
        keypair,
        {
          chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
          library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
        }
      );
      const freshClient = await PushChain.initialize(universalSigner, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        progressHook: (p) => console.log('Progress:', p.title || p.id),
      });

      const tx = await freshClient.universal.sendTransaction({
        to: TEST_TARGET_ADDRESS,
        value: PushChain.utils.helpers.parseUnits('0.001', 18),
      });
      expect(tx.hash).toBeDefined();

      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
    }, 300000);
  });
});
