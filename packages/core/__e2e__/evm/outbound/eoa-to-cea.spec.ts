import '@e2e/shared/setup';
/**
 * EOA -> CEA: Outbound Transactions (Route 2) from Push Chain Native EOA
 *
 * Tests for outbound transactions from a Push Chain native account (EOA) to
 * external chains via CEA (Route 2). Uses PUSH_TESTNET_DONUT as the origin chain.
 *
 * Parameterised across all active EVM chains via chain-fixtures.
 *
 * Coverage: R2-P-3 (Payload), R2-F-9 (Funds), R2-PF-10 (Payload + Funds)
 */
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { createWalletClient, http, Hex, parseEther, encodeFunctionData, createPublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getCEAAddress } from '../../../src/lib/orchestrator/cea-utils';
import { TransactionRoute, detectRoute } from '../../../src/lib/orchestrator/route-detector';
import type { UniversalExecuteParams } from '../../../src/lib/orchestrator/orchestrator.types';
import { ERC20_EVM } from '../../../src/lib/constants/abi/erc20.evm';
import type { MoveableToken } from '../../../src/lib/constants/tokens';
import { buildErc20WithdrawalMulticall } from '../../../src/lib/orchestrator/payload-builders';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import { getToken } from '@e2e/shared/constants';
import { getActiveFixtures, type ChainTestFixture } from '@e2e/shared/chain-fixtures';
import {
  TEST_TARGET,
  NATIVE_ADDRESS,
  COUNTER_ABI,
} from '@e2e/shared/outbound-helpers';

const fixtures = getActiveFixtures();

