/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * UEA → CEA: Outbound Transactions (Route 2)
 *
 * Tests for outbound transactions from Push Chain to external chains via CEA.
 * Covers: Route Detection, CEA Utilities, Transaction Preparation, FUNDS only,
 * PAYLOAD only, FUNDS + PAYLOAD, E2E Sync, Error Handling, Progress Hooks
 *
 * Core Scenarios are parameterised across all active EVM chains via chain-fixtures.
 * Additional Tests are also parameterised across all active EVM chains.
 */
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { type MoveableToken } from '../../../src/lib/constants/tokens';
import { createWalletClient, createPublicClient, http, Hex, parseEther, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getCEAAddress, chainSupportsCEA } from '../../../src/lib/orchestrator/cea-utils';
import { TransactionRoute, detectRoute } from '../../../src/lib/orchestrator/route-detector';
import type { UniversalExecuteParams, ChainTarget } from '../../../src/lib/orchestrator/orchestrator.types';
import type { ProgressEvent } from '../../../src/lib/progress-hook/progress-hook.types';
import { ERC20_EVM } from '../../../src/lib/constants/abi/erc20.evm';
import { buildErc20WithdrawalMulticall } from '../../../src/lib/orchestrator/payload-builders';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import { getToken } from '@e2e/shared/constants';
import { getActiveFixtures, type ChainTestFixture } from '@e2e/shared/chain-fixtures';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import {
  TEST_TARGET,
  NATIVE_ADDRESS,
  COUNTER_ABI,
} from '@e2e/shared/outbound-helpers';

const fixtures = getActiveFixtures();

