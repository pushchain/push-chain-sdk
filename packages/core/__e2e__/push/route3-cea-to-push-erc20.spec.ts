import '@e2e/shared/setup';
/**
 * Route 3: CEA → Push Chain — ERC20 Bridge-Back Bug Fix Verification
 *
 * Bug: InsufficientBalance (0xf4d678b8) when bridging ERC20 tokens (USDT)
 * from CEA on an external chain back to Push Chain.
 *
 * Root cause: SDK set prc20Token = pUSDT and burnAmount = amount, trying to
 * burn pUSDT from the UEA on Push Chain. UEA never holds pUSDT — the whole
 * point of Route 3 is to bridge tokens FROM the CEA.
 *
 * Fix: Route 3 always uses native PRC-20 (pBNB) with burnAmount = 0
 * (payload-only relay). CEA uses its own pre-existing ERC20 balance.
 *
 * Test 1: prepareTransaction verifies correct PRC-20 token and burnAmount=0
 * Test 2: payload-only e2e baseline (proves Route 3 outbound works)
 * Test 3: full e2e with USDT (runs only if CEA is pre-funded)
 */
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { getCEAAddress } from '../../src/lib/orchestrator/cea-utils';
import { getNativePRC20ForChain } from '../../src/lib/orchestrator/internals/helpers';
import {
  createPublicClient,
  http,
  type Hex,
} from 'viem';
import { ERC20_EVM } from '../../src/lib/constants/abi/erc20.evm';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { createProgressTracker } from '@e2e/shared/progress-tracker';

const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
const skipE2E = !privateKey;

