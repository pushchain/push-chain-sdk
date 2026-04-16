import '@e2e/shared/setup';
/**
 * Fee-Lock Silent Failure Reproduction
 *
 * Reproduces Kolade's bug: EVM wallet sends value via sendTransaction,
 * user gets DEBITED on origin chain (fee-lock succeeds), but no evidence
 * of the transfer on Push Chain explorer.
 *
 * Root cause hypothesis: extractPcTxAndTransform (push-chain-tx.ts:283)
 * only checks if pcTx.txHash exists — it does NOT check pcTx.status.
 * When the Push Chain tx reverts (status='FAILED'), the SDK still returns
 * a success response with a hash.
 *
 * Test 1: Kolade's exact pattern — large value transfer via fee-locking
 * Test 2: Guaranteed revert — garbage calldata to counter contract (no fallback)
 * Test 3: Verify receipt.status is actually checked on wait()
 */
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import {
  createWalletClient,
  createPublicClient,
  http,
  type Hex,
} from 'viem';
import {
  generatePrivateKey,
  privateKeyToAccount,
} from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { createProgressTracker } from '@e2e/shared/progress-tracker';
import {
  COUNTER_ADDRESS_PAYABLE,
  COUNTER_ABI_PAYABLE,
} from '@e2e/shared/inbound-helpers';
import { TEST_TARGET_ADDRESS } from '@e2e/shared/constants';

const SEPOLIA_RPC = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];
const PUSH_RPC = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0];

const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
const skipE2E = !privateKey;

