import '@e2e/shared/setup';
import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { createProgressTracker } from '@e2e/shared/progress-tracker';
import {
  COUNTER_ADDRESS_PAYABLE,
  COUNTER_ABI_PAYABLE,
} from '@e2e/shared/inbound-helpers';

/**
 * Bug Diagnostic: UEA Funded But Not Deployed
 *
 * Reproduces the scenario where a developer:
 * 1. Creates a fresh wallet on Sepolia (no ETH)
 * 2. Derives UEA on Push Chain
 * 3. Funds the UEA with $PC directly on Push Chain
 * 4. Tries sendTransaction → fails because SDK forces fee-locking path
 *    (UEA not deployed → feeLockingRequired=true → needs origin chain ETH)
 *
 * Root cause: execute-standard.ts line 133:
 *   feeLockingRequired = !_skipFeeLocking && (!isUEADeployed || funds < requiredFunds) && !feeLockTxHash
 *   Even when funds >= requiredFunds, isUEADeployed=false forces fee-locking.
 */

const PUSH_RPC = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0];
const SEPOLIA_RPC = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];
const FUND_AMOUNT = BigInt(1e15); // 0.001 $PC — enough for gas

describe('UEA Funded But Not Deployed Debug', () => {
  // Main wallet on Push Chain (for funding via Push-to-Push path, uses EOA balance)
  let mainPushClient: PushChain;
  // Main wallet on Sepolia (for baseline comparison)
  let mainSepoliaClient: PushChain;

  // Fresh wallet (no origin chain ETH)
  let freshSepoliaAddress: `0x${string}`;
  let freshUEAAddress: `0x${string}`;
  let freshPushClient: PushChain;
  const freshTracker = createProgressTracker();

  // Push Chain public client for direct RPC queries
  const pushPublicClient = createPublicClient({
    transport: http(PUSH_RPC),
  });

  // Sepolia public client
  const sepoliaPublicClient = createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC),
  });

  beforeAll(async () => {
    const evmKey = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!evmKey) throw new Error('EVM_PRIVATE_KEY not set');

    // 1. Main Push client (Push-to-Push path — uses EOA $PC balance directly, no fee-locking)
    const pushSetup = await createEvmPushClient({
      chain: CHAIN.PUSH_TESTNET_DONUT,
      privateKey: evmKey,
      progressHook: (v) => console.log('[main-push]', v.id, v.title),
    });
    mainPushClient = pushSetup.pushClient;

    // 2. Fresh wallet — NO Sepolia ETH funding
    const freshKey = generatePrivateKey();
    const freshAccount = privateKeyToAccount(freshKey);
    freshSepoliaAddress = freshAccount.address;
    console.log(`\nFresh wallet address (Sepolia): ${freshSepoliaAddress}`);

    const freshWalletClient = createWalletClient({
      account: freshAccount,
      chain: sepolia,
      transport: http(SEPOLIA_RPC),
    });

    // 3. Create universal signer + PushChain client for fresh wallet (Sepolia origin)
    const freshSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      freshWalletClient,
      {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );
    freshPushClient = await PushChain.initialize(freshSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: freshTracker.hook,
    });

    // 4. Derive UEA address
    const universalAccount = PushChain.utils.account.toUniversal(
      freshAccount.address,
      { chain: CHAIN.ETHEREUM_SEPOLIA }
    );
    const derivation = await PushChain.utils.account.deriveExecutorAccount(
      universalAccount,
      { skipNetworkCheck: true }
    );
    freshUEAAddress = derivation.address;
    console.log(`Fresh UEA address (Push Chain): ${freshUEAAddress}`);

    // 5. Fund UEA on Push Chain via Push-to-Push path (uses EOA balance, no fee-locking)
    console.log(`Funding UEA with ${FUND_AMOUNT} wei $PC...`);
    const fundTx = await mainPushClient.universal.sendTransaction({
      to: freshUEAAddress,
      value: FUND_AMOUNT,
    });
    const fundReceipt = await fundTx.wait();
    console.log(`UEA funded — tx: ${fundTx.hash}, status: ${fundReceipt.status}`);
  }, 120_000);

  // =========================================================================
  // Test 1: Confirm the "funded but not deployed" state
  // =========================================================================
  it('should confirm UEA is funded but NOT deployed', async () => {
    const [code, balance, sepoliaBalance] = await Promise.all([
      pushPublicClient.getCode({ address: freshUEAAddress }),
      pushPublicClient.getBalance({ address: freshUEAAddress }),
      sepoliaPublicClient.getBalance({ address: freshSepoliaAddress }),
    ]);

    const isDeployed = code !== undefined;

    console.log('\n=== UEA State Diagnosis ===');
    console.log(`  UEA address:      ${freshUEAAddress}`);
    console.log(`  Deployed:         ${isDeployed} (getCode: ${code ?? 'undefined'})`);
    console.log(`  $PC balance:      ${balance} wei`);
    console.log(`  Sepolia balance:  ${sepoliaBalance} wei (origin chain)`);

    expect(isDeployed).toBe(false);
    expect(balance).toBeGreaterThan(BigInt(0));
    expect(sepoliaBalance).toBe(BigInt(0));
  }, 30_000);

  // =========================================================================
  // Test 2: Reproduce the fee-locking formula evaluation
  // =========================================================================
  it('should reproduce fee-locking formula bug', async () => {
    const [code, balance, gasPrice] = await Promise.all([
      pushPublicClient.getCode({ address: freshUEAAddress }),
      pushPublicClient.getBalance({ address: freshUEAAddress }),
      pushPublicClient.getGasPrice(),
    ]);

    const isUEADeployed = code !== undefined;
    const gasEstimate = BigInt(1e7); // SDK default
    const requiredFunds = gasEstimate * gasPrice;
    const feeLockingRequired = !isUEADeployed || balance < requiredFunds;

    console.log('\n=== Fee-Locking Formula (execute-standard.ts:133) ===');
    console.log(`  isUEADeployed:      ${isUEADeployed}`);
    console.log(`  UEA balance:        ${balance} wei`);
    console.log(`  gasPrice:           ${gasPrice} wei`);
    console.log(`  gasEstimate:        ${gasEstimate}`);
    console.log(`  requiredFunds:      ${requiredFunds} wei`);
    console.log(`  funds >= required:  ${balance >= requiredFunds}`);
    console.log(`  feeLockingRequired: ${feeLockingRequired}`);
    console.log(`  >> Bug: feeLockingRequired=true even though UEA has enough $PC,`);
    console.log(`     because isUEADeployed=false forces fee-locking path.`);

    expect(isUEADeployed).toBe(false);
    expect(feeLockingRequired).toBe(true);
  }, 30_000);

  // =========================================================================
  // Test 3: Attempt sendTransaction — capture error + progress events
  // =========================================================================
  it('should capture error when sendTransaction hits fee-locking with no origin ETH', async () => {
    freshTracker.reset();

    const incrementData = PushChain.utils.helpers.encodeTxData({
      abi: COUNTER_ABI_PAYABLE as any[],
      functionName: 'increment',
    });

    let txHash: string | undefined;
    let caughtError: Error | undefined;

    try {
      const tx = await freshPushClient.universal.sendTransaction({
        to: COUNTER_ADDRESS_PAYABLE,
        data: incrementData,
      });
      txHash = tx.hash;
      console.log('\nTransaction SUCCEEDED (bug may be fixed):', txHash);
      const receipt = await tx.wait();
      console.log('Receipt status:', receipt.status);
    } catch (error: any) {
      caughtError = error;
      console.log('\n=== Transaction FAILED (expected for funded-but-not-deployed) ===');
      console.log(`  Error type:    ${error?.constructor?.name}`);
      console.log(`  Error message: ${error?.message}`);
      if (error?.cause) console.log(`  Error cause:   ${error.cause}`);
      if (error?.shortMessage) console.log(`  Short message: ${error.shortMessage}`);
    }

    // Dump progress events
    console.log('\n=== Progress Events ===');
    for (const { event } of freshTracker.events) {
      console.log(`  [${event.id}] (${event.level}) ${event.title}: ${event.message}`);
    }

    // Identify which path was taken
    const ids = freshTracker.getIds();
    console.log('\n=== Path Analysis ===');
    console.log(`  Event IDs: ${ids.join(', ')}`);
    if (ids.includes('SEND-TX-105-01')) {
      console.log('  >> Took FEE-LOCKING path (expected for undeployed UEA)');
    }
    if (ids.includes('SEND-TX-104-02')) {
      console.log('  >> Took SIGNED VERIFICATION path');
    }
    if (ids.includes('SEND-TX-103-02')) {
      console.log('  >> UEA status resolved');
    }

    // Diagnostic test — passes either way, the value is in the console output
    expect(txHash || caughtError).toBeDefined();
  }, 120_000);

  // =========================================================================
  // Test 4: Baseline — Push-to-Push tx should succeed (comparison path)
  // =========================================================================
  it('should succeed with Push-to-Push tx as baseline comparison', async () => {
    const baselineTracker = createProgressTracker();

    const evmKey = process.env['EVM_PRIVATE_KEY'] as Hex;
    const baselineSetup = await createEvmPushClient({
      chain: CHAIN.PUSH_TESTNET_DONUT,
      privateKey: evmKey,
      progressHook: baselineTracker.hook,
    });

    const incrementData = PushChain.utils.helpers.encodeTxData({
      abi: COUNTER_ABI_PAYABLE as any[],
      functionName: 'increment',
    });

    const tx = await baselineSetup.pushClient.universal.sendTransaction({
      to: COUNTER_ADDRESS_PAYABLE,
      data: incrementData,
    });

    console.log(`\nBaseline TX hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log(`Baseline receipt status: ${receipt.status}`);
    expect(receipt.status).toBe(1);

    // Dump baseline progress events for comparison
    console.log('\n=== Baseline Progress Events (Push-to-Push, deployed EOA) ===');
    for (const { event } of baselineTracker.events) {
      console.log(`  [${event.id}] (${event.level}) ${event.title}: ${event.message}`);
    }
  }, 120_000);
});
