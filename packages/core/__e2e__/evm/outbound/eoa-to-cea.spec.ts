import '@e2e/shared/setup';
/**
 * EOA → CEA: Outbound Transactions (Route 2) from Push Chain Native EOA
 *
 * Tests for outbound transactions from a Push Chain native account (EOA) to
 * external chains via CEA (Route 2). Uses PUSH_TESTNET_DONUT as the origin chain.
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
import { MOVEABLE_TOKEN_CONSTANTS, type MoveableToken } from '../../../src/lib/constants/tokens';
import { buildErc20WithdrawalMulticall } from '../../../src/lib/orchestrator/payload-builders';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';

// BSC Testnet token addresses
const BSC_USDT_ADDRESS = '0xBC14F348BC9667be46b35Edc9B68653d86013DC5' as const;
const NATIVE_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

// Test target address
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

describe('EOA → CEA: Outbound from Push Chain Native Account (Route 2)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let eoaAddress: `0x${string}`;
  let ceaAddress: `0x${string}`;
  let usdtToken: MoveableToken | undefined;
  let bscPublicClient: ReturnType<typeof createPublicClient>;

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

    // Get CEA address for BSC Testnet — CEA Factory works for native Push EOA too
    const ceaResult = await getCEAAddress(eoaAddress, CHAIN.BNB_TESTNET);
    ceaAddress = ceaResult.cea;
    console.log(`CEA Address on BSC: ${ceaAddress}, deployed: ${ceaResult.isDeployed}`);

    // Get USDT token for ERC20 flows
    usdtToken = MOVEABLE_TOKEN_CONSTANTS.BNB_TESTNET.USDT;
    if (usdtToken) {
      console.log(`USDT Token (BNB Testnet): ${usdtToken.address} (${usdtToken.decimals} decimals)`);
    }

    bscPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0]),
    });
  }, 60000);

  // ============================================================================
  // Core Scenarios
  // ============================================================================
  describe('Core Scenarios', () => {

    // ============================================================================
    // 1. Funds — ERC-20 funds outbound
    // ============================================================================
    describe('1. Funds', () => {
      it('should transfer ERC-20 USDT to BSC Testnet from Push EOA', async () => {
        if (skipE2E) return;
        if (!usdtToken) {
          console.log('Skipping - USDT token not found');
          return;
        }

        console.log('\n=== Test: EOA ERC-20 USDT Transfer (R2-F-ERC20) ===');

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

        // Wait for outbound relay
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

    // ============================================================================
    // 2. Payload (Data) — single payload outbound
    // ============================================================================
    describe('2. Payload (Data)', () => {
      it('should increment counter on BSC from Push EOA', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: EOA Counter Increment (R2-P-3) ===');

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

        // Wait for outbound relay
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

    // ============================================================================
    // 3. Multicall — multicall outbound (no funds)
    // ============================================================================
    describe('3. Multicall', () => {
      it('should increment both counters via multicall from Push EOA', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: EOA Multicall — Increment Both Counters (R2-MC) ===');

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

        // Wait for outbound relay
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

        console.log('\n=== Test: EOA ERC-20 USDT + Counter Increment (R2-FP) ===');

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

        // Wait for outbound relay
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

        console.log('\n=== Test: EOA ERC-20 USDT + Counter Increment (R2-FP-ERC20) ===');

        // Read counter BEFORE
        const counterBefore = await bscPublicClient.readContract({
          address: COUNTER_A, abi: COUNTER_ABI, functionName: 'count',
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
            chain: CHAIN.BNB_TESTNET,
          },
          funds: {
            amount: withdrawAmount,
            token: usdtToken,
          },
          data: [
            { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: erc20TransferPayload },
            { to: COUNTER_A, value: BigInt(0), data: incrementPayload },
          ],
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

        // Wait for outbound relay
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

    // ============================================================================
    // 6. Native Funds — native pBNB outbound
    // ============================================================================
    describe('6. Native Funds', () => {
      it('should transfer native pBNB to BSC Testnet from Push EOA', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: EOA Native pBNB Transfer (R2-F-9) ===');

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_TARGET,
            chain: CHAIN.BNB_TESTNET,
          },
          value: parseEther('0.0001'),
        };

        // Route detection should work regardless of origin chain
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

    // ============================================================================
    // 7. Native Funds + Payload — native funds + single payload outbound
    // ============================================================================
    describe('7. Native Funds + Payload', () => {
      it('should transfer pBNB and increment counter from Push EOA', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: EOA Native pBNB + Counter Increment (R2-NFP) ===');

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

        // Wait for outbound relay
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
});
