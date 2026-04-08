import '@e2e/shared/setup';
/**
 * Route 2: CEA Outbound Contract Call (BNB Testnet)
 *
 * Executes a counter.increment() call on BNB Testnet via CEA (Chain Executor Account).
 * This tests the UOA → CEA outbound flow with payload-only (no funds transfer).
 */
import { PushChain } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { createPublicClient, http, encodeFunctionData, type Hex } from 'viem';
import { bscTestnet } from 'viem/chains';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { COUNTER_ABI } from '@e2e/shared/outbound-helpers';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import type { ProgressEvent } from '../../src/lib/progress-hook/progress-hook.types';

// BNB Testnet counter from chain-fixtures.ts
const COUNTER_ADDRESS = '0xf4bd8c13da0f5831d7b6dd3275a39f14ec7ddaa6' as `0x${string}`;

describe('Route 2: CEA Outbound Contract Call (BNB Testnet)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;

  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E = !privateKey;

  const publicClient = createPublicClient({
    chain: bscTestnet,
    transport: http(CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0]),
  });

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping E2E tests - EVM_PRIVATE_KEY not set');
      return;
    }

    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey,
      printTraces: true,
      progressHook: (val: ProgressEvent) => {
        console.log(`[init] [${val.id}] ${val.title}: ${val.message ?? ''}`);
      },
    });
    pushClient = setup.pushClient;
    const ueaAddress = pushClient.universal.account;
    console.log(`UEA Address: ${ueaAddress}`);

    // Ensure UEA is deployed before outbound Route 2.
    // When UEA is not deployed, the SDK sets nativeValueForGas=200 UPC
    // (route-handlers.ts:422) assuming fee-locking deposits enough, but it
    // doesn't — causing executeUniversalTx to revert. A simple self-transfer
    // triggers deployment via fee-locking first.
    const pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    const code = await pushPublicClient.getCode({ address: ueaAddress });
    if (code === undefined) {
      console.log('UEA not deployed — sending self-transfer to trigger deployment...');
      const deployTx = await pushClient.universal.sendTransaction({
        to: ueaAddress,
        value: BigInt(1),
      });
      const deployReceipt = await deployTx.wait();
      console.log(`UEA deployed via self-transfer — status: ${deployReceipt.status}`);
    }
  }, 120000);

  it('should increment counter on BNB Testnet via CEA', async () => {
    if (skipE2E) return;

    // Read counter BEFORE
    const counterBefore = (await publicClient.readContract({
      address: COUNTER_ADDRESS,
      abi: COUNTER_ABI,
      functionName: 'count',
    })) as bigint;
    console.log(`Counter BEFORE: ${counterBefore}`);

    // Encode increment() calldata
    const data = encodeFunctionData({
      abi: COUNTER_ABI,
      functionName: 'increment',
    });

    // Route 2: to is { address, chain } — executes on external chain via CEA
    const tx = await pushClient.universal.sendTransaction({
      to: {
        address: COUNTER_ADDRESS,
        chain: CHAIN.BNB_TESTNET,
      },
      data,
    });

    console.log(`Push Chain TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

    // Wait for CEA relay and get external chain receipt
    console.log('Calling tx.wait() - polling for outbound tx hash...');
    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
    console.log(`External TX Hash: ${receipt.externalTxHash}`);
    console.log(`External Chain: ${receipt.externalChain}`);
    console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeDefined();
    expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

    // Verify tx succeeded on BNB Testnet via RPC
    await verifyExternalTransaction(
      receipt.externalTxHash!,
      receipt.externalChain!
    );

    // Wait for RPC propagation
    await new Promise((r) => setTimeout(r, 5000));

    // Read counter AFTER
    const counterAfter = (await publicClient.readContract({
      address: COUNTER_ADDRESS,
      abi: COUNTER_ABI,
      functionName: 'count',
    })) as bigint;
    console.log(`Counter AFTER: ${counterAfter}`);
    expect(counterAfter).toBeGreaterThan(counterBefore);
  }, 360000);
});