describe('Route 3: CEA → Push Chain ERC20 Bridge', () => {
  // ==========================================================================
  // Test 1: Verify fix — prepareTransaction uses native PRC-20, not pUSDT
  //
  // This is the core fix validation. Before the fix, gatewayRequest.token was
  // pUSDT and gatewayRequest.amount was the bridge amount. After the fix, it
  // should use native PRC-20 (pBNB) with amount=0.
  // ==========================================================================
  it('should prepare Route 3 USDT tx with native PRC-20 (not pUSDT) and burnAmount=0', async () => {
    if (skipE2E) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    const { pushClient } = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey,
      printTraces: true,
    });

    const ueaAddress = pushClient.universal.account;
    console.log(`UEA: ${ueaAddress}`);

    const usdt = PushChain.CONSTANTS.MOVEABLE.TOKEN.BNB_TESTNET.USDT;
    const bridgeAmount = BigInt(10000); // 0.01 USDT (6 decimals)

    // prepareTransaction builds the payload WITHOUT executing
    const prepared = await pushClient.universal.prepareTransaction({
      from: { chain: CHAIN.BNB_TESTNET },
      to: ueaAddress,
      funds: {
        amount: bridgeAmount,
        token: usdt,
      },
    });

    console.log('Prepared Route 3 tx:');
    console.log('  route:', prepared.route);
    console.log('  gatewayRequest.token:', prepared.gatewayRequest?.token);
    console.log('  gatewayRequest.amount:', prepared.gatewayRequest?.amount?.toString());

    // The gateway request must exist for outbound routes
    expect(prepared.gatewayRequest).toBeDefined();

    // FIX VERIFICATION: token should be native PRC-20 for BNB Testnet (pBNB),
    // NOT pUSDT. If this is pUSDT, the old bug is present.
    const expectedNativePrc20 = getNativePRC20ForChain(
      CHAIN.BNB_TESTNET,
      PUSH_NETWORK.TESTNET_DONUT
    );
    const pUsdtAddress = PushChain.utils.tokens.getPRC20Address(usdt);

    console.log('  expected native PRC-20 (pBNB):', expectedNativePrc20);
    console.log('  pUSDT address (should NOT match):', pUsdtAddress);

    expect(prepared.gatewayRequest!.token.toLowerCase()).toBe(
      expectedNativePrc20.toLowerCase()
    );
    expect(prepared.gatewayRequest!.token.toLowerCase()).not.toBe(
      pUsdtAddress.toLowerCase()
    );

    // FIX VERIFICATION: burnAmount must be 0 (payload-only relay)
    // Old code set this to the bridge amount (10000), which caused the
    // InsufficientBalance revert on Push Chain.
    expect(prepared.gatewayRequest!.amount).toBe(BigInt(0));

    console.log('✅ Fix verified: native PRC-20 with burnAmount=0');
  }, 60000);

  // ==========================================================================
  // Test 2: Payload-only Route 3 e2e (no funds) — no regression
  // ==========================================================================
  it('should execute Route 3 payload-only (no funds, no regression)', async () => {
    if (skipE2E) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    const tracker = createProgressTracker();
    const { pushClient } = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey,
      printTraces: true,
      progressHook: tracker.hook,
    });

    const ueaAddress = pushClient.universal.account;

    // Ensure UEA is deployed
    const pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    const ueaCode = await pushPublicClient.getCode({ address: ueaAddress });
    if (ueaCode === undefined) {
      console.log('UEA not deployed — deploying via self-transfer...');
      const deployTx = await pushClient.universal.sendTransaction({
        to: ueaAddress,
        value: BigInt(1),
      });
      await deployTx.wait();
    }

    // Route 3: payload-only (no funds) — should work before and after the fix
    const tx = await pushClient.universal.sendTransaction({
      from: { chain: CHAIN.BNB_TESTNET },
      to: ueaAddress,
    });

    console.log(`Push Chain TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
    expect(receipt.status).toBe(1);
  }, 360000);

  // ==========================================================================
  // Test 3: Full e2e USDT bridge — only runs if CEA is pre-funded
  //
  // Requires manual setup: the CEA on BNB Testnet must already hold USDT.
  // Skips gracefully if balance is insufficient.
  // ==========================================================================
  it('should bridge USDT from pre-funded CEA to Push Chain (conditional)', async () => {
    if (skipE2E) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    const tracker = createProgressTracker();
    const { pushClient } = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey,
      printTraces: true,
      progressHook: tracker.hook,
    });

    const ueaAddress = pushClient.universal.account;
    console.log(`UEA: ${ueaAddress}`);

    const ceaInfo = await getCEAAddress(ueaAddress, CHAIN.BNB_TESTNET);
    console.log(`CEA on BNB_TESTNET: ${ceaInfo.cea}, deployed: ${ceaInfo.isDeployed}`);

    const usdt = PushChain.CONSTANTS.MOVEABLE.TOKEN.BNB_TESTNET.USDT;
    const bridgeAmount = BigInt(10000); // 0.01 USDT (6 decimals)

    // Check CEA USDT balance — skip if insufficient
    const bnbPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0]),
    });
    const ceaUsdtBalance = (await bnbPublicClient.readContract({
      address: usdt.address as `0x${string}`,
      abi: ERC20_EVM,
      functionName: 'balanceOf',
      args: [ceaInfo.cea as `0x${string}`],
    })) as bigint;

    console.log(`CEA USDT balance: ${ceaUsdtBalance.toString()}`);
    if (ceaUsdtBalance < bridgeAmount) {
      console.log(
        `⚠️ Skipping — CEA needs at least ${bridgeAmount} USDT (has ${ceaUsdtBalance}). ` +
        `Fund CEA at ${ceaInfo.cea} on BNB Testnet with USDT to run this test.`
      );
      return;
    }

    // Ensure UEA is deployed
    const pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    const ueaCode = await pushPublicClient.getCode({ address: ueaAddress });
    if (ueaCode === undefined) {
      console.log('UEA not deployed — deploying via self-transfer...');
      const deployTx = await pushClient.universal.sendTransaction({
        to: ueaAddress,
        value: BigInt(1),
      });
      await deployTx.wait();
    }

    // Route 3: bridge USDT from CEA on BNB_TESTNET back to Push Chain
    console.log(`\n=== Route 3: Bridging ${bridgeAmount} USDT from CEA → Push Chain ===`);
    const tx = await pushClient.universal.sendTransaction({
      from: { chain: CHAIN.BNB_TESTNET },
      to: ueaAddress,
      funds: {
        amount: bridgeAmount,
        token: usdt,
      },
    });

    console.log(`Push Chain TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    console.log('Waiting for outbound relay...');
    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
    console.log(`External TX Hash: ${receipt.externalTxHash}`);

    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeDefined();
  }, 360000);
});
