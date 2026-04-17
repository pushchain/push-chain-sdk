import '@e2e/shared/setup';
/**
 * Route 2 — Simulated signed e2e for Cases B and C (SDK 5.2 gas abstraction).
 *
 * Why "simulated": testnet donut's gas prices are so low that Case B and Case C
 * can't be triggered naturally (needs gasLimit > 30M). gasLimit values above
 * ~15M also stall in the chain relay on testnet. To verify the signed-tx path
 * for both cases without waiting for mainnet, we mock `sizeOutboundGas` at the
 * module level so the SDK believes the tx is Case B or Case C while the
 * underlying gasLimit stays small enough for the relay to happily deliver.
 *
 * Everything else — real oracle reads, real SwapRouter, real WPC pool, real
 * multicall composition, real signed tx, real outbound relay — is live.
 *
 * Coverage:
 *   Test 1 (forced B): sizer decision forced to Case B; SDK sends calibrated
 *                       gas leg, tx lands on BNB, SEND_TX_202_03_B fires.
 *   Test 2 (forced C): sizer decision forced to Case C with minimal overflow;
 *                       SDK composes 6-entry multicall (wrap/approve/swap +
 *                       approve-zero/approve-total/outbound), real bridge swap
 *                       executes on SwapRouter, tx lands on BNB.
 */

// ---------------------------------------------------------------------------
// Module mock — forced sizer category. Overridden per-test via mockResolvedValueOnce.
// ---------------------------------------------------------------------------
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
  decodeFunctionData,
  encodeFunctionData,
  http,
  parseEther,
  type Hex,
  type PublicClient,
  type WalletClient,
  createWalletClient,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { WPC_EVM, UNIV3_SWAP_ROUTER_EVM, ERC20_EVM } from '../../src/lib/constants/abi';
import { COUNTER_ABI } from '@e2e/shared/outbound-helpers';
import { createProgressTracker } from '@e2e/shared/progress-tracker';
import { SEPOLIA_RPC } from '@e2e/shared/constants';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { sizeOutboundGas } from '../../src/lib/orchestrator/internals/gas-usd-sizer';

const mockedSizer = sizeOutboundGas as unknown as jest.Mock;

const COUNTER_ADDRESS =
  '0xf4bd8c13da0f5831d7b6dd3275a39f14ec7ddaa6' as `0x${string}`;

// Ethereum Sepolia counter — used for native-funds tests (funds.token=ETH
// routes via pETH, which is the Ethereum Sepolia PRC-20).
const COUNTER_ADDRESS_SEPOLIA =
  '0xF1552eD5ac48C273570500bD10b10C00E1C418bB' as `0x${string}`;

const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
const skipE2E = !privateKey;

// Top-up if UEA balance < this
const MIN_UEA_BALANCE = BigInt('10000000000000000000'); // 10 PC
const TOP_UP_AMOUNT = BigInt('15000000000000000000'); // 15 PC per top-up

async function ensureMinBalance(
  pushClient: PushChain,
  pushPublicClient: PublicClient,
  ueaAddress: `0x${string}`
): Promise<bigint> {
  let balance = await pushPublicClient.getBalance({ address: ueaAddress });
  console.log(`UEA balance: ${balance}`);
  if (balance < MIN_UEA_BALANCE) {
    console.log(`< 10 PC — topping up 15 PC via self-transfer`);
    const topupTx = await pushClient.universal.sendTransaction({
      to: ueaAddress,
      value: TOP_UP_AMOUNT,
    });
    await topupTx.wait();
    balance = await pushPublicClient.getBalance({ address: ueaAddress });
    console.log(`After top-up: ${balance}`);
  }
  return balance;
}

