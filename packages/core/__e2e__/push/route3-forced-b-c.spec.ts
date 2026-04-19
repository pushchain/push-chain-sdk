import '@e2e/shared/setup';
/**
 * Route 3 — Simulated signed e2e for Cases B and C (SDK 5.2 gas abstraction).
 *
 * R3 (CEA → Push Chain): user signs on external chain, CEA self-executes to
 * bridge funds/state back to Push Chain UEA. Same rationale as R2 forced
 * tests: testnet gas is too cheap to naturally reach Case B/C, so we mock
 * `sizeOutboundGas` at the module level.
 *
 * R3 Case C interpretation (simpler than R2 Case C):
 *   - R2 Case C: overflow bridged as funds to destination → wrap/approve/swap
 *   - R3 Case C: no destination delivery. Overflow simply tops up msg.value
 *     so `swapAndBurnGas` can afford the full gas cost. Single 5-line addition
 *     in `route-handlers.ts:executeCeaToPush` (+ the SVM sibling).
 *
 * Test 16 (forced B): Baseline — R3 Case B must work as today.
 * Test 17 (forced C): Verifies the new minimal R3 Case C path.
 */

jest.mock('../../src/lib/orchestrator/internals/gas-usd-sizer', () => {
  const actual = jest.requireActual(
    '../../src/lib/orchestrator/internals/gas-usd-sizer'
  );
  return {
    ...actual,
    sizeOutboundGas: jest.fn(),
  };
});

import {
  createPublicClient,
  http,
  type Hex,
} from 'viem';
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { createProgressTracker } from '@e2e/shared/progress-tracker';
import { sizeOutboundGas } from '../../src/lib/orchestrator/internals/gas-usd-sizer';

const mockedSizer = sizeOutboundGas as unknown as jest.Mock;

const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
const skipE2E = !privateKey;

// Same UEA-balance safety as R2 tests (5 PC gas + 1 PC overflow + 3 PC reserve).
const MIN_UEA_BALANCE = BigInt('10000000000000000000'); // 10 PC
const TOP_UP_AMOUNT = BigInt('15000000000000000000'); // 15 PC

async function ensureMinBalance(
  pushClient: PushChain,
  pushPublicClient: ReturnType<typeof createPublicClient>,
  ueaAddress: `0x${string}`
): Promise<bigint> {
  let balance = await pushPublicClient.getBalance({ address: ueaAddress });
  console.log(`UEA balance: ${balance}`);
  if (balance < MIN_UEA_BALANCE) {
    console.log(`< 10 PC — topping up 15 PC`);
    const topup = await pushClient.universal.sendTransaction({
      to: ueaAddress,
      value: TOP_UP_AMOUNT,
    });
    await topup.wait();
    balance = await pushPublicClient.getBalance({ address: ueaAddress });
    console.log(`After top-up: ${balance}`);
  }
  return balance;
}

describe('Route 3: Forced sizer Case B + C (signed e2e)', () => {
  beforeEach(() => {
    mockedSizer.mockReset();
  });

  // =========================================================================
  // Test 16: R3 EVM + forced Case B.
  // Uses the payload-only R3 pattern from route3-cea-to-push-erc20.spec.ts
  // (from: BNB_TESTNET, to: UEA, no funds). Verifies sizer's Case B output
  // flows through to a successful Push Chain tx.
  // =========================================================================
  (skipE2E ? it.skip : it)(
    'forced Case B: R3 payload-only from BNB CEA lands on Push Chain',
    async () => {
      console.log('\n=== R3 Forced Case B ===');

      mockedSizer.mockResolvedValue({
        category: 'B' as const,
        gasLegNativePc: BigInt('5000000000000000000'), // 5 PC
        overflowNativePc: BigInt(0),
        gasUsd: BigInt('500000000'),
        overflowUsd: BigInt(0),
      });

      const tracker = createProgressTracker();
      const { pushClient } = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey,
        printTraces: true,
        progressHook: tracker.hook,
      });
      const ueaAddress = pushClient.universal.account;
      console.log(`UEA: ${ueaAddress}`);

      const pushPublicClient = createPublicClient({
        transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
      });
      // Deploy UEA if fresh — a cheap self-transfer suffices.
      const ueaCode = await pushPublicClient.getCode({ address: ueaAddress });
      if (ueaCode === undefined) {
        console.log('UEA not deployed — self-transfer to deploy');
        const deployTx = await pushClient.universal.sendTransaction({
          to: ueaAddress,
          value: BigInt(1),
        });
        await deployTx.wait();
      }
      await ensureMinBalance(pushClient, pushPublicClient, ueaAddress);

      const tx = await pushClient.universal.sendTransaction({
        from: { chain: CHAIN.BNB_TESTNET },
        to: ueaAddress,
      });

      console.log(`Push Chain TX: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tracker.hasEvent('SEND-TX-302-03-02')).toBe(true);

      const receipt = await tx.wait();
      console.log(`Receipt status: ${receipt.status}`);
      expect(receipt.status).toBe(1);
    },
    360_000
  );

  // =========================================================================
  // Test 17: R3 EVM + forced Case C.
  // Verifies the minimal R3 Case C wiring: sizing.category === 'C' causes
  // `nativeValueForGas += overflowNativePc` (no bridge-swap, no fold-in).
  // Expects Push Chain tx to succeed with msg.value = 5 PC + 1 PC + protocolFee.
  // =========================================================================
  (skipE2E ? it.skip : it)(
    'forced Case C: R3 payload-only with overflow bumps msg.value',
    async () => {
      console.log('\n=== R3 Forced Case C ===');

      mockedSizer.mockResolvedValue({
        category: 'C' as const,
        gasLegNativePc: BigInt('5000000000000000000'), // 5 PC
        overflowNativePc: BigInt('1000000000000000000'), // 1 PC
        gasUsd: BigInt('1000000000'),
        overflowUsd: BigInt('100000000'),
      });

      const tracker = createProgressTracker();
      const { pushClient } = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey,
        printTraces: true,
        progressHook: tracker.hook,
      });
      const ueaAddress = pushClient.universal.account;
      console.log(`UEA: ${ueaAddress}`);

      const pushPublicClient = createPublicClient({
        transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
      });
      const ueaCode = await pushPublicClient.getCode({ address: ueaAddress });
      if (ueaCode === undefined) {
        const deployTx = await pushClient.universal.sendTransaction({
          to: ueaAddress,
          value: BigInt(1),
        });
        await deployTx.wait();
      }
      await ensureMinBalance(pushClient, pushPublicClient, ueaAddress);

      const tx = await pushClient.universal.sendTransaction({
        from: { chain: CHAIN.BNB_TESTNET },
        to: ueaAddress,
      });

      console.log(`Push Chain TX: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tracker.hasEvent('SEND-TX-302-03-03')).toBe(true);

      const receipt = await tx.wait();
      console.log(`Receipt status: ${receipt.status}`);
      expect(receipt.status).toBe(1);
    },
    360_000
  );
});