describe('EOA -> CEA: Outbound from Push Chain Native Account (Route 2)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let eoaAddress: `0x${string}`;

  // Uses PUSH_PRIVATE_KEY — a native Push Chain account (not derived from external chain)
  const privateKey = process.env['PUSH_PRIVATE_KEY'] as Hex;
  const skipE2E = !privateKey;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping E2E tests - PUSH_PRIVATE_KEY not set');
      return;
    }

    // Key difference: origin is PUSH_TESTNET_DONUT (native Push Chain EOA)
    const originChain = CHAIN.PUSH_TESTNET_DONUT;
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient,
      {
        chain: originChain,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );

    pushClient = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      printTraces: true,
      progressHook: (val: any) => {
        console.log(`[${val.id}] ${val.title}`);
      },
    });

    eoaAddress = pushClient.universal.account;
    console.log(`Push EOA Address: ${eoaAddress}`);
  }, 60000);

  // ============================================================================
  // Core Scenarios — parameterised across EVM chains
  // ============================================================================
  describe.each(fixtures)('Core Scenarios [$label]', (fixture: ChainTestFixture) => {
    let ceaAddress: `0x${string}`;
    let usdtToken: MoveableToken | undefined;
    let publicClient: ReturnType<typeof createPublicClient>;

    beforeAll(async () => {
      if (skipE2E) return;

      // Get CEA address for this chain
      const ceaResult = await getCEAAddress(eoaAddress, fixture.chain);
      ceaAddress = ceaResult.cea;
      console.log(`CEA Address on ${fixture.label}: ${ceaAddress}, deployed: ${ceaResult.isDeployed}`);

      // Get USDT token for ERC20 flows
      try {
        usdtToken = getToken(fixture.chain, 'USDT');
        console.log(`USDT Token (${fixture.label}): ${usdtToken.address} (${usdtToken.decimals} decimals)`);
      } catch {
        console.log(`USDT token not found for ${fixture.label}`);
      }

      publicClient = createPublicClient({
        transport: http(CHAIN_INFO[fixture.chain].defaultRPC[0]),
      });
    }, 60000);

    // ============================================================================
    // 1. Funds — ERC-20 funds outbound
    // ============================================================================
    describe('1. Funds', () => {
      it('should transfer ERC-20 USDT from Push EOA', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log(`\n=== Test: EOA ERC-20 USDT Transfer (R2-F-ERC20) [${fixture.label}] ===`);

        const withdrawAmount = BigInt(10000); // 0.01 USDT (6 decimals)

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_TARGET,
            chain: fixture.chain,
          },
          funds: {
            amount: withdrawAmount,
            token: usdtToken,
          },
          data: buildErc20WithdrawalMulticall(
            usdtToken.address as `0x${string}`,
            TEST_TARGET,
            withdrawAmount
          ),
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(fixture.chain);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);
    });

    // ============================================================================
    // 2. Payload (Data) — single payload outbound
    // ============================================================================
    describe('2. Payload (Data)', () => {
      it('should increment counter from Push EOA', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: EOA Counter Increment (R2-P-3) [${fixture.label}] ===`);

        // Read counter BEFORE
        const counterBefore = await publicClient.readContract({
          address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterBefore}`);

        const payload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          to: {
            address: fixture.contracts.counter,
            chain: fixture.chain,
          },
          data: payload,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(fixture.chain);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await publicClient.readContract({
          address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 360000);
    });

    // ============================================================================
    // 3. Multicall — multicall outbound (no funds)
    // ============================================================================
    describe('3. Multicall', () => {
      it('should increment counter twice via multicall from Push EOA', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: EOA Multicall — Double Increment (R2-MC) [${fixture.label}] ===`);

        // Read counter BEFORE
        const counterBefore = await publicClient.readContract({
          address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`Counter BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: fixture.chain,
          },
          data: [
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementPayload },
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementPayload },
          ],
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(fixture.chain);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER — should have incremented by 2
        const counterAfter = await publicClient.readContract({
          address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThanOrEqual(counterBefore + BigInt(2));
      }, 360000);
    });

    // ============================================================================
    // 4. Funds + Payload — ERC-20 funds + single payload outbound
    // ============================================================================
    describe('4. Funds + Payload', () => {
      it('should transfer ERC-20 USDT and increment counter from Push EOA', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log(`\n=== Test: EOA ERC-20 USDT + Counter Increment (R2-FP) [${fixture.label}] ===`);

        // Read counter BEFORE
        const counterBefore = await publicClient.readContract({
          address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterBefore}`);

        const withdrawAmount = BigInt(10000); // 0.01 USDT (6 decimals)

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          to: {
            address: fixture.contracts.counter,
            chain: fixture.chain,
          },
          funds: {
            amount: withdrawAmount,
            token: usdtToken,
          },
          data: incrementPayload,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(fixture.chain);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await publicClient.readContract({
          address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 360000);
    });

    // ============================================================================
    // 5. Funds + Multicall — ERC-20 funds + multicall outbound
    // ============================================================================
    describe('5. Funds + Multicall', () => {
      it('should transfer ERC-20 USDT and increment counter from Push EOA', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log(`\n=== Test: EOA ERC-20 USDT + Counter Increment (R2-FP-ERC20) [${fixture.label}] ===`);

        // Read counter BEFORE
        const counterBefore = await publicClient.readContract({
          address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterBefore}`);

        const withdrawAmount = BigInt(10000); // 0.01 USDT (6 decimals)

        const erc20TransferPayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'transfer',
          args: [TEST_TARGET, withdrawAmount],
        });

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: fixture.chain,
          },
          funds: {
            amount: withdrawAmount,
            token: usdtToken,
          },
          data: [
            { to: usdtToken.address as `0x${string}`, value: BigInt(0), data: erc20TransferPayload },
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementPayload },
          ],
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(fixture.chain);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await publicClient.readContract({
          address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 360000);
    });

    // ============================================================================
    // 6. Native Funds — native outbound
    // ============================================================================
    describe('6. Native Funds', () => {
      it('should transfer native token from Push EOA', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: EOA Native Transfer (R2-F-9) [${fixture.label}] ===`);

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_TARGET,
            chain: fixture.chain,
          },
          value: parseEther('0.0001'),
        };

        // Route detection should work regardless of origin chain
        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        console.log(`Target Chain: ${tx.chain}`);

        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        // Wait for outbound relay and verify external chain details
        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(fixture.chain);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);
    });

    // ============================================================================
    // 7. Native Funds + Payload — native funds + single payload outbound
    // ============================================================================
    describe('7. Native Funds + Payload', () => {
      it('should transfer native token and increment counter from Push EOA', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: EOA Native + Counter Increment (R2-NFP) [${fixture.label}] ===`);

        // Read counter BEFORE (using payable counter that accepts native token)
        const counterBefore = await publicClient.readContract({
          address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterPayable BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          to: {
            address: fixture.contracts.counter,
            chain: fixture.chain,
          },
          value: parseEther('0.0001'),
          data: incrementPayload,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(fixture.chain);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await publicClient.readContract({
          address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterPayable AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 360000);
    });
  });
});