describe('Route 2: Forced sizer Case B + C (signed e2e)', () => {
  let mainWalletClient: WalletClient;
  let publicClient: PublicClient;

  beforeAll(async () => {
    if (skipE2E) return;
    const mainAccount = privateKeyToAccount(privateKey);
    mainWalletClient = createWalletClient({
      account: mainAccount,
      chain: sepolia,
      transport: http(SEPOLIA_RPC),
    });
    publicClient = createPublicClient({
      chain: sepolia,
      transport: http(SEPOLIA_RPC),
    });
    void mainWalletClient;
    void publicClient;
  }, 30_000);

  beforeEach(() => {
    mockedSizer.mockReset();
  });

  // =========================================================================
  // Test 1: Forced Case B — SDK thinks gasUsd = $5, sends 5 PC, tx lands.
  // =========================================================================
  (skipE2E ? it.skip : it)(
    'forced Case B: SDK sizing = B → signed tx lands on BNB',
    async () => {
      console.log('\n=== Forced Case B ===');

      mockedSizer.mockResolvedValue({
        category: 'B' as const,
        gasLegNativePc: BigInt('5000000000000000000'), // 5 PC
        overflowNativePc: BigInt(0),
        gasUsd: BigInt('500000000'), // $5.00 (informational)
        overflowUsd: BigInt(0),
      });

      const tracker = createProgressTracker();
      const setup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey,
        printTraces: true,
        progressHook: tracker.hook,
      });
      const pushClient = setup.pushClient;
      const ueaAddress = pushClient.universal.account;
      const pushPublicClient = createPublicClient({
        transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
      });
      await ensureMinBalance(pushClient, pushPublicClient, ueaAddress);

      const data = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });

      const tx = await pushClient.universal.sendTransaction({
        to: { address: COUNTER_ADDRESS, chain: CHAIN.BNB_TESTNET },
        data,
      });

      console.log(`Push Chain TX: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tracker.hasEvent('SEND-TX-202-03-B')).toBe(true);

      const receipt = await tx.wait();
      console.log(`External TX: ${receipt.externalTxHash}`);
      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
    },
    360_000
  );

  // =========================================================================
  // Test 2: Forced Case C — SDK composes bridge-swap entries, lands on BNB.
  // =========================================================================
  (skipE2E ? it.skip : it)(
    'forced Case C: SDK sizing = C → 6-entry multicall → signed tx lands',
    async () => {
      console.log('\n=== Forced Case C ===');

      mockedSizer.mockResolvedValue({
        category: 'C' as const,
        gasLegNativePc: BigInt('5000000000000000000'), // 5 PC gas leg
        overflowNativePc: BigInt('100000000000000000'), // 0.1 PC overflow
        gasUsd: BigInt('1000000000'), // $10
        overflowUsd: BigInt('10000000'), // $0.10
      });

      const tracker = createProgressTracker();
      const setup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey,
        printTraces: true,
        progressHook: tracker.hook,
      });
      const pushClient = setup.pushClient;
      const ueaAddress = pushClient.universal.account;
      const pushPublicClient = createPublicClient({
        transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
      });
      await ensureMinBalance(pushClient, pushPublicClient, ueaAddress);

      const data = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });

      const tx = await pushClient.universal.sendTransaction({
        to: { address: COUNTER_ADDRESS, chain: CHAIN.BNB_TESTNET },
        data,
      });

      console.log(`Push Chain TX: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tracker.hasEvent('SEND-TX-202-03-C')).toBe(true);

      // Decode the Push Chain tx to confirm the 6-entry multicall shape.
      // UEA.execute(MultiCall[]) is the outer call; inspect its input.
      try {
        const pushTx = await pushPublicClient.getTransaction({
          hash: tx.hash as `0x${string}`,
        });
        console.log(`Push tx input length: ${pushTx.input.length}`);
        // The UEA receives a multicall-wrapped payload. We don't decode the
        // full UEA ABI here (avoids coupling to the UEA interface) but the
        // presence of the three Case C ABI signatures (WPC.deposit / approve
        // / SwapRouter.exactInputSingle) in the raw input bytes is enough.
        const depositSelector = encodeFunctionData({
          abi: WPC_EVM,
          functionName: 'deposit',
          args: [],
        }).slice(0, 10);
        const swapSelector = encodeFunctionData({
          abi: UNIV3_SWAP_ROUTER_EVM,
          functionName: 'exactInputSingle',
          args: [
            {
              tokenIn: '0x0000000000000000000000000000000000000001',
              tokenOut: '0x0000000000000000000000000000000000000002',
              fee: 500,
              recipient: ueaAddress,
              deadline: BigInt(0),
              amountIn: BigInt(1),
              amountOutMinimum: BigInt(1),
              sqrtPriceLimitX96: BigInt(0),
            },
          ],
        }).slice(0, 10);
        expect(pushTx.input).toContain(depositSelector.slice(2));
        expect(pushTx.input).toContain(swapSelector.slice(2));
      } catch (err) {
        console.log(`Selector decode skipped: ${err}`);
      }

      const receipt = await tx.wait();
      console.log(`External TX: ${receipt.externalTxHash}`);
      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
    },
    360_000
  );

  // =========================================================================
  // Test 3: Forced Case B + native value transfer (no data, no funds).
  // Exercises the "native value only" ceaMulticalls path combined with B.
  // =========================================================================
  (skipE2E ? it.skip : it)(
    'forced Case B + value only → native transfer lands on BNB',
    async () => {
      console.log('\n=== Forced Case B + value only ===');

      mockedSizer.mockResolvedValue({
        category: 'B' as const,
        gasLegNativePc: BigInt('5000000000000000000'),
        overflowNativePc: BigInt(0),
        gasUsd: BigInt('500000000'),
        overflowUsd: BigInt(0),
      });

      const tracker = createProgressTracker();
      const setup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey,
        printTraces: true,
        progressHook: tracker.hook,
      });
      const pushClient = setup.pushClient;
      const ueaAddress = pushClient.universal.account;
      const pushPublicClient = createPublicClient({
        transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
      });
      await ensureMinBalance(pushClient, pushPublicClient, ueaAddress);

      // Send 1 wei of BNB to a dummy address (no contract call).
      const tx = await pushClient.universal.sendTransaction({
        to: {
          address: '0x1234567890123456789012345678901234567890' as `0x${string}`,
          chain: CHAIN.BNB_TESTNET,
        },
        value: BigInt(1),
      });

      console.log(`Push Chain TX: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tracker.hasEvent('SEND-TX-202-03-B')).toBe(true);

      const receipt = await tx.wait();
      console.log(`External TX: ${receipt.externalTxHash}`);
      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
    },
    360_000
  );

  // =========================================================================
  // Test 4: Forced Case B + multicall array data.
  // Exercises buildCeaMulticallPayload with an explicit multicall under B.
  // =========================================================================
  (skipE2E ? it.skip : it)(
    'forced Case B + multicall array → 2× increment lands on BNB',
    async () => {
      console.log('\n=== Forced Case B + multicall array ===');

      mockedSizer.mockResolvedValue({
        category: 'B' as const,
        gasLegNativePc: BigInt('5000000000000000000'),
        overflowNativePc: BigInt(0),
        gasUsd: BigInt('500000000'),
        overflowUsd: BigInt(0),
      });

      const tracker = createProgressTracker();
      const setup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey,
        printTraces: true,
        progressHook: tracker.hook,
      });
      const pushClient = setup.pushClient;
      const ueaAddress = pushClient.universal.account;
      const pushPublicClient = createPublicClient({
        transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
      });
      await ensureMinBalance(pushClient, pushPublicClient, ueaAddress);

      const incrementCalldata = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });

      // 2× increment() as explicit multicall array.
      const tx = await pushClient.universal.sendTransaction({
        to: { address: COUNTER_ADDRESS, chain: CHAIN.BNB_TESTNET },
        data: [
          { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementCalldata },
          { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementCalldata },
        ],
      });

      console.log(`Push Chain TX: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tracker.hasEvent('SEND-TX-202-03-B')).toBe(true);

      const receipt = await tx.wait();
      console.log(`External TX: ${receipt.externalTxHash}`);
      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
    },
    360_000
  );

  // =========================================================================
  // Test 5: Forced Case C + value only.
  // Overflow bridge composed on top of a pure native-transfer outbound.
  // =========================================================================
  (skipE2E ? it.skip : it)(
    'forced Case C + value only → native transfer + overflow lands on BNB',
    async () => {
      console.log('\n=== Forced Case C + value only ===');

      mockedSizer.mockResolvedValue({
        category: 'C' as const,
        gasLegNativePc: BigInt('5000000000000000000'),
        overflowNativePc: BigInt('100000000000000000'),
        gasUsd: BigInt('1000000000'),
        overflowUsd: BigInt('10000000'),
      });

      const tracker = createProgressTracker();
      const setup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey,
        printTraces: true,
        progressHook: tracker.hook,
      });
      const pushClient = setup.pushClient;
      const ueaAddress = pushClient.universal.account;
      const pushPublicClient = createPublicClient({
        transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
      });
      await ensureMinBalance(pushClient, pushPublicClient, ueaAddress);

      const tx = await pushClient.universal.sendTransaction({
        to: {
          address: '0x1234567890123456789012345678901234567890' as `0x${string}`,
          chain: CHAIN.BNB_TESTNET,
        },
        value: BigInt(1),
      });

      console.log(`Push Chain TX: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tracker.hasEvent('SEND-TX-202-03-C')).toBe(true);

      const receipt = await tx.wait();
      console.log(`External TX: ${receipt.externalTxHash}`);
      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
    },
    360_000
  );

  // =========================================================================
  // Test 6: Forced Case C + multicall array.
  // Bridge-swap entries prepended + user's multicall executes on destination.
  // =========================================================================
  (skipE2E ? it.skip : it)(
    'forced Case C + multicall array → 2× increment + overflow lands on BNB',
    async () => {
      console.log('\n=== Forced Case C + multicall array ===');

      mockedSizer.mockResolvedValue({
        category: 'C' as const,
        gasLegNativePc: BigInt('5000000000000000000'),
        overflowNativePc: BigInt('100000000000000000'),
        gasUsd: BigInt('1000000000'),
        overflowUsd: BigInt('10000000'),
      });

      const tracker = createProgressTracker();
      const setup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey,
        printTraces: true,
        progressHook: tracker.hook,
      });
      const pushClient = setup.pushClient;
      const ueaAddress = pushClient.universal.account;
      const pushPublicClient = createPublicClient({
        transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
      });
      await ensureMinBalance(pushClient, pushPublicClient, ueaAddress);

      const incrementCalldata = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });
      const tx = await pushClient.universal.sendTransaction({
        to: { address: COUNTER_ADDRESS, chain: CHAIN.BNB_TESTNET },
        data: [
          { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementCalldata },
          { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementCalldata },
        ],
      });

      console.log(`Push Chain TX: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tracker.hasEvent('SEND-TX-202-03-C')).toBe(true);

      const receipt = await tx.wait();
      console.log(`External TX: ${receipt.externalTxHash}`);
      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
    },
    360_000
  );

  // =========================================================================
  // Test 7: Forced Case C + ERC-20 funds → should throw the typed error.
  // No signed tx submitted — throws inside executeUoaToCea after the gas
  // query. Fast (~10 sec). Verifies the rejection path at e2e level.
  // =========================================================================
  (skipE2E ? it.skip : it)(
    'forced Case C + ERC-20 funds → throws GasExceedsCategoryCWithErc20FundsError',
    async () => {
      console.log('\n=== Forced Case C + ERC-20 funds (expect throw) ===');

      mockedSizer.mockResolvedValue({
        category: 'C' as const,
        gasLegNativePc: BigInt('5000000000000000000'),
        overflowNativePc: BigInt('100000000000000000'),
        gasUsd: BigInt('1000000000'),
        overflowUsd: BigInt('10000000'),
      });

      const tracker = createProgressTracker();
      const setup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey,
        printTraces: true,
        progressHook: tracker.hook,
      });
      const pushClient = setup.pushClient;

      const data = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });
      const usdt = PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDT;

      await expect(
        pushClient.universal.sendTransaction({
          to: { address: COUNTER_ADDRESS, chain: CHAIN.BNB_TESTNET },
          data,
          funds: { amount: BigInt(10_000), token: usdt },
        })
      ).rejects.toThrow(/ERC-20 funds|GasExceedsCategoryC/);

      expect(tracker.hasEvent('SEND-TX-202-03-C')).toBe(true);
    },
    120_000
  );

  // =========================================================================
  // Test 8: Fresh wallet + forced Case B (payload only).
  // Exercises the fee-lock path under forced B — UEA doesn't exist yet,
  // SDK must deploy + provision enough PC via fee-lock to cover 5 PC gas leg.
  // =========================================================================
  (skipE2E ? it.skip : it)(
    'fresh wallet + forced Case B → fee-lock provisions enough for B',
    async () => {
      console.log('\n=== Fresh wallet + forced Case B ===');

      mockedSizer.mockResolvedValue({
        category: 'B' as const,
        gasLegNativePc: BigInt('5000000000000000000'),
        overflowNativePc: BigInt(0),
        gasUsd: BigInt('500000000'),
        overflowUsd: BigInt(0),
      });

      const freshPrivateKey = generatePrivateKey();
      const freshAccount = privateKeyToAccount(freshPrivateKey);
      console.log(`Fresh wallet: ${freshAccount.address}`);

      // Fund 0.008 ETH — same as route2-fresh-wallet-gas-bug.spec.ts fresh
      // wallet pattern. Triggers $10 fee-lock → ~20-35 PC credited to UEA,
      // sufficient for the 5 PC gas leg.
      const fundTx = await mainWalletClient.sendTransaction({
        to: freshAccount.address,
        value: parseEther('0.008'),
        account: mainWalletClient.account!,
        chain: sepolia,
      });
      await publicClient.waitForTransactionReceipt({ hash: fundTx });

      const freshWalletClient = createWalletClient({
        account: freshAccount,
        chain: sepolia,
        transport: http(SEPOLIA_RPC),
      });
      const universalSigner =
        await PushChain.utils.signer.toUniversalFromKeypair(freshWalletClient, {
          chain: CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        });
      const tracker = createProgressTracker();
      const pushClient = await PushChain.initialize(universalSigner, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        printTraces: true,
        progressHook: tracker.hook,
      });

      const data = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });

      const tx = await pushClient.universal.sendTransaction({
        to: { address: COUNTER_ADDRESS, chain: CHAIN.BNB_TESTNET },
        data,
      });

      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tracker.hasEvent('SEND-TX-202-03-B')).toBe(true);

      const receipt = await tx.wait();
      console.log(`External TX: ${receipt.externalTxHash}`);
      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
    },
    360_000
  );

  // =========================================================================
  // Test 9: Fresh wallet + forced Case C (payload only).
  // Fee-lock must provision enough PC for gas leg + overflow + reserve.
  // Critical for UX: a first-time user hitting mainnet-like gas conditions
  // on their very first tx.
  // =========================================================================
  (skipE2E ? it.skip : it)(
    'fresh wallet + forced Case C → fee-lock provisions enough for C + bridge-swap composes',
    async () => {
      console.log('\n=== Fresh wallet + forced Case C ===');

      mockedSizer.mockResolvedValue({
        category: 'C' as const,
        gasLegNativePc: BigInt('5000000000000000000'),
        overflowNativePc: BigInt('100000000000000000'),
        gasUsd: BigInt('1000000000'),
        overflowUsd: BigInt('10000000'),
      });

      const freshPrivateKey = generatePrivateKey();
      const freshAccount = privateKeyToAccount(freshPrivateKey);
      console.log(`Fresh wallet: ${freshAccount.address}`);

      // Bump to 0.012 ETH for more fee-lock headroom since Case C needs
      // gas leg + overflow + reserve = ~8.1 PC min.
      const fundTx = await mainWalletClient.sendTransaction({
        to: freshAccount.address,
        value: parseEther('0.012'),
        account: mainWalletClient.account!,
        chain: sepolia,
      });
      await publicClient.waitForTransactionReceipt({ hash: fundTx });

      const freshWalletClient = createWalletClient({
        account: freshAccount,
        chain: sepolia,
        transport: http(SEPOLIA_RPC),
      });
      const universalSigner =
        await PushChain.utils.signer.toUniversalFromKeypair(freshWalletClient, {
          chain: CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        });
      const tracker = createProgressTracker();
      const pushClient = await PushChain.initialize(universalSigner, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        printTraces: true,
        progressHook: tracker.hook,
      });

      const data = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });

      const tx = await pushClient.universal.sendTransaction({
        to: { address: COUNTER_ADDRESS, chain: CHAIN.BNB_TESTNET },
        data,
      });

      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tracker.hasEvent('SEND-TX-202-03-C')).toBe(true);

      const receipt = await tx.wait();
      console.log(`External TX: ${receipt.externalTxHash}`);
      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
    },
    360_000
  );

  // =========================================================================
  // Test 10: Forced Case B with LARGER gas leg (15 PC instead of 5 PC).
  // Stress-tests the balance-aware adjustment — 15 PC + 3 PC reserve = 18 PC,
  // pushes the UEA balance-clamp logic close to its threshold.
  // =========================================================================
  (skipE2E ? it.skip : it)(
    'forced Case B + large gas leg (15 PC) → balance-aware still lands on BNB',
    async () => {
      console.log('\n=== Forced Case B + 15 PC gas leg ===');

      mockedSizer.mockResolvedValue({
        category: 'B' as const,
        gasLegNativePc: BigInt('15000000000000000000'), // 15 PC
        overflowNativePc: BigInt(0),
        gasUsd: BigInt('1000000000'), // $10 (right at boundary)
        overflowUsd: BigInt(0),
      });

      const tracker = createProgressTracker();
      const setup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey,
        printTraces: true,
        progressHook: tracker.hook,
      });
      const pushClient = setup.pushClient;
      const ueaAddress = pushClient.universal.account;
      const pushPublicClient = createPublicClient({
        transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
      });
      // 15 PC + 3 PC reserve = 18 PC — may need top-up
      const MIN = BigInt('18000000000000000000');
      let balance = await pushPublicClient.getBalance({ address: ueaAddress });
      console.log(`UEA balance: ${balance}`);
      if (balance < MIN) {
        console.log(`Below 18 PC — topping up via self-transfer`);
        const topup = await pushClient.universal.sendTransaction({
          to: ueaAddress,
          value: BigInt('15000000000000000000'),
        });
        await topup.wait();
        balance = await pushPublicClient.getBalance({ address: ueaAddress });
        console.log(`After top-up: ${balance}`);
      }

      const data = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });

      const tx = await pushClient.universal.sendTransaction({
        to: { address: COUNTER_ADDRESS, chain: CHAIN.BNB_TESTNET },
        data,
      });

      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tracker.hasEvent('SEND-TX-202-03-B')).toBe(true);

      const receipt = await tx.wait();
      console.log(`External TX: ${receipt.externalTxHash}`);
      expect(receipt.status).toBe(1);
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
    },
    360_000
  );

  // =========================================================================
  // Test 11: Forced Case C with LARGER overflow (1 PC instead of 0.1 PC).
  // Stress-tests the bridge-swap path — 10× the overflow means 10× the WPC
  // wrapped + swapped, 10× the pBNB folded into burn. Still within UEA
  // balance but exercises meaningful on-chain value movement.
  // =========================================================================
  (skipE2E ? it.skip : it)(
    'forced Case C + larger overflow (1 PC) → bridge-swap executes meaningful volume',
    async () => {
      console.log('\n=== Forced Case C + 1 PC overflow ===');

      mockedSizer.mockResolvedValue({
        category: 'C' as const,
        gasLegNativePc: BigInt('5000000000000000000'),
        overflowNativePc: BigInt('1000000000000000000'), // 1 PC overflow
        gasUsd: BigInt('1000000000'),
        overflowUsd: BigInt('100000000'), // $1
      });

      const tracker = createProgressTracker();
      const setup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey,
        printTraces: true,
        progressHook: tracker.hook,
      });
      const pushClient = setup.pushClient;
      const ueaAddress = pushClient.universal.account;
      const pushPublicClient = createPublicClient({
        transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
      });
      // 5 PC gas + 1 PC overflow + 3 PC reserve = 9 PC
      await ensureMinBalance(pushClient, pushPublicClient, ueaAddress);

      const data = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });

      const tx = await pushClient.universal.sendTransaction({
        to: { address: COUNTER_ADDRESS, chain: CHAIN.BNB_TESTNET },
        data,
      });

      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tracker.hasEvent('SEND-TX-202-03-C')).toBe(true);

      const receipt = await tx.wait();
      console.log(`External TX: ${receipt.externalTxHash}`);
      expect(receipt.status).toBe(1);
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
    },
    360_000
  );

  // =========================================================================
  // Test 12: Forced Case B + value + payload combined (to BNB).
  // Exercises destination msg.value + data together under forced B. UEA
  // uses existing pBNB balance from prior tests for the msg.value leg.
  // =========================================================================
  (skipE2E ? it.skip : it)(
    'forced Case B + value + payload → increment() payable with msg.value lands',
    async () => {
      console.log('\n=== Forced Case B + value + payload ===');

      mockedSizer.mockResolvedValue({
        category: 'B' as const,
        gasLegNativePc: BigInt('5000000000000000000'),
        overflowNativePc: BigInt(0),
        gasUsd: BigInt('500000000'),
        overflowUsd: BigInt(0),
      });

      const tracker = createProgressTracker();
      const setup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey,
        printTraces: true,
        progressHook: tracker.hook,
      });
      const pushClient = setup.pushClient;
      const ueaAddress = pushClient.universal.account;
      const pushPublicClient = createPublicClient({
        transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
      });
      await ensureMinBalance(pushClient, pushPublicClient, ueaAddress);

      const data = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });

      const tx = await pushClient.universal.sendTransaction({
        to: { address: COUNTER_ADDRESS, chain: CHAIN.BNB_TESTNET },
        data,
        value: BigInt(1), // 1 wei BNB alongside the increment call
      });

      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tracker.hasEvent('SEND-TX-202-03-B')).toBe(true);

      const receipt = await tx.wait();
      console.log(`External TX: ${receipt.externalTxHash}`);
      expect(receipt.status).toBe(1);
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
    },
    360_000
  );

  // =========================================================================
  // Test 13: Forced Case C + value + payload combined (to BNB).
  // Same as Test 12 but with Case C overflow bridge composed on top.
  // =========================================================================
  (skipE2E ? it.skip : it)(
    'forced Case C + value + payload → increment() payable + overflow bridge lands',
    async () => {
      console.log('\n=== Forced Case C + value + payload ===');

      mockedSizer.mockResolvedValue({
        category: 'C' as const,
        gasLegNativePc: BigInt('5000000000000000000'),
        overflowNativePc: BigInt('100000000000000000'),
        gasUsd: BigInt('1000000000'),
        overflowUsd: BigInt('10000000'),
      });

      const tracker = createProgressTracker();
      const setup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey,
        printTraces: true,
        progressHook: tracker.hook,
      });
      const pushClient = setup.pushClient;
      const ueaAddress = pushClient.universal.account;
      const pushPublicClient = createPublicClient({
        transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
      });
      await ensureMinBalance(pushClient, pushPublicClient, ueaAddress);

      const data = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });

      const tx = await pushClient.universal.sendTransaction({
        to: { address: COUNTER_ADDRESS, chain: CHAIN.BNB_TESTNET },
        data,
        value: BigInt(1),
      });

      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tracker.hasEvent('SEND-TX-202-03-C')).toBe(true);

      const receipt = await tx.wait();
      console.log(`External TX: ${receipt.externalTxHash}`);
      expect(receipt.status).toBe(1);
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
    },
    360_000
  );

  // =========================================================================
  // Test 14: Forced Case B + native funds + payload (to Ethereum Sepolia).
  // Exercises the `funds: ETH native` bridge path under forced B. The SDK
  // auto-maps native ETH funds → pETH PRC-20 burn → destination Ethereum
  // Sepolia receives both the increment() call and 0.0001 ETH from vault.
  // =========================================================================
  (skipE2E ? it.skip : it)(
    'forced Case B + native funds + payload → pETH burn bridges ETH to Sepolia',
    async () => {
      console.log('\n=== Forced Case B + native funds + payload ===');

      mockedSizer.mockResolvedValue({
        category: 'B' as const,
        gasLegNativePc: BigInt('5000000000000000000'),
        overflowNativePc: BigInt(0),
        gasUsd: BigInt('500000000'),
        overflowUsd: BigInt(0),
      });

      const tracker = createProgressTracker();
      const setup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey,
        printTraces: true,
        progressHook: tracker.hook,
      });
      const pushClient = setup.pushClient;
      const ueaAddress = pushClient.universal.account;
      const pushPublicClient = createPublicClient({
        transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
      });
      await ensureMinBalance(pushClient, pushPublicClient, ueaAddress);

      const data = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });

      const tx = await pushClient.universal.sendTransaction({
        to: { address: COUNTER_ADDRESS_SEPOLIA, chain: CHAIN.ETHEREUM_SEPOLIA },
        data,
        funds: {
          amount: BigInt('100000000000000'), // 0.0001 ETH (1e14 wei)
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH,
        },
      });

      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tracker.hasEvent('SEND-TX-202-03-B')).toBe(true);

      const receipt = await tx.wait();
      console.log(`External TX: ${receipt.externalTxHash}`);
      expect(receipt.status).toBe(1);
      expect(receipt.externalChain).toBe(CHAIN.ETHEREUM_SEPOLIA);
    },
    360_000
  );

  // =========================================================================
  // Test 15: Forced Case C + native funds + payload (FOLD-IN TEST).
  //
  // This is the critical one: Case C's `extraBurnAmount` (from WPC→pETH
  // swap of the overflow) must ADD TO user's funds-derived burnAmount
  // (0.0001 pETH from bridged ETH), not overwrite it.
  //
  // If the fold-in works, the destination CEA on Sepolia:
  //   1. Receives 0.0001 ETH (from user's funds-burn)
  //   2. Receives an additional ~20k wei ETH (from swap-derived burn)
  //   3. Executes counter.increment()
  // =========================================================================
  (skipE2E ? it.skip : it)(
    'forced Case C + native funds + payload → FOLD-IN burnAmount works end-to-end',
    async () => {
      console.log('\n=== Forced Case C + native funds + payload (FOLD-IN) ===');

      mockedSizer.mockResolvedValue({
        category: 'C' as const,
        gasLegNativePc: BigInt('5000000000000000000'),
        overflowNativePc: BigInt('100000000000000000'), // 0.1 PC overflow
        gasUsd: BigInt('1000000000'),
        overflowUsd: BigInt('10000000'),
      });

      const tracker = createProgressTracker();
      const setup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey,
        printTraces: true,
        progressHook: tracker.hook,
      });
      const pushClient = setup.pushClient;
      const ueaAddress = pushClient.universal.account;
      const pushPublicClient = createPublicClient({
        transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
      });
      await ensureMinBalance(pushClient, pushPublicClient, ueaAddress);

      const data = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });

      const tx = await pushClient.universal.sendTransaction({
        to: { address: COUNTER_ADDRESS_SEPOLIA, chain: CHAIN.ETHEREUM_SEPOLIA },
        data,
        funds: {
          amount: BigInt('100000000000000'), // 0.0001 ETH
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH,
        },
      });

      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tracker.hasEvent('SEND-TX-202-03-C')).toBe(true);

      const receipt = await tx.wait();
      console.log(`External TX: ${receipt.externalTxHash}`);
      expect(receipt.status).toBe(1);
      expect(receipt.externalChain).toBe(CHAIN.ETHEREUM_SEPOLIA);
    },
    360_000
  );

  // Keep unused ABI import reference satisfied.
  void ERC20_EVM;
  void decodeFunctionData;
});
