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
import { CHAIN_INFO, SYNTHETIC_PUSH_ERC20 } from '../../../src/lib/constants/chain';
import { type MoveableToken } from '../../../src/lib/constants/tokens';
import {
  createWalletClient,
  createPublicClient,
  http,
  Hex,
  parseEther,
  parseUnits,
  formatEther,
  formatUnits,
  encodeFunctionData,
  defineChain,
  type WalletClient,
  type PublicClient,
} from 'viem';
import { sepolia } from 'viem/chains';
import { createProgressTracker } from '@e2e/shared/progress-tracker';
import { formatPc } from '../../../src/lib/formatters';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
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
  ensureCeaNativeBalance,
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

        // Route 2 (UEA→CEA) pre-broadcast hooks (fire during sendTransaction).
        // Post-broadcast hooks (209-xx / 299-xx) require tx.wait() which this test intentionally does not call.
        expect(events.some(e => e.id === 'SEND-TX-201')).toBe(true);
        expect(events.some(e => e.id === 'SEND-TX-203-02')).toBe(true);
        expect(events.some(e => e.id === 'SEND-TX-204-03')).toBe(true);
        expect(events.some(e => e.id === 'SEND-TX-207')).toBe(true);
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
        // Route 2 pre-broadcast hooks (sendTransaction only; 209/299 need tx.wait()).
        expect(events.some(e => e.id === 'SEND-TX-201')).toBe(true);
        expect(events.some(e => e.id === 'SEND-TX-207')).toBe(true);
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
        const multicallNativeValue = parseEther('0.0002');

        await ensureCeaNativeBalance({
          pushClient,
          ceaAddress: fixtureCeaAddress,
          requiredAmount: multicallNativeValue,
          targetChain: fixture.chain,
        });

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: fixture.chain,
          },
          value: burnAmount, // Burns this amount on Push Chain
          data: [
            // Multicall sends more than burn — relies on CEA having pre-existing native balance
            { to: TEST_TARGET, value: multicallNativeValue, data: '0x' as `0x${string}` },
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

// ============================================================================
// Route 2 outbound timeout (299-03)
// Verifies the full 299-03 path: a real R2 FUNDS tx is sent, then
// `tx.wait({ outboundTimeoutMs })` forces the outbound-polling loop to time
// out before the relay lands.
// ============================================================================
describe('Route 2 outbound timeout (299-03)', () => {
  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skip = !privateKey;

  it('short outboundTimeoutMs triggers 299-03 + externalStatus=timeout', async () => {
    if (skip) {
      console.log('Skipping — EVM_PRIVATE_KEY unset');
      return;
    }

    const events: ProgressEvent[] = [];
    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey,
      progressHook: (e: ProgressEvent) => events.push(e),
    });

    const usdt = getToken(CHAIN.ETHEREUM_SEPOLIA, 'USDT');
    const amount = BigInt(10000); // 0.01 USDT
    const params: UniversalExecuteParams = {
      to: { address: TEST_TARGET, chain: CHAIN.ETHEREUM_SEPOLIA },
      funds: { amount, token: usdt },
      data: buildErc20WithdrawalMulticall(
        usdt.address as `0x${string}`,
        TEST_TARGET,
        amount
      ),
    };
    expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

    const tx = await setup.pushClient.universal.sendTransaction(params);
    console.log(`Push Chain TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const shortTimeoutMs = 3_000;
    const t0 = Date.now();
    const receipt = await tx.wait({ outboundTimeoutMs: shortTimeoutMs });
    const elapsed = Date.now() - t0;
    console.log(`wait() resolved in ${elapsed}ms`);
    console.log(`receipt.externalStatus = ${receipt.externalStatus}`);
    console.log(`receipt.externalError = ${receipt.externalError}`);

    expect(elapsed).toBeLessThan(shortTimeoutMs + 15_000);

    expect(receipt.status).toBe(1);
    expect(receipt.externalStatus).toBe('timeout');
    expect(receipt.externalError).toMatch(/Timeout/i);
    expect(receipt.externalTxHash).toBeUndefined();

    const ids = events.map((e) => e.id);
    console.log(`hook stream: ${ids.join(' → ')}`);
    expect(ids).toContain('SEND-TX-299-03');
    expect(ids).not.toContain('SEND-TX-299-01');
    expect(ids).not.toContain('SEND-TX-299-02');

    const timeoutEvent = events.find((e) => e.id === 'SEND-TX-299-03')!;
    const resp = timeoutEvent.response as { elapsedMs?: number };
    expect(resp.elapsedMs).toBe(shortTimeoutMs);
  }, 120_000);
});

// ============================================================================
// R2 Funds-only → Recipient forwarding
// Regression coverage for the SDK payload bug where funds-only sendTransaction
// produced an empty CEA multicall payload, leaving funds stranded in the CEA.
// ============================================================================
describe('R2 Funds-only → Recipient forwarding (Route 2)', () => {
  const TARGET_CHAIN = CHAIN.ETHEREUM_SEPOLIA;
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;
  let ceaAddress: `0x${string}`;
  let publicClient: ReturnType<typeof createPublicClient>;

  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E = !privateKey;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping E2E tests - EVM_PRIVATE_KEY not set');
      return;
    }

    const setup = await createEvmPushClient({
      chain: TARGET_CHAIN,
      privateKey,
      printTraces: true,
      progressHook: (val: ProgressEvent) => {
        console.log(`[${val.id}] ${val.title}`);
      },
    });
    pushClient = setup.pushClient;
    ueaAddress = pushClient.universal.account;

    const ceaResult = await getCEAAddress(ueaAddress, TARGET_CHAIN);
    ceaAddress = ceaResult.cea;

    publicClient = createPublicClient({
      transport: http(CHAIN_INFO[TARGET_CHAIN].defaultRPC[0]),
    });

    console.log(`UEA: ${ueaAddress}`);
    console.log(`CEA on ${TARGET_CHAIN}: ${ceaAddress} (deployed=${ceaResult.isDeployed})`);
  }, 60_000);

  it('native funds: recipient receives ETH (not CEA)', async () => {
    if (skipE2E) return;

    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const amount = parseEther('0.00005');

    const recipientBefore = await publicClient.getBalance({ address: recipient });
    const ceaBefore = await publicClient.getBalance({ address: ceaAddress });
    console.log(`Recipient ${recipient} balance before: ${recipientBefore}`);
    console.log(`CEA ${ceaAddress} balance before: ${ceaBefore}`);
    expect(recipientBefore).toBe(BigInt(0));

    const pethToken = getToken(TARGET_CHAIN, 'ETH') as MoveableToken;

    const params: UniversalExecuteParams = {
      to: {
        address: recipient,
        chain: TARGET_CHAIN,
      },
      funds: {
        amount,
        token: pethToken,
      },
    };

    expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

    const tx = await pushClient.universal.sendTransaction(params);
    console.log(`Push Chain TX: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log(`Outbound external TX: ${receipt.externalTxHash}`);
    expect(receipt.status).toBe(1);
    expect(receipt.externalChain).toBe(TARGET_CHAIN);
    expect(receipt.externalTxHash).toBeDefined();
    await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

    const recipientAfter = await publicClient.getBalance({ address: recipient });
    const ceaAfter = await publicClient.getBalance({ address: ceaAddress });
    console.log(`Recipient balance after: ${recipientAfter}`);
    console.log(`CEA balance after: ${ceaAfter}`);

    expect(recipientAfter).toBe(amount);
    const ceaDelta = ceaAfter - ceaBefore;
    expect(ceaDelta).toBeLessThan(amount);
  }, 600_000);

  it('ERC-20 funds: recipient receives USDT (not CEA)', async () => {
    if (skipE2E) return;

    let usdtToken: MoveableToken | undefined;
    try {
      usdtToken = getToken(TARGET_CHAIN, 'USDT');
    } catch {
      console.log('Skipping - USDT not configured for this chain');
      return;
    }
    if (!usdtToken) return;

    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const amount = BigInt(10_000);

    const pcPublicClient = createPublicClient({
      transport: http('https://evm.donut.rpc.push.org/'),
    });
    const pUsdtPrc20 = PushChain.utils.tokens.getPRC20Address(usdtToken).address as `0x${string}`;
    const readUeaPusdt = async (): Promise<bigint> =>
      (await pcPublicClient.readContract({
        address: pUsdtPrc20,
        abi: ERC20_EVM,
        functionName: 'balanceOf',
        args: [ueaAddress],
      })) as bigint;

    const ueaPusdtBefore = await readUeaPusdt();
    const prefundTarget = amount * BigInt(5);
    console.log(`UEA pUSDT before prefund: ${ueaPusdtBefore}, target: ${prefundTarget}`);

    if (ueaPusdtBefore < amount) {
      const deficit = prefundTarget - ueaPusdtBefore;
      console.log(`Prefunding UEA with ${deficit} pUSDT via R1 inbound bridge...`);
      const prefundTx = await pushClient.universal.sendTransaction({
        to: ueaAddress,
        funds: {
          amount: deficit,
          token: usdtToken,
        },
      });
      console.log(`Prefund push tx: ${prefundTx.hash}`);
      const prefundReceipt = await prefundTx.wait();
      console.log(`Prefund receipt status: ${prefundReceipt.status}`);
      expect(prefundReceipt.status).toBe(1);

      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const bal = await readUeaPusdt();
        if (bal >= amount) {
          console.log(`UEA pUSDT after prefund: ${bal}`);
          break;
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
      const finalBal = await readUeaPusdt();
      if (finalBal < amount) {
        throw new Error(
          `Prefund did not land in time: UEA pUSDT=${finalBal}, need ${amount}`
        );
      }
    }

    const readUsdt = async (addr: `0x${string}`): Promise<bigint> =>
      (await publicClient.readContract({
        address: usdtToken!.address as `0x${string}`,
        abi: ERC20_EVM,
        functionName: 'balanceOf',
        args: [addr],
      })) as bigint;

    const recipientBefore = await readUsdt(recipient);
    const ceaBefore = await readUsdt(ceaAddress);
    console.log(`Recipient ${recipient} USDT before: ${recipientBefore}`);
    console.log(`CEA ${ceaAddress} USDT before: ${ceaBefore}`);
    expect(recipientBefore).toBe(BigInt(0));

    const params: UniversalExecuteParams = {
      to: {
        address: recipient,
        chain: TARGET_CHAIN,
      },
      funds: {
        amount,
        token: usdtToken,
      },
    };

    expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

    const tx = await pushClient.universal.sendTransaction(params);
    console.log(`Push Chain TX: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log(`Outbound external TX: ${receipt.externalTxHash}`);
    expect(receipt.status).toBe(1);
    expect(receipt.externalChain).toBe(TARGET_CHAIN);
    expect(receipt.externalTxHash).toBeDefined();
    await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

    const recipientAfter = await readUsdt(recipient);
    const ceaAfter = await readUsdt(ceaAddress);
    console.log(`Recipient USDT after: ${recipientAfter}`);
    console.log(`CEA USDT after: ${ceaAfter}`);

    expect(recipientAfter).toBe(amount);
    expect(ceaAfter - ceaBefore).toBeLessThan(amount);
  }, 600_000);
});

// ============================================================================
// Route 2: Fresh Wallet nativeValueForGas Bug
// Reproduces the ExecutionFailed (0xacfdb444) revert that occurs when a fresh
// wallet (UEA not yet deployed) attempts a Route 2 outbound contract call.
// ============================================================================
describe('Route 2: Fresh Wallet nativeValueForGas Bug', () => {
  // BNB Testnet counter from chain-fixtures.ts
  const COUNTER_ADDRESS_R2FW = '0xf4bd8c13da0f5831d7b6dd3275a39f14ec7ddaa6' as `0x${string}`;
  // Counter address used by the dev's external script
  const COUNTER_ADDRESS_DEV = '0x7f0936bb90e7dcf3edb47199c2005e7184e44cf8' as `0x${string}`;
  const SEPOLIA_RPC_R2FW = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];

  const privateKeyR2FW = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E_R2FW = !privateKeyR2FW;
  let mainWalletClientR2FW: WalletClient;
  let publicClientR2FW: PublicClient;

  beforeAll(async () => {
    if (skipE2E_R2FW) return;

    const mainAccount = privateKeyToAccount(privateKeyR2FW);
    mainWalletClientR2FW = createWalletClient({
      account: mainAccount,
      chain: sepolia,
      transport: http(SEPOLIA_RPC_R2FW),
    });
    publicClientR2FW = createPublicClient({
      chain: sepolia,
      transport: http(SEPOLIA_RPC_R2FW),
    });
  }, 30000);

  it('should execute Route 2 contract call from a fresh wallet (uniswap quote prediction)', async () => {
    if (skipE2E_R2FW) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    const freshPrivateKey = generatePrivateKey();
    const freshAccount = privateKeyToAccount(freshPrivateKey);
    console.log(`\n=== Fresh wallet: ${freshAccount.address} ===`);

    const fundTxHash = await mainWalletClientR2FW.sendTransaction({
      to: freshAccount.address,
      value: parseEther('0.005'),
      account: mainWalletClientR2FW.account!,
      chain: sepolia,
    });
    await publicClientR2FW.waitForTransactionReceipt({ hash: fundTxHash });
    console.log(`Funded fresh wallet: ${fundTxHash}`);

    const freshWalletClient = createWalletClient({
      account: freshAccount,
      chain: sepolia,
      transport: http(SEPOLIA_RPC_R2FW),
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

    const ueaAddrR2FW = freshPushClient.universal.account;
    console.log(`Fresh wallet UEA: ${ueaAddrR2FW}`);

    const pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    const ueaCode = await pushPublicClient.getCode({ address: ueaAddrR2FW });
    console.log(`UEA deployed before Route 2: ${ueaCode !== undefined}`);
    expect(ueaCode).toBeUndefined();

    const data = encodeFunctionData({
      abi: COUNTER_ABI,
      functionName: 'increment',
    });

    const tx = await freshPushClient.universal.sendTransaction({
      to: {
        address: COUNTER_ADDRESS_R2FW,
        chain: CHAIN.BNB_TESTNET,
      },
      data,
    });

    console.log(`Push Chain TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    console.log('Waiting for outbound relay...');
    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
    console.log(`External TX Hash: ${receipt.externalTxHash}`);

    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeDefined();
    expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
  }, 360000);

  it('should execute Route 2 contract call from a deployed UEA (baseline)', async () => {
    if (skipE2E_R2FW) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    console.log('\n=== Baseline: deployed UEA ===');

    const tracker = createProgressTracker();
    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey: privateKeyR2FW,
      printTraces: true,
      progressHook: tracker.hook,
    });
    const pushClientR2FW = setup.pushClient;
    const ueaAddrR2FW = pushClientR2FW.universal.account;
    console.log(`Main wallet UEA: ${ueaAddrR2FW}`);

    const pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    const code = await pushPublicClient.getCode({ address: ueaAddrR2FW });
    if (code === undefined) {
      console.log('UEA not deployed — deploying via self-transfer...');
      const deployTx = await pushClientR2FW.universal.sendTransaction({
        to: ueaAddrR2FW,
        value: BigInt(1),
      });
      const deployReceipt = await deployTx.wait();
      console.log(`UEA deployed — status: ${deployReceipt.status}`);
    }

    const data = encodeFunctionData({
      abi: COUNTER_ABI,
      functionName: 'increment',
    });

    const tx = await pushClientR2FW.universal.sendTransaction({
      to: {
        address: COUNTER_ADDRESS_R2FW,
        chain: CHAIN.BNB_TESTNET,
      },
      data,
    });

    console.log(`Push Chain TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    console.log('Waiting for outbound relay...');
    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
    console.log(`External TX Hash: ${receipt.externalTxHash}`);

    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeDefined();
    expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
  }, 360000);

  it('should execute Route 2 contract call from ethers v6 fresh wallet (dev script scenario)', async () => {
    if (skipE2E_R2FW) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    let ethers: typeof import('ethers');
    try {
      ethers = await import('ethers');
    } catch {
      console.log('Skipping — ethers not installed');
      return;
    }

    const wallet = ethers.Wallet.createRandom();
    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_R2FW);
    const signer = wallet.connect(provider);
    console.log(`\n=== Ethers v6 fresh wallet: ${wallet.address} ===`);

    const mainAccount = privateKeyToAccount(privateKeyR2FW);
    const fundTxHash = await mainWalletClientR2FW.sendTransaction({
      to: wallet.address as `0x${string}`,
      value: parseEther('0.005'),
      account: mainAccount,
      chain: sepolia,
    });
    await publicClientR2FW.waitForTransactionReceipt({ hash: fundTxHash });
    console.log(`Funded ethers wallet: ${fundTxHash}`);

    const tracker = createProgressTracker();
    const universalSigner = await PushChain.utils.signer.toUniversal(signer);
    const pushClientR2FW = await PushChain.initialize(universalSigner, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
      printTraces: true,
      progressHook: tracker.hook,
    });

    const ueaAddrR2FW = pushClientR2FW.universal.account;
    console.log(`Ethers fresh wallet UEA: ${ueaAddrR2FW}`);

    const pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    const ueaCode = await pushPublicClient.getCode({ address: ueaAddrR2FW });
    console.log(`UEA deployed before Route 2: ${ueaCode !== undefined}`);
    expect(ueaCode).toBeUndefined();

    const data = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });

    const tx = await pushClientR2FW.universal.sendTransaction({
      to: {
        address: COUNTER_ADDRESS_DEV,
        chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET,
      },
      data,
    });

    console.log(`Push Chain TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    console.log('Waiting for outbound relay...');
    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
    console.log(`External TX Hash: ${receipt.externalTxHash}`);

    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeDefined();
    expect(receipt.externalChain).toBe(PushChain.CONSTANTS.CHAIN.BNB_TESTNET);
  }, 360000);
});

// ============================================================================
// Route 2: Docs Examples (Fresh Wallet)
// Mirrors docs examples — random wallet + prompt-driven funding + exact
// sendTransaction calls.
// ============================================================================
describe('Route 2: Docs Examples (Fresh Wallet)', () => {
  const TARGET_R2DE = '0x1234567890123456789012345678901234567890' as `0x${string}`;
  const COUNTER_BNB_R2DE = '0x7f0936bb90e7dcf3edb47199c2005e7184e44cf8' as `0x${string}`;
  const SEPOLIA_RPC_R2DE = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];
  const PUSH_RPC_R2DE = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0];
  const PUSH_CHAIN_DEF_R2DE = defineChain({
    id: Number(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId),
    name: 'Push Testnet',
    nativeCurrency: { name: 'PC', symbol: 'PC', decimals: 18 },
    rpcUrls: { default: { http: [PUSH_RPC_R2DE] } },
  });

  const synthetics = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT];
  const PETH_ADDRESS = synthetics.pETH as `0x${string}`;
  const PUSDT_BNB_ADDRESS = synthetics.USDT_BNB as `0x${string}`;

  const privateKeyR2DE = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E_R2DE = !privateKeyR2DE;

  let mainPushClient: PushChain;
  let mainAccount: ReturnType<typeof privateKeyToAccount>;
  let mainUeaAddress: `0x${string}`;
  let sepoliaPublicClient: ReturnType<typeof createPublicClient>;
  let pushPublicClient: ReturnType<typeof createPublicClient>;
  let pushEoaWallet: ReturnType<typeof createWalletClient>;

  async function queryBalance(
    client: ReturnType<typeof createPublicClient>,
    token: `0x${string}`,
    owner: `0x${string}`
  ): Promise<bigint> {
    return (await client.readContract({
      address: token, abi: ERC20_EVM, functionName: 'balanceOf', args: [owner],
    })) as bigint;
  }

  async function transferPrc20OnPushChain(
    pushClient: PushChain,
    token: `0x${string}`,
    to: `0x${string}`,
    amount: bigint,
    label: string
  ): Promise<void> {
    const data = encodeFunctionData({
      abi: ERC20_EVM, functionName: 'transfer', args: [to, amount],
    });
    const tx = await pushClient.universal.sendTransaction({ to: token, data });
    const r = await tx.wait();
    console.log(`  [${label}] transfer: ${tx.hash} status=${r.status}`);
  }

  async function createFundedFreshWallet(opts: {
    pEth?: bigint;
    pUsdtBnb?: bigint;
    nativePC?: bigint;
  }): Promise<PushChain> {
    const freshKey = generatePrivateKey();
    const freshAccount = privateKeyToAccount(freshKey);
    console.log(`\n  Fresh wallet: ${freshAccount.address}`);

    const mainWalletClient = createWalletClient({
      account: mainAccount, chain: sepolia, transport: http(SEPOLIA_RPC_R2DE),
    });
    const fundHash = await mainWalletClient.sendTransaction({
      to: freshAccount.address, value: parseEther('0.005'),
    });
    await sepoliaPublicClient.waitForTransactionReceipt({ hash: fundHash });

    const freshWalletClient = createWalletClient({
      account: freshAccount, chain: sepolia, transport: http(SEPOLIA_RPC_R2DE),
    });
    const tracker = createProgressTracker();
    const signer = await PushChain.utils.signer.toUniversalFromKeypair(
      freshWalletClient,
      { chain: CHAIN.ETHEREUM_SEPOLIA, library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM },
    );
    const freshPushClient = await PushChain.initialize(signer, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      printTraces: true,
      progressHook: tracker.hook,
    });
    const freshUea = freshPushClient.universal.account;
    console.log(`  Fresh UEA: ${freshUea}`);

    if (opts.nativePC) {
      const h = await (pushEoaWallet as any).sendTransaction({
        to: freshUea as `0x${string}`, value: opts.nativePC,
      });
      await pushPublicClient.waitForTransactionReceipt({ hash: h });
      console.log(`  Funded ${formatPc(opts.nativePC)}`);
    }
    if (opts.pEth) {
      await transferPrc20OnPushChain(mainPushClient, PETH_ADDRESS, freshUea as `0x${string}`, opts.pEth, 'pETH');
    }
    if (opts.pUsdtBnb) {
      await transferPrc20OnPushChain(mainPushClient, PUSDT_BNB_ADDRESS, freshUea as `0x${string}`, opts.pUsdtBnb, 'pUSDT_BNB');
    }

    return freshPushClient;
  }

  beforeAll(async () => {
    if (skipE2E_R2DE) return;

    mainAccount = privateKeyToAccount(privateKeyR2DE);
    const mainSetup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA, privateKey: privateKeyR2DE, printTraces: true,
    });
    mainPushClient = mainSetup.pushClient;
    mainUeaAddress = mainPushClient.universal.account;

    sepoliaPublicClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC_R2DE) });
    pushPublicClient = createPublicClient({ transport: http(PUSH_RPC_R2DE) });
    pushEoaWallet = createWalletClient({
      account: mainAccount, chain: PUSH_CHAIN_DEF_R2DE, transport: http(PUSH_RPC_R2DE),
    });

    const mainPeth = await queryBalance(pushPublicClient, PETH_ADDRESS, mainUeaAddress);
    console.log(`Main UEA pETH: ${formatEther(mainPeth)}`);
    if (mainPeth < parseEther('0.002')) {
      console.log('Bridging ETH as pETH to main UEA...');
      const bridgeTx = await mainPushClient.universal.sendTransaction({
        to: mainUeaAddress,
        funds: { amount: parseEther('0.005'), token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH },
      });
      await bridgeTx.wait();
      console.log(`Bridged pETH: ${bridgeTx.hash}`);
    }

    const ueaPusdt = await queryBalance(pushPublicClient, PUSDT_BNB_ADDRESS, mainUeaAddress);
    if (ueaPusdt < parseUnits('0.04', 6)) {
      const eoaPusdt = await queryBalance(pushPublicClient, PUSDT_BNB_ADDRESS, mainAccount.address);
      if (eoaPusdt > BigInt(0)) {
        console.log('Moving pUSDT_BNB from EOA to UEA...');
        const data = encodeFunctionData({
          abi: ERC20_EVM, functionName: 'transfer',
          args: [mainUeaAddress, eoaPusdt],
        });
        const h = await (pushEoaWallet as any).sendTransaction({ to: PUSDT_BNB_ADDRESS, data });
        await pushPublicClient.waitForTransactionReceipt({ hash: h });
      }
    }

    const [pc, peth, pusdt] = await Promise.all([
      pushPublicClient.getBalance({ address: mainUeaAddress }),
      queryBalance(pushPublicClient, PETH_ADDRESS, mainUeaAddress),
      queryBalance(pushPublicClient, PUSDT_BNB_ADDRESS, mainUeaAddress),
    ]);
    console.log(`\nMain UEA ready: ${formatPc(pc)} | ${formatEther(peth)} pETH | ${formatUnits(pusdt, 6)} pUSDT_BNB`);
  }, 300000);

  it('#2 Native Value: burn pETH → ETH to Sepolia', async () => {
    if (skipE2E_R2DE) return;
    console.log('\n=== #2 Native Value Transfer ===');

    const client = await createFundedFreshWallet({
      pEth: parseEther('0.001'),
      nativePC: parseEther('5'),
    });

    const tx = await client.universal.sendTransaction({
      to: { address: TARGET_R2DE, chain: CHAIN.ETHEREUM_SEPOLIA },
      value: PushChain.utils.helpers.parseUnits('0.0005', 18),
    });
    console.log(`TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Status: ${receipt.status} | External TX: ${receipt.externalTxHash} | Chain: ${receipt.externalChain}`);

    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeDefined();
    expect(receipt.externalChain).toBe(CHAIN.ETHEREUM_SEPOLIA);
  }, 360000);

  it('#3 Assets: burn pUSDT_BNB → USDT to BNB Testnet', async () => {
    if (skipE2E_R2DE) return;
    console.log('\n=== #3 Assets Transfer ===');

    const client = await createFundedFreshWallet({
      pUsdtBnb: parseUnits('0.01', 6),
      nativePC: parseEther('5'),
    });

    const usdt = PushChain.CONSTANTS.MOVEABLE.TOKEN.BNB_TESTNET.USDT;
    const tx = await client.universal.sendTransaction({
      to: { address: TARGET_R2DE, chain: CHAIN.BNB_TESTNET },
      funds: {
        amount: PushChain.utils.helpers.parseUnits('0.01', { decimals: usdt.decimals }),
        token: usdt,
      },
    });
    console.log(`TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Status: ${receipt.status} | External TX: ${receipt.externalTxHash} | Chain: ${receipt.externalChain}`);

    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeDefined();
    expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
  }, 360000);

  it('#4 Funds+Payload: burn pUSDT_BNB + counter.increment() on BNB', async () => {
    if (skipE2E_R2DE) return;
    console.log('\n=== #4 Funds + Payload ===');

    const client = await createFundedFreshWallet({
      pUsdtBnb: parseUnits('0.01', 6),
      nativePC: parseEther('5'),
    });

    const usdt = PushChain.CONSTANTS.MOVEABLE.TOKEN.BNB_TESTNET.USDT;
    const data = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI], functionName: 'increment',
    });

    const tx = await client.universal.sendTransaction({
      to: { address: COUNTER_BNB_R2DE, chain: CHAIN.BNB_TESTNET },
      data,
      funds: {
        amount: PushChain.utils.helpers.parseUnits('0.01', { decimals: usdt.decimals }),
        token: usdt,
      },
    });
    console.log(`TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Status: ${receipt.status} | External TX: ${receipt.externalTxHash} | Chain: ${receipt.externalChain}`);

    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeDefined();
    expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
  }, 360000);
});
