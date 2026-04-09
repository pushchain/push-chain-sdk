import '@e2e/shared/setup';
/**
 * Route 2: Fresh Wallet nativeValueForGas Bug Reproduction
 *
 * Reproduces the ExecutionFailed (0xacfdb444) revert that occurs when a
 * FRESH wallet (UEA not yet deployed) attempts a Route 2 outbound
 * contract call (e.g., counter.increment() on BNB Testnet via CEA).
 *
 * Root cause: route-handlers.ts reads UEA balance (0) before fee-locking,
 * then the balance-aware adjustment falls to the `else` branch and uses
 * the 1M-multiplier nativeValueForGas — which is far too low for the
 * actual WPC/gasToken Uniswap V3 swap price. The multicall payload is
 * baked in before fee-locking and cannot be changed after.
 *
 * PRE-FIX:  Test 1 (fresh wallet, no prior UEA) should FAIL with ExecutionFailed
 * POST-FIX: Test 1 should PASS (pool-price estimation produces correct nativeValueForGas)
 * Test 2 (deployed UEA baseline) should always PASS.
 */
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
  parseEther,
  type Hex,
  type WalletClient,
  type PublicClient,
} from 'viem';
import {
  generatePrivateKey,
  privateKeyToAccount,
} from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { COUNTER_ABI } from '@e2e/shared/outbound-helpers';
import { createProgressTracker } from '@e2e/shared/progress-tracker';
import type { ProgressEvent } from '../../src/lib/progress-hook/progress-hook.types';

// BNB Testnet counter from chain-fixtures.ts
const COUNTER_ADDRESS = '0xf4bd8c13da0f5831d7b6dd3275a39f14ec7ddaa6' as `0x${string}`;

// Sepolia RPC for funding fresh wallets
const SEPOLIA_RPC = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];

const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
const skipE2E = !privateKey;

describe('Route 2: Fresh Wallet nativeValueForGas Bug', () => {
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
  }, 30000);

  // ==========================================================================
  // Test 1: Fresh wallet — Single-tx Route 2 with Uniswap V3 quote prediction
  //
  // PRE-FIX:  FAILS with ExecutionFailed (0xacfdb444) because pushToUSDC
  //           predicted 100 UPC from $10 but chain deposited only 18.3 UPC.
  // POST-FIX: SDK queries the same Uniswap V3 quoter the chain uses
  //           (pETH→WPC) to predict the real deposit. Single transaction.
  // ==========================================================================
  it('should execute Route 2 contract call from a fresh wallet (uniswap quote prediction)', async () => {
    if (skipE2E) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    // Create a fresh random wallet
    const freshPrivateKey = generatePrivateKey();
    const freshAccount = privateKeyToAccount(freshPrivateKey);
    console.log(`\n=== Fresh wallet: ${freshAccount.address} ===`);

    // Fund the fresh wallet with enough Sepolia ETH for:
    // 1. Auto-deploy self-transfer fee-locking (~0.001 ETH)
    // 2. Route 2 signed path gas (no additional fee-locking needed)
    const fundTxHash = await mainWalletClient.sendTransaction({
      to: freshAccount.address,
      value: parseEther('0.008'), // $10 minimum deposit + Sepolia gas needs ~0.006 ETH
      account: mainWalletClient.account!,
      chain: sepolia,
    });
    await publicClient.waitForTransactionReceipt({ hash: fundTxHash });
    console.log(`Funded fresh wallet: ${fundTxHash}`);

    // Create PushChain client with the fresh wallet
    const freshWalletClient = createWalletClient({
      account: freshAccount,
      chain: sepolia,
      transport: http(SEPOLIA_RPC),
    });

    const tracker = createProgressTracker();
    const universalSigner =
      await PushChain.utils.signer.toUniversalFromKeypair(freshWalletClient, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      });
    const freshPushClient = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      printTraces: true,
      progressHook: tracker.hook,
    });

    const ueaAddress = freshPushClient.universal.account;
    console.log(`Fresh wallet UEA: ${ueaAddress}`);

    // Verify UEA is NOT deployed (fresh wallet)
    const pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    const ueaCode = await pushPublicClient.getCode({ address: ueaAddress });
    console.log(`UEA deployed before Route 2: ${ueaCode !== undefined}`);
    expect(ueaCode).toBeUndefined(); // Must be undeployed for this test

    // Encode increment() calldata
    const data = encodeFunctionData({
      abi: COUNTER_ABI,
      functionName: 'increment',
    });

    // Route 2: fresh wallet, UEA not deployed.
    // SDK predicts post-deposit balance and uses _minimumDepositUsd ($3).
    // Chain auto-deploys UEA during fee-locking. Single transaction.
    const tx = await freshPushClient.universal.sendTransaction({
      to: {
        address: COUNTER_ADDRESS,
        chain: CHAIN.BNB_TESTNET,
      },
      data,
    });

    console.log(`Push Chain TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // Wait for CEA relay
    console.log('Waiting for outbound relay...');
    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
    console.log(`External TX Hash: ${receipt.externalTxHash}`);
    console.log(`External Chain: ${receipt.externalChain}`);

    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeDefined();
    expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
  }, 360000);

  // ==========================================================================
  // Test 2: Baseline — Route 2 WITH prior UEA deployment (should always pass)
  //
  // This matches the working pattern from cea-outbound-contract-call.spec.ts.
  // Acts as a control test to confirm the Route 2 flow works when UEA is
  // already deployed with sufficient balance.
  // ==========================================================================
  it('should execute Route 2 contract call from a deployed UEA (baseline)', async () => {
    if (skipE2E) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    console.log('\n=== Baseline: deployed UEA ===');

    const tracker = createProgressTracker();
    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey,
      printTraces: true,
      progressHook: tracker.hook,
    });
    const pushClient = setup.pushClient;
    const ueaAddress = pushClient.universal.account;
    console.log(`Main wallet UEA: ${ueaAddress}`);

    // Ensure UEA is deployed (same pattern as cea-outbound-contract-call.spec.ts)
    const pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    const code = await pushPublicClient.getCode({ address: ueaAddress });
    if (code === undefined) {
      console.log('UEA not deployed — deploying via self-transfer...');
      const deployTx = await pushClient.universal.sendTransaction({
        to: ueaAddress,
        value: BigInt(1),
      });
      const deployReceipt = await deployTx.wait();
      console.log(`UEA deployed — status: ${deployReceipt.status}`);
    }

    // Encode increment() calldata
    const data = encodeFunctionData({
      abi: COUNTER_ABI,
      functionName: 'increment',
    });

    // Route 2: should work because UEA is deployed with balance
    const tx = await pushClient.universal.sendTransaction({
      to: {
        address: COUNTER_ADDRESS,
        chain: CHAIN.BNB_TESTNET,
      },
      data,
    });

    console.log(`Push Chain TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // Wait for CEA relay
    console.log('Waiting for outbound relay...');
    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
    console.log(`External TX Hash: ${receipt.externalTxHash}`);
    console.log(`External Chain: ${receipt.externalChain}`);

    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeDefined();
    expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
  }, 360000);
});
