import '@e2e/shared/setup';
/**
 * Debug: Fee-Lock Value Cap Analysis
 *
 * Traces the exact fee-lock → Push Chain deposit → UEA balance flow
 * to identify why large value transfers fail silently.
 *
 * Key findings from code analysis:
 * - SDK lockFee() in gateway-client.ts caps deposit at $1000 USD (maxUsd)
 * - 1 $PC = $0.10 USDC (fixed rate in push-client.ts; Uniswap pool rate differs)
 * - Max deposit ≈ 10000 $PC after the cap (at fixed rate)
 * - If gas_cost + value exceeds the cap, UEA won't have enough balance → ExecutionFailed
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
import { TEST_TARGET_ADDRESS } from '@e2e/shared/constants';

const SEPOLIA_RPC = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];
const PUSH_RPC = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0];

const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
const skipE2E = !privateKey;

// Fixed conversion rate from push-client.ts: 1 $PC (1e18) = $0.10 USDC (1e7 in 8-dec)
const PC_TO_USD_RATE = 0.10;

describe('Debug: Fee-Lock Value Cap', () => {
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
    });
    mainPushClient = setup.pushClient;
    mainWalletClient = setup.walletClient;
  }, 120_000);

  // ==========================================================================
  // Diagnostic: trace the fee-lock → deposit → UEA balance math
  // ==========================================================================
  it('should trace the fee-lock deposit math for various values', async () => {
    if (skipE2E) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    // Fetch gas price from Push Chain directly
    const gasPrice = await pushPublicClient.getGasPrice();
    const gasLimit = BigInt(1e7); // SDK default
    const gasCost = gasLimit * gasPrice;

    console.log('\n=== Fee-Lock Cap Analysis ===');
    console.log(`Gas price:       ${gasPrice} wei`);
    console.log(`Gas limit:       ${gasLimit}`);
    console.log(`Gas cost:        ${gasCost} wei = ${Number(gasCost) / 1e18} $PC`);

    const gasCostUsd = Number(gasCost) / 1e18 * PC_TO_USD_RATE;
    console.log(`Gas cost (USD):  ~$${gasCostUsd.toFixed(4)}`);

    const maxDepositUsd = 1000.0; // $1000 cap from lockFee()
    const maxDepositPc = maxDepositUsd / PC_TO_USD_RATE; // 10000 $PC (at fixed rate)
    const maxValuePcAfterGas = maxDepositPc - (Number(gasCost) / 1e18);

    console.log(`\nMax deposit (cap):       $${maxDepositUsd} USD`);
    console.log(`Max deposit ($PC):       ${maxDepositPc} $PC`);
    console.log(`Max value after gas:     ~${maxValuePcAfterGas.toFixed(4)} $PC`);

    // Test different values Kolade might use
    const testValues = [
      { label: 'nextFee=1', value: BigInt(1) * BigInt(10 ** 18) },
      { label: 'nextFee=10', value: BigInt(10) * BigInt(10 ** 18) },
      { label: 'nextFee=50', value: BigInt(50) * BigInt(10 ** 18) },
      { label: 'nextFee=100', value: BigInt(100) * BigInt(10 ** 18) },
      { label: 'nextFee=500', value: BigInt(500) * BigInt(10 ** 18) },
      { label: 'nextFee=1000', value: BigInt(1000) * BigInt(10 ** 18) },
      { label: '0.001 $PC', value: BigInt(1e15) },
      { label: '1000 wei', value: BigInt(1000) },
    ];

    console.log('\n=== Value vs. Cap Analysis ===');
    console.log(`${'Value'.padEnd(20)} | ${'$PC'.padEnd(12)} | ${'USD needed'.padEnd(14)} | ${'Capped?'.padEnd(10)} | Result`);
    console.log('-'.repeat(85));

    for (const { label, value } of testValues) {
      const requiredPc = Number(gasCost + value) / 1e18;
      const requiredUsd = requiredPc * PC_TO_USD_RATE;
      const capped = requiredUsd > maxDepositUsd;
      const actualDepositPc = capped ? maxDepositPc : requiredPc;
      const shortfallPc = actualDepositPc < requiredPc ? requiredPc - actualDepositPc : 0;

      console.log(
        `${label.padEnd(20)} | ${(Number(value) / 1e18).toFixed(3).padEnd(12)} | ` +
        `$${requiredUsd.toFixed(2).padEnd(13)} | ` +
        `${(capped ? 'YES→$1000' : 'no').padEnd(10)} | ` +
        `${shortfallPc > 0.001 ? `FAIL (short ~${shortfallPc.toFixed(3)} $PC)` : 'OK'}`
      );
    }

    console.log('\n=== Conclusion ===');
    console.log(`SDK lockFee() in gateway-client.ts caps deposit at $1000 USD.`);
    console.log(`At 1 $PC = $0.10 USDC (fixed rate), max ~${maxValuePcAfterGas.toFixed(1)} $PC can be transferred per tx.`);
  }, 30_000);

  // ==========================================================================
  // Live test: send value and verify UEA balance after fee-lock deposit
  // ==========================================================================
  it('should show actual UEA balance deposited by fee-lock', async () => {
    if (skipE2E) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    const tracker = createProgressTracker();

    // Fresh wallet
    const freshKey = generatePrivateKey();
    const freshAccount = privateKeyToAccount(freshKey);
    console.log(`\n=== Live Balance Trace ===`);
    console.log(`Fresh EOA: ${freshAccount.address}`);

    // Fund on Sepolia
    const fundHash = await mainWalletClient.sendTransaction({
      to: freshAccount.address,
      value: BigInt(1e15), // 0.001 ETH
      account: mainWalletClient.account!,
      chain: sepolia,
    });
    await sepoliaPublicClient.waitForTransactionReceipt({ hash: fundHash });

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

    // Send a small value transfer
    const sendValue = BigInt(1000);
    console.log(`\nRequested value: ${sendValue} wei`);

    const tx = await freshPushClient.universal.sendTransaction({
      to: TEST_TARGET_ADDRESS,
      value: sendValue,
    });

    console.log(`TX Hash: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);

    // Check UEA balance AFTER tx — leftover from fee-lock deposit
    const ueaBalanceAfter = await pushPublicClient.getBalance({ address: freshUEA });
    console.log(`\nUEA balance after tx: ${ueaBalanceAfter} wei = ${Number(ueaBalanceAfter) / 1e18} $PC`);
    console.log(`This shows $PC deposited by fee-lock minus gas and value used`);

    expect(receipt.status).toBe(1);
  }, 300_000);
});