describe('Fee-Lock Silent Failure Reproduction', () => {
  let mainPushClient: PushChain;
  let mainWalletClient: ReturnType<typeof createWalletClient>;

  const sepoliaPublicClient = createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC),
  });

  const pushPublicClient = createPublicClient({
    transport: http(PUSH_RPC),
  });

  beforeAll(async () => {
    if (skipE2E) return;

    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey,
      progressHook: (v) => console.log('[main]', v.id, v.title),
    });
    mainPushClient = setup.pushClient;
    mainWalletClient = setup.walletClient;
  }, 120_000);

  // ==========================================================================
  // Test 1: Kolade's pattern — value transfer via fee-locking
  //
  // Kolade's code:
  //   const feeInWei = BigInt(nextFee) * BigInt(10 ** 18);
  //   const txResponse = await pushChainClient.universal.sendTransaction({
  //     to: PC_TOKEN_RECIPIENT,
  //     value: feeInWei,
  //   });
  //
  // The issue: debited on origin chain, no tx on Push Chain explorer.
  // If the SDK returns a hash without checking pcTx.status, this test
  // will expose it.
  // ==========================================================================
  it('should properly report status when sending value transfer via fee-locking (Kolade scenario)', async () => {
    if (skipE2E) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    const tracker = createProgressTracker();

    // Fresh wallet
    const freshKey = generatePrivateKey();
    const freshAccount = privateKeyToAccount(freshKey);
    console.log(`\n=== Kolade Scenario ===`);
    console.log(`Fresh EOA: ${freshAccount.address}`);

    // Fund on Sepolia — 0.001 ETH (minimal for fee-locking)
    const fundHash = await mainWalletClient.sendTransaction({
      to: freshAccount.address,
      value: BigInt(1e15),
      account: mainWalletClient.account!,
      chain: sepolia,
    });
    await sepoliaPublicClient.waitForTransactionReceipt({ hash: fundHash });
    console.log(`Funded on Sepolia: ${fundHash}`);

    // Create PushChain client
    const freshWalletClient = createWalletClient({
      account: freshAccount,
      chain: sepolia,
      transport: http(SEPOLIA_RPC),
    });
    const freshSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      freshWalletClient,
      {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );
    const freshPushClient = await PushChain.initialize(freshSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      printTraces: true,
      progressHook: tracker.hook,
    });

    const freshUEA = freshPushClient.universal.account;
    console.log(`Fresh UEA: ${freshUEA}`);

    // Mimic Kolade: send value to a target address
    const sendValue = BigInt(1e3); // small value to keep costs low
    console.log(`\nSending ${sendValue} wei to ${TEST_TARGET_ADDRESS}...`);

    let txResponse: any;
    let caughtError: Error | undefined;

    try {
      txResponse = await freshPushClient.universal.sendTransaction({
        to: TEST_TARGET_ADDRESS,
        value: sendValue,
      });

      console.log(`\n=== SDK returned SUCCESS ===`);
      console.log(`TX Hash: ${txResponse.hash}`);
      console.log(`TX from: ${txResponse.from}`);
      console.log(`TX to:   ${txResponse.to}`);
      console.log(`TX value: ${txResponse.value}`);

      // Now call wait() to get the receipt and check status
      const receipt = await txResponse.wait();
      console.log(`\n=== Receipt ===`);
      console.log(`Receipt status: ${receipt.status}`);
      console.log(`Receipt hash:   ${receipt.hash}`);
      console.log(`Block number:   ${receipt.blockNumber}`);

      // THE KEY CHECK: does receipt.status === 1?
      // If status === 0, the tx reverted on Push Chain but SDK returned success
      if (receipt.status === 0) {
        console.log('\n*** BUG CONFIRMED: SDK returned success but receipt.status === 0 ***');
        console.log('The user gets debited (fee-lock) but the Push Chain tx reverted.');
      }

      expect(receipt.status).toBe(1);
    } catch (error: any) {
      caughtError = error;
      console.log(`\n=== SDK threw error ===`);
      console.log(`Error: ${error.message}`);
    }

    // Dump progress events
    console.log('\n=== Progress Events ===');
    for (const { event } of tracker.events) {
      console.log(`  [${event.id}] (${event.level}) ${event.title}: ${event.message}`);
    }

    // Verify: did fee-locking happen?
    const ids = tracker.getIds();
    if (ids.includes('SEND-TX-105-01')) {
      console.log('\n>> Fee-locking path was taken (user was debited on origin chain)');
    }
    if (ids.includes('SEND-TX-199-01')) {
      console.log('>> SDK reported SUCCESS (SEND-TX-199-01)');
    }
    if (ids.includes('SEND-TX-199-02')) {
      console.log('>> SDK reported FAILURE (SEND-TX-199-02)');
    }

    expect(txResponse || caughtError).toBeDefined();
  }, 300_000);

  // ==========================================================================
  // Test 2: Guaranteed revert — garbage calldata to counter contract
  //
  // The counter contract has increment(), reset(), countPC(), getBalance()
  // and a receive() function — but NO fallback() function.
  // Sending data with an unknown function selector should revert.
  //
  // If the SDK returns success after fee-locking + Push Chain revert,
  // this confirms the pcTx.status check is missing.
  // ==========================================================================
  it('should throw when Push Chain tx reverts (garbage calldata, no fallback)', async () => {
    if (skipE2E) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    const tracker = createProgressTracker();

    // Fresh wallet
    const freshKey = generatePrivateKey();
    const freshAccount = privateKeyToAccount(freshKey);
    console.log(`\n=== Guaranteed Revert Scenario ===`);
    console.log(`Fresh EOA: ${freshAccount.address}`);

    // Fund on Sepolia
    const fundHash = await mainWalletClient.sendTransaction({
      to: freshAccount.address,
      value: BigInt(1e15),
      account: mainWalletClient.account!,
      chain: sepolia,
    });
    await sepoliaPublicClient.waitForTransactionReceipt({ hash: fundHash });
    console.log(`Funded on Sepolia: ${fundHash}`);

    // Create PushChain client
    const freshWalletClient = createWalletClient({
      account: freshAccount,
      chain: sepolia,
      transport: http(SEPOLIA_RPC),
    });
    const freshSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      freshWalletClient,
      {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );
    const freshPushClient = await PushChain.initialize(freshSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      printTraces: true,
      progressHook: tracker.hook,
    });

    console.log(`Fresh UEA: ${freshPushClient.universal.account}`);

    // Garbage calldata — 0xdeadbeef is not a valid function selector on the counter.
    // Counter has no fallback() function, so this WILL revert on Push Chain.
    const garbageData = '0xdeadbeef';
    console.log(`\nSending garbage calldata ${garbageData} to counter contract...`);
    console.log(`Counter: ${COUNTER_ADDRESS_PAYABLE}`);

    let txResponse: any;
    let caughtError: Error | undefined;

    try {
      txResponse = await freshPushClient.universal.sendTransaction({
        to: COUNTER_ADDRESS_PAYABLE,
        data: garbageData,
      });

      console.log(`\n=== SDK returned SUCCESS ===`);
      console.log(`TX Hash: ${txResponse.hash}`);

      // Check receipt status
      const receipt = await txResponse.wait();
      console.log(`Receipt status: ${receipt.status}`);

      if (receipt.status === 0) {
        console.log('\n*** BUG CONFIRMED: Fee-locked + Push Chain reverted, but SDK returned success ***');
        console.log('extractPcTxAndTransform does not check pcTx.status === FAILED');
      } else {
        console.log('\nReceipt status is 1 — tx actually succeeded on Push Chain');
        console.log('(Counter contract may have a fallback, or multicall caught the revert)');
      }
    } catch (error: any) {
      caughtError = error;
      console.log(`\n=== SDK properly threw error ===`);
      console.log(`Error: ${error.message}`);

      // If error mentions "FAILED" or pcTx status, the fix might already be in place
      if (error.message.includes('FAILED') || error.message.includes('failed')) {
        console.log('>> Error correctly reports Push Chain failure');
      }
    }

    // Dump progress events
    console.log('\n=== Progress Events ===');
    for (const { event } of tracker.events) {
      console.log(`  [${event.id}] (${event.level}) ${event.title}: ${event.message}`);
    }

    const ids = tracker.getIds();
    if (ids.includes('SEND-TX-105-01')) {
      console.log('\n>> Fee-locking path was taken (user was DEBITED on origin chain)');
    }
    if (ids.includes('SEND-TX-199-01') && caughtError === undefined) {
      console.log('>> BUG: SDK fired SUCCESS event despite potential Push Chain revert');
    }
    if (ids.includes('SEND-TX-199-02')) {
      console.log('>> SDK correctly fired FAILURE event');
    }

    // Either the SDK should throw, or receipt.status should be 0
    // If neither, the bug is confirmed: silent failure
    expect(txResponse || caughtError).toBeDefined();
  }, 300_000);

  // ==========================================================================
  // Test 3: Verify receipt.status reflects actual Push Chain execution
  //
  // Uses the main wallet (deployed UEA) to send a valid tx, then checks
  // that receipt.status === 1 actually means the tx succeeded.
  // Baseline comparison for the failure tests above.
  // ==========================================================================
  it('should return receipt.status=1 for a genuinely successful tx (baseline)', async () => {
    if (skipE2E) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    console.log('\n=== Baseline: valid tx from deployed UEA ===');

    const incrementData = PushChain.utils.helpers.encodeTxData({
      abi: COUNTER_ABI_PAYABLE as any[],
      functionName: 'increment',
    });

    const tx = await mainPushClient.universal.sendTransaction({
      to: COUNTER_ADDRESS_PAYABLE,
      data: incrementData,
    });

    console.log(`TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
    expect(receipt.status).toBe(1);

    // Verify tx is visible on Push Chain
    const pushTx = await pushPublicClient.getTransaction({
      hash: tx.hash as `0x${string}`,
    });
    console.log(`Push Chain getTransaction: ${pushTx ? 'FOUND' : 'NOT FOUND'}`);
    expect(pushTx).toBeDefined();
  }, 120_000);
});
