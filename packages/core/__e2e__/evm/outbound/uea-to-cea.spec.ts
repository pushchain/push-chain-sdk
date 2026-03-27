import '@e2e/shared/setup';
/**
 * UEA → CEA: Outbound Transactions (Route 2)
 *
 * Tests for outbound transactions from Push Chain to external chains via CEA.
 * Covers: Route Detection, CEA Utilities, Transaction Preparation, FUNDS only,
 * PAYLOAD only, FUNDS + PAYLOAD, E2E Sync, Error Handling, Progress Hooks
 *
 * Primary test chain: BNB Testnet (Chain ID: 97)
 */
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { MOVEABLE_TOKEN_CONSTANTS, type MoveableToken } from '../../../src/lib/constants/tokens';
import { createWalletClient, createPublicClient, http, Hex, parseEther, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getCEAAddress, chainSupportsCEA } from '../../../src/lib/orchestrator/cea-utils';
import { TransactionRoute, detectRoute } from '../../../src/lib/orchestrator/route-detector';
import type { UniversalExecuteParams, ChainTarget } from '../../../src/lib/orchestrator/orchestrator.types';
import type { ProgressEvent } from '../../../src/lib/progress-hook/progress-hook.types';
import { ERC20_EVM } from '../../../src/lib/constants/abi/erc20.evm';
import { buildErc20WithdrawalMulticall } from '../../../src/lib/orchestrator/payload-builders';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';


// BSC Testnet token addresses
const BSC_USDT_ADDRESS = '0xBC14F348BC9667be46b35Edc9B68653d86013DC5' as const;
const NATIVE_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

// Test target address (random address for testing)
const TEST_TARGET = '0x1234567890123456789012345678901234567890' as `0x${string}`;

// Counter contract addresses (deployed on BNB Testnet 2026-03-14)
const COUNTER_A = '0x7f0936bb90e7dcf3edb47199c2005e7184e44cf8' as `0x${string}`;
const COUNTER_B = '0x7dd2f6d20cd2c8f24d8c6c7de48c4b39c6aa9b18' as `0x${string}`;
const COUNTER_ABI = [
  { type: 'function', name: 'count', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'increment', inputs: [], outputs: [], stateMutability: 'nonpayable' },
] as const;

// Payable counter contract (deployed on BNB Testnet — accepts native BNB via increment)
const COUNTER_PAYABLE = '0xf4bd8c13da0f5831d7b6dd3275a39f14ec7ddaa6' as `0x${string}`;
const COUNTER_PAYABLE_ABI = [
  { type: 'function', name: 'count', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'increment', inputs: [], outputs: [], stateMutability: 'payable' },
] as const;