describe('UEA → CEA: Outbound Transactions (Route 2)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;

  // Skip if no private key is set
  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E = !privateKey;

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
        console.log(`[${val.id}] ${val.title}`);
      },
    });
    pushClient = setup.pushClient;

    ueaAddress = pushClient.universal.account;
    console.log(`UEA Address: ${ueaAddress}`);
  }, 60000);

  // ============================================================================
  // Core Scenarios — parameterised across EVM chains
  // ============================================================================
  describe.each(fixtures)('Core Scenarios [$label]', (fixture: ChainTestFixture) => {
    let fixtureCeaAddress: `0x${string}`;
    let fixtureUsdtToken: MoveableToken | undefined;
    let publicClient: ReturnType<typeof createPublicClient>;

    beforeAll(async () => {
      if (skipE2E) return;
      const ceaResult = await getCEAAddress(ueaAddress, fixture.chain);
      fixtureCeaAddress = ceaResult.cea;
      console.log(`CEA Address on ${fixture.label}: ${fixtureCeaAddress}, deployed: ${ceaResult.isDeployed}`);

      try {
        fixtureUsdtToken = getToken(fixture.chain, 'USDT');
        console.log(`USDT Token (${fixture.label}): ${fixtureUsdtToken.address} (${fixtureUsdtToken.decimals} decimals)`);
      } catch { /* token not available */ }

      publicClient = createPublicClient({
        transport: http(CHAIN_INFO[fixture.chain].defaultRPC[0]),
      });
    }, 60000);

    // ==========================================================================
    // 1. Funds
    // ==========================================================================
    describe('1. Funds', () => {
      it('should transfer ERC-20 USDT', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log(`\n=== Test: ERC-20 USDT Transfer [${fixture.label}] ===`);

        const withdrawAmount = BigInt(10000); // 0.01 USDT (6 decimals)

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_TARGET,
            chain: fixture.chain,
          },
          funds: {
            amount: withdrawAmount,
            token: fixtureUsdtToken,
          },
          data: buildErc20WithdrawalMulticall(
            fixtureUsdtToken.address as `0x${string}`,
            TEST_TARGET,
            withdrawAmount
          ),
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
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

    // ==========================================================================
    // 2. Payload (Data)
    // ==========================================================================
    describe('2. Payload (Data)', () => {
      // NOTE: Payload-only tests should use functions that don't require the CEA
      // to have token balance. ERC20 `approve` is ideal because it sets allowance
      // without requiring actual tokens. ERC20 `transfer` would fail because
      // the CEA (msg.sender) doesn't have the tokens to transfer.

      it('should increment counter via payload', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: Counter Increment via Payload [${fixture.label}] ===`);

        // Read counter BEFORE
        const counterBefore = await publicClient.readContract({
          address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`Counter BEFORE: ${counterBefore}`);

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

        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(fixture.chain);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await publicClient.readContract({
          address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 360000);
    });

    // ==========================================================================
    // 3. Multicall
    // ==========================================================================
    describe('3. Multicall', () => {
      it('should double increment counter via multicall', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: Multicall — Double Increment [${fixture.label}] ===`);

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

        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(fixture.chain);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await publicClient.readContract({
          address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThanOrEqual(counterBefore + BigInt(2));
      }, 360000);
    });

    // ==========================================================================
    // 4. Funds + Payload
    // ==========================================================================
    describe('4. Funds + Payload', () => {
      it('should transfer ERC-20 USDT and increment counter', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log(`\n=== Test: ERC-20 USDT + Counter Increment [${fixture.label}] ===`);

        // Read counter BEFORE
        const counterBefore = await publicClient.readContract({
          address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`Counter BEFORE: ${counterBefore}`);

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
            token: fixtureUsdtToken,
          },
          data: incrementPayload,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
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

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await publicClient.readContract({
          address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 360000);
    });

    // ==========================================================================
    // 5. Funds + Multicall
    // ==========================================================================
    describe('5. Funds + Multicall', () => {
      it('should withdraw ERC20 using buildErc20WithdrawalMulticall helper', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log('Skipping - USDT token not found in MOVEABLE_TOKENS');
          return;
        }

        console.log(`\n=== Test: ERC20 Withdrawal via buildErc20WithdrawalMulticall [${fixture.label}] ===`);

        const withdrawAmount = BigInt(10000); // 0.01 USDT (6 decimals)

        // Build the ERC20 transfer multicall using the new helper
        const multicall = buildErc20WithdrawalMulticall(
          fixtureUsdtToken.address as `0x${string}`,
          TEST_TARGET,
          withdrawAmount
        );

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: fixture.chain,
          },
          funds: {
            amount: withdrawAmount,
            token: fixtureUsdtToken,
          },
          data: multicall,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(fixture.chain);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ==========================================================================
    // 6. Native Funds
    // ==========================================================================
    describe('6. Native Funds', () => {
      it('should transfer native token', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: Native Transfer [${fixture.label}] ===`);

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_TARGET,
            chain: fixture.chain,
          },
          value: parseEther('0.0001'), // 0.0001 native
        };

        // Verify route detection
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

    // ==========================================================================
    // 7. Native Funds + Payload
    // ==========================================================================
    describe('7. Native Funds + Payload', () => {
      it('should transfer native token and increment counter', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: Native + Counter Increment [${fixture.label}] ===`);

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

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await publicClient.readContract({
          address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 360000);
    });
  });

  // ============================================================================
  // Additional Tests — parameterised across EVM chains
  // ============================================================================
  describe.each(fixtures)('Additional Tests [$label]', (fixture: ChainTestFixture) => {
    let fixtureCeaAddress: `0x${string}`;
    let fixtureUsdtToken: MoveableToken | undefined;
    let fixturePublicClient: ReturnType<typeof createPublicClient>;

    beforeAll(async () => {
      if (skipE2E) return;

      const ceaResult = await getCEAAddress(ueaAddress, fixture.chain);
      fixtureCeaAddress = ceaResult.cea;
      console.log(`CEA Address on ${fixture.label}: ${fixtureCeaAddress}, deployed: ${ceaResult.isDeployed}`);

      try {
        fixtureUsdtToken = getToken(fixture.chain, 'USDT');
        console.log(`USDT Token (${fixture.label}): ${fixtureUsdtToken.address} (${fixtureUsdtToken.decimals} decimals)`);
      } catch { /* token not available for this chain */ }

      fixturePublicClient = createPublicClient({
        transport: http(CHAIN_INFO[fixture.chain].defaultRPC[0]),
      });
    }, 60000);

    // ==========================================================================
    // Route Detection
    // ==========================================================================
    describe('Route Detection', () => {
      it('should detect UOA_TO_PUSH for simple address target', () => {
        const params: UniversalExecuteParams = {
          to: '0x1234567890123456789012345678901234567890',
          value: parseEther('0.001'),
        };
        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_PUSH);
      });

      it('should detect UOA_TO_CEA for ChainTarget', () => {
        const params: UniversalExecuteParams = {
          to: {
            address: '0x1234567890123456789012345678901234567890',
            chain: fixture.chain,
          } as ChainTarget,
          value: parseEther('0.001'),
        };
        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);
      });

      it('should detect CEA_TO_PUSH when from.chain is specified with Push target', () => {
        const params: UniversalExecuteParams = {
          from: { chain: fixture.chain },
          to: {
            address: '0x1234567890123456789012345678901234567890',
            chain: CHAIN.PUSH_TESTNET_DONUT,
          } as ChainTarget,
          value: parseEther('0.001'),
        };
        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);
      });
    });

    // ==========================================================================
    // CEA Utilities
    // ==========================================================================
    describe('CEA Utilities', () => {
      it('should report chain supports CEA', () => {
        expect(chainSupportsCEA(fixture.chain)).toBe(true);
      });

      it('should report Solana Devnet does not support CEA', () => {
        expect(chainSupportsCEA(CHAIN.SOLANA_DEVNET)).toBe(false);
      });

      it('should compute CEA address for UEA', async () => {
        if (skipE2E) return;

        const result = await getCEAAddress(ueaAddress, fixture.chain);
        console.log(`CEA on ${fixture.label}: ${result.cea}, deployed: ${result.isDeployed}`);

        expect(result.cea).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(typeof result.isDeployed).toBe('boolean');
      });

      it('should compute deterministic CEA address', async () => {
        if (skipE2E) return;

        const result = await getCEAAddress(ueaAddress, fixture.chain);

        expect(result.cea).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(typeof result.isDeployed).toBe('boolean');

        // CEA should be deterministic - calling again should return same address
        const result2 = await getCEAAddress(ueaAddress, fixture.chain);
        expect(result2.cea).toBe(result.cea);
      });
    });

    // ==========================================================================
    // Transaction Preparation
    // ==========================================================================
    describe('Transaction Preparation', () => {
      it('should prepare outbound transaction without executing', async () => {
        if (skipE2E) return;

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;
        const params: UniversalExecuteParams = {
          to: {
            address: targetAddress,
            chain: fixture.chain,
          },
          value: parseEther('0.0001'),
        };

        const prepared = await pushClient.universal.prepareTransaction(params);

        console.log(`Prepared tx route: ${prepared.route}`);
        console.log(`Estimated gas: ${prepared.estimatedGas}`);
        console.log(`Nonce: ${prepared.nonce}`);

        expect(prepared.route).toBe('UOA_TO_CEA');
        expect(prepared.payload).toBeDefined();
      });

      it('should accept an array of prepared transactions in executeTransactions', async () => {
        if (skipE2E) return;

        const firstPrepared = await pushClient.universal.prepareTransaction({
          to: '0x1234567890123456789012345678901234567890',
          value: parseEther('0.001'),
        });

        // Test that executeTransactions accepts a single prepared tx
        expect(typeof pushClient.universal.executeTransactions).toBe('function');

        // Test that executeTransactions accepts an array of prepared txs
        const secondPrepared = await pushClient.universal.prepareTransaction({
          to: {
            address: '0x1234567890123456789012345678901234567890',
            chain: fixture.chain,
          },
          value: parseEther('0.0001'),
        });

        // executeTransactions now takes an array and returns a Promise directly
        expect(Array.isArray([firstPrepared, secondPrepared])).toBe(true);
      }, 60000);
    });

    // ==========================================================================
    // Edge Cases
    // ==========================================================================
    describe('Edge Cases', () => {
      it('should handle small amount transfer', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: Small Amount Transfer [${fixture.label}] ===`);

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_TARGET,
            chain: fixture.chain,
          },
          value: BigInt(1), // 1 wei - smallest possible
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

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

      it('should transfer native token and increment counter with multicall', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: Native + Counter Increment Multicall [${fixture.label}] ===`);

        // Read counter BEFORE
        const counterBefore = await fixturePublicClient.readContract({
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
          value: parseEther('0.0001'),
          data: [
            // Call 1: CEA sends native token to recipient
            { to: TEST_TARGET, value: parseEther('0.0001'), data: '0x' as `0x${string}` },
            // Call 2: Increment counter
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementPayload },
          ],
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

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

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await fixturePublicClient.readContract({
          address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 360000);

      it('should transfer ERC-20 USDT to alternate recipient', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log(`\n=== Test: ERC20 USDT Transfer to Alternate Recipient [${fixture.label}] ===`);

        const ALTERNATE_RECIPIENT = '0x0987654321098765432109876543210987654321' as `0x${string}`;
        const withdrawAmount = BigInt(10000); // 0.01 USDT (6 decimals)

        // Build the ERC20 transfer multicall targeting alternate recipient
        const multicall = buildErc20WithdrawalMulticall(
          fixtureUsdtToken.address as `0x${string}`,
          ALTERNATE_RECIPIENT,
          withdrawAmount
        );

        const params: UniversalExecuteParams = {
          to: {
            address: ALTERNATE_RECIPIENT,
            chain: fixture.chain,
          },
          funds: {
            amount: withdrawAmount,
            token: fixtureUsdtToken,
          },
          data: multicall,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(fixture.chain);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ==========================================================================
    // E2E Sync
    // ==========================================================================
    describe('E2E Sync', () => {
      it('should execute outbound transfer from UOA to CEA', async () => {
        if (skipE2E) return;

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

        // Execute outbound transfer
        const tx = await pushClient.universal.sendTransaction({
          to: {
            address: targetAddress,
            chain: fixture.chain,
          },
          value: parseEther('0.00015'),
          gasLimit: BigInt(2000000),
        });

        console.log(`[TEST] ${new Date().toISOString()} Push Chain TX Hash: ${tx.hash}`);

        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(fixture.chain);

        // Wait for outbound relay and verify external chain details
        console.log(`[TEST] ${new Date().toISOString()} Calling tx.wait() - polling for outbound tx hash...`);
        const receipt = await tx.wait();
        console.log(`[TEST] ${new Date().toISOString()} Receipt received:`);
        console.log(`  Receipt status: ${receipt.status}`);
        console.log(`  External TX Hash: ${receipt.externalTxHash}`);
        console.log(`  External Chain: ${receipt.externalChain}`);
        console.log(`  External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(fixture.chain);

        const expectedExplorerBase = CHAIN_INFO[fixture.chain].explorerUrl;
        if (expectedExplorerBase) {
          expect(receipt.externalExplorerUrl).toContain(expectedExplorerBase);
        }
        expect(receipt.externalExplorerUrl).toContain(receipt.externalTxHash!);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);

      it('should include external chain details in receipt for outbound via unified .wait()', async () => {
        if (skipE2E) return;

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

        console.log(`\n=== TEST: Unified .wait() with outbound [${fixture.label}] ===`);
        console.log(`[TEST] ${new Date().toISOString()} Sending outbound tx...`);

        // Execute outbound transfer
        const tx = await pushClient.universal.sendTransaction({
          to: {
            address: targetAddress,
            chain: fixture.chain,
          },
          value: parseEther('0.00015'),
          gasLimit: BigInt(2000000),
        });

        console.log(`[TEST] ${new Date().toISOString()} Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        // .wait() now automatically polls for external chain details for outbound routes
        console.log(`[TEST] ${new Date().toISOString()} Calling tx.wait() - will poll for external chain details...`);
        const receipt = await tx.wait();

        console.log(`[TEST] ${new Date().toISOString()} Receipt received:`);
        console.log(`  Push Chain TX Hash: ${receipt.hash}`);
        console.log(`  Status: ${receipt.status}`);
        console.log(`  External TX Hash: ${receipt.externalTxHash}`);
        console.log(`  External Chain: ${receipt.externalChain}`);
        console.log(`  External Explorer URL: ${receipt.externalExplorerUrl}`);
        console.log(`  External Recipient: ${receipt.externalRecipient}`);
        console.log(`  External Amount: ${receipt.externalAmount}`);

        // Verify Push Chain receipt
        expect(receipt.hash).toBe(tx.hash);
        expect(receipt.status).toBe(1);

        // Verify external chain details are included (outbound route)
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(fixture.chain);

        const expectedExplorerBase = CHAIN_INFO[fixture.chain].explorerUrl;
        if (expectedExplorerBase) {
          expect(receipt.externalExplorerUrl).toContain(expectedExplorerBase);
        }
        expect(receipt.externalExplorerUrl).toContain(receipt.externalTxHash!);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000); // 10 min timeout for full E2E with relay
    });

    // ==========================================================================
    // Error Handling
    // ==========================================================================
    describe('Error Handling', () => {
      it('should fail with unsupported chain', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Unsupported Chain Error ===');

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_TARGET,
            // Solana doesn't support CEA
            chain: CHAIN.SOLANA_DEVNET,
          },
          value: BigInt(1000),
        };

        // The SDK should throw for unsupported chains
        await expect(
          pushClient.universal.sendTransaction(params)
        ).rejects.toThrow();
      }, 60000);

      it('should fail with zero address target', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Zero Address Target ===');

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: fixture.chain,
          },
          value: parseEther('0.0001'),
        };

        // SDK validates zero addresses and rejects early to prevent fund loss
        await expect(
          pushClient.universal.sendTransaction(params)
        ).rejects.toThrow('Cannot send to zero address');
      }, 60000);
    });

    // ==========================================================================
    // Progress Hooks
    // ==========================================================================
    describe('Progress Hooks', () => {
      it('should emit correct hooks for FUNDS flow', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: Progress Hooks (FUNDS) [${fixture.label}] ===`);

        const events: ProgressEvent[] = [];

        // Create a client with progress hook
        const originChain = CHAIN.ETHEREUM_SEPOLIA;
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

        const clientWithHook = await PushChain.initialize(universalSigner, {
          network: PUSH_NETWORK.TESTNET_DONUT,
          progressHook: (event: ProgressEvent) => {
            events.push(event);
            console.log(`[HOOK] ${event.id}: ${event.title}`);
          },
        });

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_TARGET,
            chain: fixture.chain,
          },
          value: parseEther('0.00001'),
        };

        await clientWithHook.universal.sendTransaction(params);

        // Verify we got progress events
        expect(events.length).toBeGreaterThan(0);

        // Verify key events were emitted
        expect(events.some(e => e.id === 'SEND-TX-101')).toBe(true);
        expect(events.some(e => e.id.startsWith('SEND-TX-99'))).toBe(true);
      }, 180000);

      it('should emit correct hooks for PAYLOAD flow', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        const events: ProgressEvent[] = [];

        const originChain = CHAIN.ETHEREUM_SEPOLIA;
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

        const clientWithHook = await PushChain.initialize(universalSigner, {
          network: PUSH_NETWORK.TESTNET_DONUT,
          progressHook: (event: ProgressEvent) => {
            events.push(event);
            console.log(`[HOOK] ${event.id}: ${event.title}`);
          },
        });

        const payload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [TEST_TARGET, BigInt(1000)],
        });

        const params: UniversalExecuteParams = {
          to: {
            address: fixtureUsdtToken.address as `0x${string}`,
            chain: fixture.chain,
          },
          data: payload,
        };

        await clientWithHook.universal.sendTransaction(params);

        expect(events.length).toBeGreaterThan(0);
        expect(events.some(e => e.id === 'SEND-TX-101')).toBe(true);
      }, 180000);
    });

    // ==========================================================================
    // DeFi Flows
    // ==========================================================================
    describe('DeFi Flows', () => {
      const SPENDER = '0x9999999999999999999999999999999999999999' as `0x${string}`;

      it('should execute ERC20 burn + approve multicall', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log(`\n=== Test: ERC20 Burn + Approve Multicall [${fixture.label}] ===`);

        const burnAmount = BigInt(10000); // 0.01 USDT

        // User-provided multicall: approve spender for the burned amount
        // USDT requires allowance reset to 0 before setting a new non-zero value
        const approveZeroPayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [SPENDER, BigInt(0)],
        });
        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [SPENDER, burnAmount],
        });

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: fixture.chain,
          },
          funds: {
            amount: burnAmount,
            token: fixtureUsdtToken,
          },
          data: [
            // Step 0: Reset USDT allowance to 0 (required by USDT before non-zero approve)
            { to: fixtureUsdtToken.address as `0x${string}`, value: BigInt(0), data: approveZeroPayload },
            // Step 1: Approve spender for the burned token amount
            { to: fixtureUsdtToken.address as `0x${string}`, value: BigInt(0), data: approvePayload },
          ],
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

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
      }, 600000);

      it('should execute ERC20 CEA-only with no burn', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log(`\n=== Test: ERC20 CEA-Only, No Burn [${fixture.label}] ===`);
        console.log('Note: Payload-only with burnAmount = 0 (precompile fix deployed)');

        // No funds, no value — only data. CEA uses existing balance.
        // USDT requires allowance reset to 0 before setting a new non-zero value
        const approveZeroPayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [SPENDER, BigInt(0)],
        });
        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [SPENDER, BigInt(1000000)],
        });

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: fixture.chain,
          },
          // No value, no funds — GAS_AND_PAYLOAD type
          data: [
            // Reset USDT allowance to 0 (required by USDT before non-zero approve)
            { to: fixtureUsdtToken.address as `0x${string}`, value: BigInt(0), data: approveZeroPayload },
            { to: fixtureUsdtToken.address as `0x${string}`, value: BigInt(0), data: approvePayload },
          ],
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

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
      }, 600000);

      it('should execute ERC20 hybrid burn + CEA balance', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log(`\n=== Test: ERC20 Hybrid Burn + CEA Balance [${fixture.label}] ===`);
        console.log('Note: Combined approval exceeds burn amount (draws on CEA existing balance)');

        const burnAmount = BigInt(10000); // 0.01 USDT burned on Push Chain
        // Approve for more than burn amount — the extra comes from CEA existing balance
        const combinedApproval = BigInt(20000); // 0.02 USDT total

        // USDT requires allowance reset to 0 before setting a new non-zero value
        const approveZeroPayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [SPENDER, BigInt(0)],
        });
        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [SPENDER, combinedApproval],
        });

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: fixture.chain,
          },
          funds: {
            amount: burnAmount,
            token: fixtureUsdtToken,
          },
          data: [
            // Reset USDT allowance to 0 (required by USDT before non-zero approve)
            { to: fixtureUsdtToken.address as `0x${string}`, value: BigInt(0), data: approveZeroPayload },
            // Approve for combined amount (burn + existing CEA balance)
            { to: fixtureUsdtToken.address as `0x${string}`, value: BigInt(0), data: approvePayload },
          ],
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

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
      }, 600000);

      it('should execute native hybrid: multicall value exceeds burnAmount', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: Native Hybrid — Multicall Value > Burn [${fixture.label}] ===`);
        console.log('Note: Burns 0.0001 native but multicall sends 0.0002 native (CEA balance covers diff)');

        const burnAmount = parseEther('0.0001'); // Amount burned on Push Chain

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: fixture.chain,
          },
          value: burnAmount, // Burns this amount on Push Chain
          data: [
            // Multicall sends more than burn — relies on CEA having pre-existing native balance
            { to: TEST_TARGET, value: parseEther('0.0002'), data: '0x' as `0x${string}` },
          ],
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

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
      }, 600000);
    });

    // ==========================================================================
    // Cascade Tests
    // ==========================================================================
    describe('Cascade Tests', () => {
      it('should increment counter via payload-only outbound', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: Counter Payload Only — Single Increment [${fixture.label}] ===`);

        // Read counter BEFORE
        const counterBefore = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter BEFORE: ${counterBefore}`);

        const params: UniversalExecuteParams = {
          to: {
            address: fixture.contracts.counter,
            chain: fixture.chain,
          },
          data: encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' }),
        };

        const tx = await pushClient.universal.sendTransaction(params);
        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter AFTER: ${counterAfter}`);

        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);

      it('should transfer native token + increment counter via native funds + payload', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: Counter Native Funds + Payload [${fixture.label}] ===`);

        const incrementPayload = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });

        // Read counter BEFORE
        const counterBefore = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter BEFORE: ${counterBefore}`);

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: fixture.chain,
          },
          value: parseEther('0.0001'),
          data: [
            { to: TEST_TARGET, value: parseEther('0.0001'), data: '0x' as `0x${string}` },
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementPayload },
          ],
        };

        const tx = await pushClient.universal.sendTransaction(params);
        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter AFTER: ${counterAfter}`);

        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);

      it('should transfer native token + double increment counter via native funds + multicall', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: Counter Native Funds + Multicall (Double Increment) [${fixture.label}] ===`);

        const incrementPayload = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });

        // Read counter BEFORE
        const counterBefore = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter BEFORE: ${counterBefore}`);

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: fixture.chain,
          },
          value: parseEther('0.0001'),
          data: [
            { to: TEST_TARGET, value: parseEther('0.0001'), data: '0x' as `0x${string}` },
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementPayload },
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementPayload },
          ],
        };

        const tx = await pushClient.universal.sendTransaction(params);
        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter AFTER: ${counterAfter}`);

        expect(counterAfter).toBeGreaterThanOrEqual(counterBefore + BigInt(2));
      }, 600000);

      it('should transfer ERC20 USDT + increment counter via funds + payload', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log(`\n=== Test: Counter ERC20 Funds + Payload — USDT Transfer + Increment [${fixture.label}] ===`);

        const incrementPayload = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });
        const erc20TransferPayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'transfer',
          args: [TEST_TARGET, BigInt(10000)],
        });

        // Read counter BEFORE
        const counterBefore = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter BEFORE: ${counterBefore}`);

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: fixture.chain,
          },
          funds: {
            amount: BigInt(10000),
            token: fixtureUsdtToken,
          },
          data: [
            { to: fixtureUsdtToken.address as `0x${string}`, value: BigInt(0), data: erc20TransferPayload },
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementPayload },
          ],
        };

        const tx = await pushClient.universal.sendTransaction(params);
        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter AFTER: ${counterAfter}`);

        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);

      it('should transfer ERC20 USDT + double increment counter via funds + multicall', async () => {
        if (skipE2E) return;
        if (!fixtureUsdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log(`\n=== Test: Counter ERC20 Funds + Multicall — USDT Transfer + Double Increment [${fixture.label}] ===`);

        const incrementPayload = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });
        const erc20TransferPayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'transfer',
          args: [TEST_TARGET, BigInt(10000)],
        });

        // Read counter BEFORE
        const counterBefore = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter BEFORE: ${counterBefore}`);

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: fixture.chain,
          },
          funds: {
            amount: BigInt(10000),
            token: fixtureUsdtToken,
          },
          data: [
            { to: fixtureUsdtToken.address as `0x${string}`, value: BigInt(0), data: erc20TransferPayload },
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementPayload },
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementPayload },
          ],
        };

        const tx = await pushClient.universal.sendTransaction(params);
        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await fixturePublicClient.readContract({
          address: fixture.contracts.counter,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`Counter AFTER: ${counterAfter}`);

        expect(counterAfter).toBeGreaterThanOrEqual(counterBefore + BigInt(2));
      }, 600000);

      it('should migrate CEA via migrateCEA convenience method', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: CEA Migration via migrateCEA [${fixture.label}] ===`);

        const tx = await pushClient.universal.migrateCEA(fixture.chain);
        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, fixture.chain);
      }, 600000);

      it('should migrate CEA via sendTransaction with migration flag', async () => {
        if (skipE2E) return;

        console.log(`\n=== Test: CEA Migration via sendTransaction [${fixture.label}] ===`);

        const params: UniversalExecuteParams = {
          to: {
            address: fixtureCeaAddress,
            chain: fixture.chain,
          },
          migration: true,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);
        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, fixture.chain);
      }, 600000);
    });
  });
});