describe('UEA → CEA: Outbound Transactions (Route 2)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;
  let ceaAddress: `0x${string}`;
  let usdtToken: MoveableToken | undefined;
  let bscPublicClient: ReturnType<typeof createPublicClient>;

  // Skip if no private key is set
  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E = !privateKey;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping E2E tests - EVM_PRIVATE_KEY not set');
      return;
    }

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

    pushClient = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      printTraces: true,
      progressHook: (val: any) => {
        console.log(`[${val.id}] ${val.title}`);
      },
    });

    ueaAddress = pushClient.universal.account;
    console.log(`UEA Address: ${ueaAddress}`);

    // Get CEA address for BSC Testnet
    const ceaResult = await getCEAAddress(ueaAddress, CHAIN.BNB_TESTNET);
    ceaAddress = ceaResult.cea;
    console.log(`CEA Address on BSC: ${ceaAddress}, deployed: ${ceaResult.isDeployed}`);

    // Get USDT token for ERC20 flows
    usdtToken = MOVEABLE_TOKEN_CONSTANTS.BNB_TESTNET.USDT;
    if (usdtToken) {
      console.log(`USDT Token: ${usdtToken.address} (${usdtToken.decimals} decimals)`);
    }

    bscPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0]),
    });
  }, 60000);

  // ============================================================================
  // Core Scenarios
  // ============================================================================
  describe('Core Scenarios', () => {

    // ==========================================================================
    // 1. Funds
    // ==========================================================================
    describe('1. Funds', () => {
      it('should transfer ERC-20 USDT to BSC Testnet', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log('\n=== Test: ERC-20 USDT Transfer ===');

        const withdrawAmount = BigInt(10000); // 0.01 USDT (6 decimals)

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_TARGET,
            chain: CHAIN.BNB_TESTNET,
          },
          funds: {
            amount: withdrawAmount,
            token: usdtToken,
          },
          data: buildErc20WithdrawalMulticall(
            BSC_USDT_ADDRESS as `0x${string}`,
            TEST_TARGET,
            withdrawAmount
          ),
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

        // Wait for outbound relay and verify external chain details
        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

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

      it('should increment counter on BSC via payload', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Counter Increment via Payload ===');

        // Read counter BEFORE
        const counterBefore = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterBefore}`);

        const payload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          to: {
            address: COUNTER_A,
            chain: CHAIN.BNB_TESTNET,
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
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 360000);
    });

    // ==========================================================================
    // 3. Multicall
    // ==========================================================================
    describe('3. Multicall', () => {
      it('should increment both counters via multicall', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Multicall — Increment Both Counters ===');

        // Read both counters BEFORE
        const counterABefore = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        const counterBBefore = await bscPublicClient.readContract({
          address: COUNTER_B, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterABefore}, CounterB BEFORE: ${counterBBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: CHAIN.BNB_TESTNET,
          },
          data: [
            { to: COUNTER_A, value: BigInt(0), data: incrementPayload },
            { to: COUNTER_B, value: BigInt(0), data: incrementPayload },
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
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read both counters AFTER
        const counterAAfter = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        const counterBAfter = await bscPublicClient.readContract({
          address: COUNTER_B, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAAfter}, CounterB AFTER: ${counterBAfter}`);
        expect(counterAAfter).toBeGreaterThan(counterABefore);
        expect(counterBAfter).toBeGreaterThan(counterBBefore);
      }, 360000);
    });

    // ==========================================================================
    // 4. Funds + Payload
    // ==========================================================================
    describe('4. Funds + Payload', () => {
      it('should transfer ERC-20 USDT and increment counter', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log('\n=== Test: ERC-20 USDT + Counter Increment ===');

        // Read counter BEFORE
        const counterBefore = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterBefore}`);

        const withdrawAmount = BigInt(10000); // 0.01 USDT (6 decimals)

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          to: {
            address: COUNTER_A,
            chain: CHAIN.BNB_TESTNET,
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
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

        // Wait for outbound relay and verify external chain details
        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 360000);
    });

    // ==========================================================================
    // 5. Funds + Multicall
    // ==========================================================================
    describe('5. Funds + Multicall', () => {
      it('should withdraw ERC20 using buildErc20WithdrawalMulticall helper', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found in MOVEABLE_TOKENS');
          return;
        }

        console.log('\n=== Test: ERC20 Withdrawal via buildErc20WithdrawalMulticall (Flow 2.2) ===');

        const withdrawAmount = BigInt(10000); // 0.01 USDT (6 decimals)

        // Build the ERC20 transfer multicall using the new helper
        const multicall = buildErc20WithdrawalMulticall(
          BSC_USDT_ADDRESS as `0x${string}`,
          TEST_TARGET,
          withdrawAmount
        );

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: CHAIN.BNB_TESTNET,
          },
          funds: {
            amount: withdrawAmount,
            token: usdtToken,
          },
          data: multicall,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ==========================================================================
    // 6. Native Funds
    // ==========================================================================
    describe('6. Native Funds', () => {
      it('should transfer native pBNB to BSC Testnet', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Native pBNB Transfer ===');

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_TARGET,
            chain: CHAIN.BNB_TESTNET,
          },
          value: parseEther('0.0001'), // 0.0001 BNB
        };

        // Verify route detection
        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        console.log(`Target Chain: ${tx.chain}`);

        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

        // Wait for outbound relay and verify external chain details
        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);
    });

    // ==========================================================================
    // 7. Native Funds + Payload
    // ==========================================================================
    describe('7. Native Funds + Payload', () => {
      it('should transfer pBNB and increment counter', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Native pBNB + Counter Increment ===');

        // Read counter BEFORE (using payable counter that accepts native BNB)
        const counterBefore = await bscPublicClient.readContract({
          address: COUNTER_PAYABLE, abi: COUNTER_PAYABLE_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterPayable BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_PAYABLE_ABI,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          to: {
            address: COUNTER_PAYABLE,
            chain: CHAIN.BNB_TESTNET,
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
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await bscPublicClient.readContract({
          address: COUNTER_PAYABLE, abi: COUNTER_PAYABLE_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterPayable AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 360000);
    });   
  });

  // ============================================================================
  // Additional Tests
  // ============================================================================
  describe('Additional Tests', () => {

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
            chain: CHAIN.BNB_TESTNET,
          } as ChainTarget,
          value: parseEther('0.001'),
        };
        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);
      });

      it('should detect CEA_TO_PUSH when from.chain is specified with Push target', () => {
        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.BNB_TESTNET },
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
      it('should report BNB Testnet supports CEA', () => {
        expect(chainSupportsCEA(CHAIN.BNB_TESTNET)).toBe(true);
      });

      it('should report Ethereum Sepolia supports CEA', () => {
        expect(chainSupportsCEA(CHAIN.ETHEREUM_SEPOLIA)).toBe(true);
      });

      it('should report Solana Devnet does not support CEA', () => {
        expect(chainSupportsCEA(CHAIN.SOLANA_DEVNET)).toBe(false);
      });

      it('should compute CEA address for UEA on BNB Testnet', async () => {
        if (skipE2E) return;

        const result = await getCEAAddress(ueaAddress, CHAIN.BNB_TESTNET);
        console.log(`CEA on BNB Testnet: ${result.cea}, deployed: ${result.isDeployed}`);

        expect(result.cea).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(typeof result.isDeployed).toBe('boolean');
      });

      it('should compute deterministic CEA address', async () => {
        if (skipE2E) return;

        const result = await getCEAAddress(ueaAddress, CHAIN.BNB_TESTNET);

        expect(result.cea).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(typeof result.isDeployed).toBe('boolean');

        // CEA should be deterministic - calling again should return same address
        const result2 = await getCEAAddress(ueaAddress, CHAIN.BNB_TESTNET);
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
            chain: CHAIN.BNB_TESTNET,
          },
          value: parseEther('0.0001'),
        };

        const prepared = await pushClient.universal.prepareTransaction(params);

        console.log(`Prepared tx route: ${prepared.route}`);
        console.log(`Estimated gas: ${prepared.estimatedGas}`);
        console.log(`Nonce: ${prepared.nonce}`);

        expect(prepared.route).toBe('UOA_TO_CEA');
        expect(prepared.payload).toBeDefined();
        expect(typeof prepared.thenOn).toBe('function');
        expect(typeof prepared.send).toBe('function');
      });

      it('should create chained builder from prepared transactions', async () => {
        if (skipE2E) return;

        const firstPrepared = await pushClient.universal.prepareTransaction({
          to: '0x1234567890123456789012345678901234567890',
          value: parseEther('0.001'),
        });

        const builder = pushClient.universal.executeTransactions(firstPrepared);

        expect(typeof builder.thenOn).toBe('function');
        expect(typeof builder.send).toBe('function');

        // Test chaining with a second prepared transaction
        const secondPrepared = await pushClient.universal.prepareTransaction({
          to: {
            address: '0x1234567890123456789012345678901234567890',
            chain: CHAIN.BNB_TESTNET,
          },
          value: parseEther('0.0001'),
        });

        const chainedBuilder = builder.thenOn(secondPrepared);

        expect(typeof chainedBuilder.thenOn).toBe('function');
        expect(typeof chainedBuilder.send).toBe('function');
      }, 60000);
    });

    // ==========================================================================
    // Edge Cases
    // ==========================================================================
    describe('Edge Cases', () => {
      it('should handle small amount transfer', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Small Amount Transfer ===');

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_TARGET,
            chain: CHAIN.BNB_TESTNET,
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
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);

      it('should transfer pBNB and increment counter with multicall', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: pBNB + Counter Increment Multicall (2) ===');

        // Read counter BEFORE
        const counterBefore = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: CHAIN.BNB_TESTNET,
          },
          value: parseEther('0.0001'),
          data: [
            // Call 1: CEA sends BNB to recipient
            { to: TEST_TARGET, value: parseEther('0.0001'), data: '0x' as `0x${string}` },
            // Call 2: Increment counter
            { to: COUNTER_A, value: BigInt(0), data: incrementPayload },
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
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Wait for RPC propagation
        await new Promise((r) => setTimeout(r, 5000));

        // Read counter AFTER
        const counterAfter = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 360000);

      it('should transfer ERC-20 pUSDT to alternate BSC Testnet recipient', async () => {
        if (skipE2E) return;

        // Use BNB Testnet USDT token (not Sepolia USDT) since destination is BNB Testnet
        const bnbUsdtToken = MOVEABLE_TOKEN_CONSTANTS.BNB_TESTNET.USDT;

        console.log('\n=== Test: ERC20 pUSDT Transfer to Alternate Recipient ===');

        const ALTERNATE_RECIPIENT = '0x0987654321098765432109876543210987654321' as `0x${string}`;
        const withdrawAmount = BigInt(10000); // 0.01 USDT (6 decimals)

        // Build the ERC20 transfer multicall targeting alternate recipient
        const multicall = buildErc20WithdrawalMulticall(
          BSC_USDT_ADDRESS as `0x${string}`,
          ALTERNATE_RECIPIENT,
          withdrawAmount
        );

        const params: UniversalExecuteParams = {
          to: {
            address: ALTERNATE_RECIPIENT,
            chain: CHAIN.BNB_TESTNET,
          },
          funds: {
            amount: withdrawAmount,
            token: bnbUsdtToken,
          },
          data: multicall,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ==========================================================================
    // E2E Sync
    // ==========================================================================
    describe('E2E Sync', () => {
      it('should execute outbound transfer from UOA to CEA on BSC Testnet', async () => {
        if (skipE2E) return;

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

        // The UOA already has pBNB balance on Push Chain
        // We can directly test the outbound flow without bridging first

        // Execute outbound transfer to BSC Testnet
        const tx = await pushClient.universal.sendTransaction({
          to: {
            address: targetAddress,
            chain: CHAIN.BNB_TESTNET,
          },
          value: parseEther('0.00015'),
          gasLimit: BigInt(2000000),
        });

        console.log(`[TEST] ${new Date().toISOString()} Push Chain TX Hash: ${tx.hash}`);

        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

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
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
        expect(receipt.externalExplorerUrl).toContain('testnet.bscscan.com');
        expect(receipt.externalExplorerUrl).toContain(receipt.externalTxHash!);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);

      it('should include external chain details in receipt for outbound via unified .wait()', async () => {
        if (skipE2E) return;

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

        console.log(`\n=== TEST: Unified .wait() with outbound ===`);
        console.log(`[TEST] ${new Date().toISOString()} Sending outbound tx...`);

        // Execute outbound transfer to BSC Testnet
        const tx = await pushClient.universal.sendTransaction({
          to: {
            address: targetAddress,
            chain: CHAIN.BNB_TESTNET,
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
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
        expect(receipt.externalExplorerUrl).toContain('testnet.bscscan.com');
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
            chain: CHAIN.BNB_TESTNET,
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

        console.log('\n=== Test: Progress Hooks (FUNDS) ===');

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
            chain: CHAIN.BNB_TESTNET,
          },
          value: parseEther('0.00001'),
        };

        const tx = await clientWithHook.universal.sendTransaction(params);

        // Verify we got progress events
        expect(events.length).toBeGreaterThan(0);

        // Verify key events were emitted
        expect(events.some(e => e.id === 'SEND-TX-01')).toBe(true);
        expect(events.some(e => e.id.startsWith('SEND-TX-99'))).toBe(true);
      }, 180000);

      it('should emit correct hooks for PAYLOAD flow', async () => {
        if (skipE2E) return;

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
            address: BSC_USDT_ADDRESS as `0x${string}`,
            chain: CHAIN.BNB_TESTNET,
          },
          data: payload,
        };

        const tx = await clientWithHook.universal.sendTransaction(params);

        expect(events.length).toBeGreaterThan(0);
        expect(events.some(e => e.id === 'SEND-TX-01')).toBe(true);
      }, 180000);
    });

    // ==========================================================================
    // DeFi Flows
    // ==========================================================================
    describe('DeFi Flows', () => {
      const SPENDER = '0x9999999999999999999999999999999999999999' as `0x${string}`;

      it('should execute ERC20 burn + approve multicall (Flow 3.4)', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log('\n=== Test: ERC20 Burn + Approve Multicall (Flow 3.4) ===');

        const burnAmount = BigInt(10000); // 0.01 USDT

        // User-provided multicall: approve spender for the burned amount
        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [SPENDER, burnAmount],
        });

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: CHAIN.BNB_TESTNET,
          },
          funds: {
            amount: burnAmount,
            token: usdtToken,
          },
          data: [
            // Step 1: Approve spender for the burned token amount
            { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: approvePayload },
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
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);

      it('should execute ERC20 CEA-only with no burn (Flow 3.5)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: ERC20 CEA-Only, No Burn (Flow 3.5) ===');
        console.log('Note: Payload-only with burnAmount = 0 (precompile fix deployed)');

        // No funds, no value — only data. CEA uses existing balance.
        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [SPENDER, BigInt(1000000)],
        });

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: CHAIN.BNB_TESTNET,
          },
          // No value, no funds — GAS_AND_PAYLOAD type
          data: [
            { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: approvePayload },
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
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);

      it('should execute ERC20 hybrid burn + CEA balance (Flow 3.6)', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log('\n=== Test: ERC20 Hybrid Burn + CEA Balance (Flow 3.6) ===');
        console.log('Note: Combined approval exceeds burn amount (draws on CEA existing balance)');

        const burnAmount = BigInt(10000); // 0.01 USDT burned on Push Chain
        // Approve for more than burn amount — the extra comes from CEA existing balance
        const combinedApproval = BigInt(20000); // 0.02 USDT total

        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [SPENDER, combinedApproval],
        });

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: CHAIN.BNB_TESTNET,
          },
          funds: {
            amount: burnAmount,
            token: usdtToken,
          },
          data: [
            // Approve for combined amount (burn + existing CEA balance)
            { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: approvePayload },
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
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);

      it('should execute native hybrid: multicall value exceeds burnAmount', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Native Hybrid — Multicall Value > Burn (Flow 3.3) ===');
        console.log('Note: Burns 0.0001 BNB but multicall sends 0.0002 BNB (CEA balance covers diff)');

        const burnAmount = parseEther('0.0001'); // Amount burned on Push Chain

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: CHAIN.BNB_TESTNET,
          },
          value: burnAmount, // Burns this amount on Push Chain
          data: [
            // Multicall sends more than burn — relies on CEA having pre-existing BNB balance
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
        expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

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

        console.log('\n=== Test: Counter Payload Only — Single Increment ===');

        // Read counter BEFORE
        const counterBefore = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterBefore}`);

        const params: UniversalExecuteParams = {
          to: {
            address: COUNTER_A,
            chain: CHAIN.BNB_TESTNET,
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
        const counterAfter = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAfter}`);

        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);

      it('should transfer BNB + increment counter via native funds + payload', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Counter Native Funds + Payload ===');

        const incrementPayload = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });

        // Read counter BEFORE
        const counterBefore = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterBefore}`);

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: CHAIN.BNB_TESTNET,
          },
          value: parseEther('0.0001'),
          data: [
            { to: TEST_TARGET, value: parseEther('0.0001'), data: '0x' as `0x${string}` },
            { to: COUNTER_A, value: BigInt(0), data: incrementPayload },
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
        const counterAfter = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAfter}`);

        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);

      it('should transfer BNB + increment both counters via native funds + multicall', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Counter Native Funds + Multicall (Both Counters) ===');

        const incrementPayload = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });

        // Read both counters BEFORE
        const counterABefore = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        const counterBBefore = await bscPublicClient.readContract({
          address: COUNTER_B,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterABefore}, CounterB BEFORE: ${counterBBefore}`);

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: CHAIN.BNB_TESTNET,
          },
          value: parseEther('0.0001'),
          data: [
            { to: TEST_TARGET, value: parseEther('0.0001'), data: '0x' as `0x${string}` },
            { to: COUNTER_A, value: BigInt(0), data: incrementPayload },
            { to: COUNTER_B, value: BigInt(0), data: incrementPayload },
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

        // Read both counters AFTER
        const counterAAfter = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        const counterBAfter = await bscPublicClient.readContract({
          address: COUNTER_B,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAAfter}, CounterB AFTER: ${counterBAfter}`);

        expect(counterAAfter).toBeGreaterThan(counterABefore);
        expect(counterBAfter).toBeGreaterThan(counterBBefore);
      }, 600000);

      it('should transfer ERC20 USDT + increment counter via funds + payload', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log('\n=== Test: Counter ERC20 Funds + Payload — USDT Transfer + Increment ===');

        const incrementPayload = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });
        const erc20TransferPayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'transfer',
          args: [TEST_TARGET, BigInt(10000)],
        });

        // Read counter BEFORE
        const counterBefore = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterBefore}`);

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: CHAIN.BNB_TESTNET,
          },
          funds: {
            amount: BigInt(10000),
            token: usdtToken,
          },
          data: [
            { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: erc20TransferPayload },
            { to: COUNTER_A, value: BigInt(0), data: incrementPayload },
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
        const counterAfter = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAfter}`);

        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);

      it('should transfer ERC20 USDT + increment both counters via funds + multicall', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log('\n=== Test: Counter ERC20 Funds + Multicall — USDT Transfer + Both Counters ===');

        const incrementPayload = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });
        const erc20TransferPayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'transfer',
          args: [TEST_TARGET, BigInt(10000)],
        });

        // Read both counters BEFORE
        const counterABefore = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        const counterBBefore = await bscPublicClient.readContract({
          address: COUNTER_B,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA BEFORE: ${counterABefore}, CounterB BEFORE: ${counterBBefore}`);

        const params: UniversalExecuteParams = {
          to: {
            address: NATIVE_ADDRESS as `0x${string}`,
            chain: CHAIN.BNB_TESTNET,
          },
          funds: {
            amount: BigInt(10000),
            token: usdtToken,
          },
          data: [
            { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: erc20TransferPayload },
            { to: COUNTER_A, value: BigInt(0), data: incrementPayload },
            { to: COUNTER_B, value: BigInt(0), data: incrementPayload },
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

        // Read both counters AFTER
        const counterAAfter = await bscPublicClient.readContract({
          address: COUNTER_A,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        const counterBAfter = await bscPublicClient.readContract({
          address: COUNTER_B,
          abi: COUNTER_ABI,
          functionName: 'count',
        }) as bigint;
        console.log(`CounterA AFTER: ${counterAAfter}, CounterB AFTER: ${counterBAfter}`);

        expect(counterAAfter).toBeGreaterThan(counterABefore);
        expect(counterBAfter).toBeGreaterThan(counterBBefore);
      }, 600000);

      it('should migrate CEA on BNB Testnet via migrateCEA convenience method', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: CEA Migration via migrateCEA ===');

        const tx = await pushClient.universal.migrateCEA(CHAIN.BNB_TESTNET);
        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, CHAIN.BNB_TESTNET);
      }, 600000);

      it('should migrate CEA via sendTransaction with migration flag', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: CEA Migration via sendTransaction ===');

        const params: UniversalExecuteParams = {
          to: {
            address: ceaAddress,
            chain: CHAIN.BNB_TESTNET,
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
        await verifyExternalTransaction(receipt.externalTxHash!, CHAIN.BNB_TESTNET);
      }, 600000);
    });
  });
});
