/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any */
/**
 * CEA → UEA: SVM Inbound Transactions (Route 3)
 *
 * Tests for inbound transactions from Solana back to Push Chain via CEA,
 * targeting a UEA (Universal External Account) signer (EVM_PRIVATE_KEY).
 * Covers: Route Detection, Funds (SOL/SPL), Payload, Multicall,
 * Funds + Payload, Value to Others, Hybrid Flows, Error Handling,
 * Progress Hooks, Cascade Tests
 *
 * Primary test chain: Solana Devnet
 */
import '@e2e/shared/setup';
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { createWalletClient, createPublicClient, http, Hex, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { TransactionRoute, detectRoute } from '../../../src/lib/orchestrator/route-detector';
import type {
  UniversalExecuteParams,
  ChainTarget,
  ChainSource,
} from '../../../src/lib/orchestrator/orchestrator.types';
import type { ProgressEvent } from '../../../src/lib/progress-hook/progress-hook.types';
import { ERC20_EVM } from '../../../src/lib/constants/abi/erc20.evm';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { DIFFERENT_ADDRESS } from '@e2e/shared/constants';
import {
  COUNTER_ADDRESS_PAYABLE,
  COUNTER_ABI_PAYABLE,
} from '@e2e/shared/inbound-helpers';
import { COUNTER_ABI, TEST_TARGET, NATIVE_ADDRESS } from '@e2e/shared/outbound-helpers';
import {
  TEST_SOL_TARGET,
  SOL_USDT_TOKEN,
  deriveCeaPda,
  buildReceiveSolAccounts,
  buildReceiveSolIxData,
  TEST_PROGRAM,
  toHexData,
} from '@e2e/shared/svm-outbound-helpers';

// PRC-20 token on Push Chain (pUSDT) — used for multicall approve tests
const PUSH_CHAIN_PUSDT = '0x2f98B4235FD2BA0173a2B056D722879360B12E7b' as `0x${string}`;

describe('CEA → UEA: SVM Inbound Transactions (Route 3)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;
  let ceaPdaHex: `0x${string}`;
  let pushPublicClient: ReturnType<typeof createPublicClient>;

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
      progressHook: (val: any) => {
        console.log(`[${val.id}] ${val.title}`);
      },
    });
    pushClient = setup.pushClient;

    ueaAddress = pushClient.universal.account;
    console.log(`UEA Address: ${ueaAddress}`);

    const derived = deriveCeaPda(ueaAddress);
    ceaPdaHex = derived.ceaPdaHex;
    console.log(`CEA PDA: ${derived.ceaPda.toBase58()}`);
    console.log(`CEA PDA Hex: ${ceaPdaHex}`);

    pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
  }, 60000);

  // ============================================================================
  // 1. Route Detection (Route 3 SVM)
  // ============================================================================
  describe('1. Route Detection', () => {
    it('should detect CEA_TO_PUSH when from.chain is Solana Devnet and to is string', () => {
      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
        to: '0x1234567890123456789012345678901234567890',
        value: BigInt(50_000_000),
      };
      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);
    });

    it('should detect CEA_TO_PUSH when from.chain is Solana Devnet and to.chain is Push', () => {
      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
        to: {
          address: '0x1234567890123456789012345678901234567890',
          chain: CHAIN.PUSH_TESTNET_DONUT,
        } as ChainTarget,
        value: BigInt(50_000_000),
      };
      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);
    });
  });

  // ============================================================================
  // Core Scenarios — fundamental CEA-to-UEA transaction types
  // ============================================================================
  describe('Core Scenarios', () => {
    // ============================================================================
    // 1. Funds (SOL)
    // ============================================================================
    describe('1. Funds (SOL)', () => {
      it('should drain SOL from Solana gateway back to UEA on Push Chain', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: CEA-to-UEA SOL ===');

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
          to: ueaAddress,
          value: BigInt(5_000_000), // 0.005 SOL in lamports
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        console.log(`Source Chain: ${tx.chain}`);

        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        console.log('Calling tx.wait() - polling for external chain details...');
        const receipt = await tx.wait();

        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ============================================================================
    // 2. Funds (SPL)
    // ============================================================================
    describe('2. Funds (SPL)', () => {
      it('should drain SPL token (USDT) from Solana gateway back to UEA', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: CEA-to-UEA SPL ===');

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
          to: ueaAddress,
          funds: {
            amount: BigInt(100_000), // 0.1 USDT (6 decimals)
            token: SOL_USDT_TOKEN,
          },
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        console.log('Calling tx.wait() - polling for external chain details...');
        const receipt = await tx.wait();

        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ============================================================================
    // 3. Payload (Data) — increment Push Chain counter via Route 3
    // ============================================================================
    describe('3. Payload (Data)', () => {
      it('should increment Push Chain counter via Route 3 payload', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Payload-Only Inbound — Counter Increment [Solana Devnet] ===');

        // Read Push Chain counter BEFORE
        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const pushPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
          to: COUNTER_ADDRESS_PAYABLE,
          data: pushPayload,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // CEA-to-Push requires round-trip: Push → Solana → Push (inbound)
        // The return inbound relay takes time, poll until counter increments
        const maxInboundWait = 180000;
        const pollInterval = 10000;
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < maxInboundWait) {
          await new Promise((r) => setTimeout(r, pollInterval));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE,
            abi: COUNTER_ABI_PAYABLE,
            functionName: 'countPC',
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling counter: ${counterAfter} (elapsed: ${elapsed}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);
    });

    // ============================================================================
    // 4. Multicall
    // ============================================================================
    describe('4. Multicall', () => {
      it('should execute multicall on Push Chain: increment counter + approve (no funds)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Multicall Only (Route 3) — Counter Increment + Approve [Solana Devnet] ===');

        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [TEST_TARGET, BigInt(1000000)],
        });

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
          to: NATIVE_ADDRESS as `0x${string}`,
          data: [
            { to: COUNTER_ADDRESS_PAYABLE, value: BigInt(0), data: incrementPayload },
            { to: PUSH_CHAIN_PUSDT, value: BigInt(0), data: approvePayload },
          ],
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        console.log('Calling tx.wait() - polling for external chain tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Poll for counter increment (round-trip relay)
        const maxInboundWait = 180000;
        const pollInterval = 10000;
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < maxInboundWait) {
          await new Promise((r) => setTimeout(r, pollInterval));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE,
            abi: COUNTER_ABI_PAYABLE,
            functionName: 'countPC',
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling counter: ${counterAfter} (elapsed: ${elapsed}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);
    });

    // ============================================================================
    // 5. Funds (SOL) + Payload
    // ============================================================================
    describe('5. Funds (SOL) + Payload', () => {
      it('should drain SOL and increment Push Chain counter', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: SOL + Payload — Counter Increment [Solana Devnet] ===');

        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const pushPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
          to: COUNTER_ADDRESS_PAYABLE,
          value: BigInt(5_000_000), // 0.005 SOL drain amount
          data: pushPayload,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Poll for counter increment
        const maxInboundWait = 180000;
        const pollInterval = 10000;
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < maxInboundWait) {
          await new Promise((r) => setTimeout(r, pollInterval));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE,
            abi: COUNTER_ABI_PAYABLE,
            functionName: 'countPC',
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling counter: ${counterAfter} (elapsed: ${elapsed}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);
    });

    // ============================================================================
    // 6. Funds (SOL) + Multicall
    // ============================================================================
    describe('6. Funds (SOL) + Multicall', () => {
      it('should drain SOL and execute multicall on Push Chain', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: SOL + Multicall [Solana Devnet] ===');

        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [TEST_TARGET, BigInt(1000000)],
        });

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
          to: NATIVE_ADDRESS as `0x${string}`,
          value: BigInt(5_000_000), // 0.005 SOL drain amount
          data: [
            { to: COUNTER_ADDRESS_PAYABLE, value: BigInt(0), data: incrementPayload },
            { to: PUSH_CHAIN_PUSDT, value: BigInt(0), data: approvePayload },
          ],
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Poll for counter increment
        const maxInboundWait = 180000;
        const pollInterval = 10000;
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < maxInboundWait) {
          await new Promise((r) => setTimeout(r, pollInterval));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE,
            abi: COUNTER_ABI_PAYABLE,
            functionName: 'countPC',
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling counter: ${counterAfter} (elapsed: ${elapsed}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);
    });

    // ============================================================================
    // 7. Funds (SPL) + Payload (S-4.8)
    // ============================================================================
    describe('7. Funds (SPL) + Payload (S-4.8)', () => {
      it('should drain SPL USDT and increment Push Chain counter', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: SPL + Payload — Counter Increment [Solana Devnet] ===');

        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const pushPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
          to: COUNTER_ADDRESS_PAYABLE,
          funds: {
            amount: BigInt(100_000), // 0.1 USDT
            token: SOL_USDT_TOKEN,
          },
          data: pushPayload,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Poll for counter increment
        const maxInboundWait = 180000;
        const pollInterval = 10000;
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < maxInboundWait) {
          await new Promise((r) => setTimeout(r, pollInterval));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE,
            abi: COUNTER_ABI_PAYABLE,
            functionName: 'countPC',
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling counter: ${counterAfter} (elapsed: ${elapsed}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);
    });

    // ============================================================================
    // 8. Funds (SPL) + Multicall
    // ============================================================================
    describe('8. Funds (SPL) + Multicall', () => {
      it('should drain SPL USDT and execute multicall on Push Chain', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: SPL + Multicall [Solana Devnet] ===');

        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [TEST_TARGET, BigInt(1000000)],
        });

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
          to: NATIVE_ADDRESS as `0x${string}`,
          funds: {
            amount: BigInt(100_000), // 0.1 USDT
            token: SOL_USDT_TOKEN,
          },
          data: [
            { to: COUNTER_ADDRESS_PAYABLE, value: BigInt(0), data: incrementPayload },
            { to: PUSH_CHAIN_PUSDT, value: BigInt(0), data: approvePayload },
          ],
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

        // Poll for counter increment
        const maxInboundWait = 180000;
        const pollInterval = 10000;
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < maxInboundWait) {
          await new Promise((r) => setTimeout(r, pollInterval));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE,
            abi: COUNTER_ABI_PAYABLE,
            functionName: 'countPC',
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling counter: ${counterAfter} (elapsed: ${elapsed}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);
    });

    // ==========================================================================
    // 9. Value to Others (UTX-02)
    // ==========================================================================
    describe('9. Value to Others (UTX-02)', () => {
      it('should drain SOL to different Push Chain address', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: SOL to Different Address (UTX-02) ===');

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
          to: DIFFERENT_ADDRESS,
          value: BigInt(1_000_000), // 0.001 SOL
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ==========================================================================
    // 10. Funds to Others (UTX-04)
    // ==========================================================================
    describe('10. Funds to Others (UTX-04)', () => {
      it('should drain SPL USDT to different Push Chain address', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: SPL to Different Address (UTX-04) ===');

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
          to: DIFFERENT_ADDRESS,
          funds: {
            amount: BigInt(100_000), // 0.1 USDT
            token: SOL_USDT_TOKEN,
          },
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ==========================================================================
    // 11. Native Funds to Others (UTX-16)
    // ==========================================================================
    describe('11. Native Funds to Others (UTX-16)', () => {
      it('should drain SOL (native) to different Push Chain address', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Native SOL to Different Address (UTX-16) ===');

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
          to: DIFFERENT_ADDRESS,
          value: BigInt(5_000_000), // 0.005 SOL
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ==========================================================================
    // 12. Value + Funds + Data to Contract (UTX-13)
    // ==========================================================================
    describe('12. Value + Funds + Data to Contract (UTX-13)', () => {
      it('should send SOL + SPL + data to counter contract via Route 3', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: V+F+D to Contract via Route 3 [Solana Devnet] ===');

        const pushPayload = encodeFunctionData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Counter BEFORE: ${counterBefore}`);

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
          to: COUNTER_ADDRESS_PAYABLE,
          value: BigInt(1_000_000), // 0.001 SOL
          funds: {
            amount: BigInt(100_000), // 0.1 USDT
            token: SOL_USDT_TOKEN,
          },
          data: pushPayload,
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        expect(receipt.status).toBe(1);

        if (receipt.externalTxHash) {
          await verifyExternalTransaction(receipt.externalTxHash, receipt.externalChain!);
        }

        // Poll for counter increment (round-trip relay)
        const maxInboundWait = 300000;
        const pollInterval = 10000;
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < maxInboundWait) {
          await new Promise((r) => setTimeout(r, pollInterval));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE,
            abi: COUNTER_ABI_PAYABLE,
            functionName: 'countPC',
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling counter: ${counterAfter} (elapsed: ${elapsed}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);
    });

    // ==========================================================================
    // 13. Value + Funds to Self (UTX-09)
    // ==========================================================================
    describe('13. Value + Funds to Self (UTX-09)', () => {
      it('should drain SOL + SPL USDT to self via Route 3', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Value + Funds to Self via Route 3 [Solana Devnet] ===');

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
          to: ueaAddress,
          value: BigInt(1_000_000), // 0.001 SOL
          funds: {
            amount: BigInt(100_000), // 0.1 USDT
            token: SOL_USDT_TOKEN,
          },
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ==========================================================================
    // 14. Value + Funds to Others (UTX-10)
    // ==========================================================================
    describe('14. Value + Funds to Others (UTX-10)', () => {
      it('should drain SOL + SPL USDT to different address via Route 3', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Value + Funds to Others via Route 3 [Solana Devnet] ===');

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
          to: DIFFERENT_ADDRESS,
          value: BigInt(1_000_000), // 0.001 SOL
          funds: {
            amount: BigInt(100_000), // 0.1 USDT
            token: SOL_USDT_TOKEN,
          },
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });

    // ==========================================================================
    // 15. Value + Native Funds (UTX-19)
    // ==========================================================================
    describe('15. Value + Native Funds (UTX-19)', () => {
      it('should drain SOL (larger amount) to self via Route 3', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Value + Native Funds via Route 3 [Solana Devnet] ===');

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
          to: ueaAddress,
          value: BigInt(10_000_000), // 0.01 SOL (larger than standard 0.005)
        };

        expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 600000);
    });
  });

  // ============================================================================
  // SOL + extraPayload (S-4.7)
  // ============================================================================
  describe('SOL + extraPayload (S-4.7)', () => {
    it('should drain SOL from Solana gateway with Push Chain execution payload', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: CEA-to-UEA SOL + extraPayload (S-4.7) ===');

      const pushPayload = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
        to: COUNTER_ADDRESS_PAYABLE,
        value: BigInt(5_000_000), // 0.005 SOL drain amount
        data: pushPayload,
      };

      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      console.log('Calling tx.wait() - polling for external chain details...');
      const receipt = await tx.wait();

      console.log(`Receipt status: ${receipt.status}`);
      console.log(`External TX Hash: ${receipt.externalTxHash}`);
      console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 600000);
  });

  // ============================================================================
  // Hybrid Self-Call Flows (S-4.1, S-4.2, S-4.5, S-4.6)
  //
  // SVM gateway program auto-handles CEA pre-existing balance — it drains
  // ALL funds from the CEA PDA, not just the burned amount. No SDK code
  // changes are needed (unlike EVM). These tests confirm the behavior.
  // ============================================================================
  describe('Hybrid Self-Call (CEA pre-existing balance, SVM auto-handles)', () => {
    it('S-4.1: should drain SOL including pre-existing CEA balance (hybrid)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: S-4.1 SOL Hybrid Self-Call (burn + CEA pre-existing) ===');
      console.log('SVM gateway auto-drains all CEA PDA balance — no extra SDK logic needed');

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
        to: ueaAddress,
        value: BigInt(1_000_000), // 0.001 SOL burn amount
      };

      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      console.log('Calling tx.wait() - polling for external chain details...');
      const receipt = await tx.wait();

      console.log(`Receipt status: ${receipt.status}`);
      console.log(`External TX Hash: ${receipt.externalTxHash}`);

      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 600000);

    it('S-4.2: should drain SPL USDT including pre-existing CEA balance (hybrid)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: S-4.2 SPL Hybrid Self-Call (burn + CEA pre-existing) ===');
      console.log('SVM gateway auto-drains all CEA PDA balance — no extra SDK logic needed');

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
        to: ueaAddress,
        funds: {
          amount: BigInt(100_000), // 0.1 USDT burn amount (6 decimals)
          token: SOL_USDT_TOKEN,
        },
      };

      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      console.log('Calling tx.wait() - polling for external chain details...');
      const receipt = await tx.wait();

      console.log(`Receipt status: ${receipt.status}`);
      console.log(`External TX Hash: ${receipt.externalTxHash}`);

      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 600000);

    it('S-4.5: should drain SOL (hybrid) with Push Chain payload', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: S-4.5 SOL Hybrid Self-Call + Payload ===');
      console.log('SVM gateway auto-drains all CEA PDA balance — no extra SDK logic needed');

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
        to: ueaAddress,
        value: BigInt(1_000_000), // 0.001 SOL burn amount
        data: '0xdeadbeef', // arbitrary Push Chain payload
      };

      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      console.log('Calling tx.wait() - polling for external chain details...');
      const receipt = await tx.wait();

      console.log(`Receipt status: ${receipt.status}`);
      console.log(`External TX Hash: ${receipt.externalTxHash}`);

      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 600000);

    it('S-4.6: should drain SPL USDT (hybrid) with Push Chain payload', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: S-4.6 SPL Hybrid Self-Call + Payload ===');
      console.log('SVM gateway auto-drains all CEA PDA balance — no extra SDK logic needed');

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
        to: ueaAddress,
        funds: {
          amount: BigInt(100_000), // 0.1 USDT burn amount (6 decimals)
          token: SOL_USDT_TOKEN,
        },
        data: '0xdeadbeef', // arbitrary Push Chain payload
      };

      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      console.log('Calling tx.wait() - polling for external chain details...');
      const receipt = await tx.wait();

      console.log(`Receipt status: ${receipt.status}`);
      console.log(`External TX Hash: ${receipt.externalTxHash}`);

      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 600000);
  });

  // ============================================================================
  // Error Handling
  // ============================================================================
  describe('Error Handling', () => {
    it('should detect CEA_TO_CEA (not Route 3) when from is SVM and to is external', () => {
      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
        to: {
          address: '0x1234567890123456789012345678901234567890',
          chain: CHAIN.ETHEREUM_SEPOLIA,
        } as ChainTarget,
        value: BigInt(10_000_000),
      };

      // This is Route 4 (CEA_TO_CEA), not Route 3
      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_CEA);
    });
  });

  // ============================================================================
  // Progress Hooks
  // ============================================================================
  describe('Progress Hooks', () => {
    it('should emit correct hooks for CEA-to-UEA SOL flow (Route 3)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Progress Hooks (CEA-to-UEA SOL) ===');

      const events: ProgressEvent[] = [];

      const originChain = CHAIN.ETHEREUM_SEPOLIA;
      const account = privateKeyToAccount(privateKey);
      const walletClient = createWalletClient({
        account,
        transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
      });

      const universalSigner =
        await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
          chain: originChain,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        });

      const clientWithHook = await PushChain.initialize(universalSigner, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        progressHook: (event: ProgressEvent) => {
          events.push(event);
          console.log(`[HOOK] ${event.id}: ${event.title}`);
        },
      });

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
        to: clientWithHook.universal.account,
        value: BigInt(1_000_000), // 0.001 SOL
      };

      const tx = await clientWithHook.universal.sendTransaction(params);

      // Verify we got progress events
      expect(events.length).toBeGreaterThan(0);

      // Verify key events were emitted
      expect(events.some((e) => e.id === 'SEND-TX-01')).toBe(true);
      expect(events.some((e) => e.id.startsWith('SEND-TX-99'))).toBe(true);

      // Wait for outbound relay and verify external chain details
      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 600000);
  });

  // ============================================================================
  // Cascade Tests
  // ============================================================================
  describe('Cascade Tests', () => {
    it('should execute CPI on Solana then drain SOL back (SVM round-trip cascade)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Cascade — CPI + SOL Drain Back ===');

      // Hop 1 (Route 2): CPI execution on Solana
      const ixData = buildReceiveSolIxData(BigInt(0));
      const tx1 = await pushClient.universal.prepareTransaction({
        to: {
          address: TEST_PROGRAM,
          chain: CHAIN.SOLANA_DEVNET,
        },
        data: toHexData(ixData),
      });

      // Hop 2 (Route 3): Drain SOL back from Solana to Push Chain
      const tx2 = await pushClient.universal.prepareTransaction({
        from: { chain: CHAIN.SOLANA_DEVNET },
        to: ueaAddress,
        value: BigInt(1_000_000), // 0.001 SOL
      });

      const result = await pushClient.universal.executeTransactions([tx1, tx2]);

      console.log(`Initial TX Hash: ${result.initialTxHash}`);
      console.log(`Hop count: ${result.hopCount}`);

      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(result.hopCount).toBeGreaterThanOrEqual(2);

      const completion = await result.waitForAll({
        timeout: 900000,
        progressHook: (event) => {
          console.log(`[waitForAll] hop ${event.hopIndex} status: ${event.status}`);
        },
      });

      expect(completion.success).toBe(true);
    }, 900000);

    it('should drain SOL from Solana then send SOL to Solana (round-trip cascade)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Cascade — SOL Drain + SOL Send ===');

      // Hop 1 (Route 3): Drain SOL from Solana
      const tx1 = await pushClient.universal.prepareTransaction({
        from: { chain: CHAIN.SOLANA_DEVNET },
        to: ueaAddress,
        value: BigInt(1_000_000), // 0.001 SOL
      });

      // Hop 2 (Route 2): Send SOL to Solana
      const tx2 = await pushClient.universal.prepareTransaction({
        to: {
          address: TEST_SOL_TARGET,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(1_000_000), // 0.001 SOL
      });

      const result = await pushClient.universal.executeTransactions([tx1, tx2]);

      console.log(`Initial TX Hash: ${result.initialTxHash}`);
      console.log(`Hop count: ${result.hopCount}`);

      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(result.hopCount).toBeGreaterThanOrEqual(2);

      const completion = await result.waitForAll({
        timeout: 900000,
        progressHook: (event) => {
          console.log(`[waitForAll] hop ${event.hopIndex} status: ${event.status}`);
        },
      });

      expect(completion.success).toBe(true);
    }, 900000);

    it('should drain SPL from Solana then send SOL to Solana (mixed asset cascade)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Cascade — SPL Drain + SOL Send ===');

      // Hop 1 (Route 3): Drain SPL USDT from Solana
      const tx1 = await pushClient.universal.prepareTransaction({
        from: { chain: CHAIN.SOLANA_DEVNET },
        to: ueaAddress,
        funds: {
          amount: BigInt(100_000), // 0.1 USDT
          token: SOL_USDT_TOKEN,
        },
      });

      // Hop 2 (Route 2): Send SOL to Solana
      const tx2 = await pushClient.universal.prepareTransaction({
        to: {
          address: TEST_SOL_TARGET,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(1_000_000), // 0.001 SOL
      });

      const result = await pushClient.universal.executeTransactions([tx1, tx2]);

      console.log(`Initial TX Hash: ${result.initialTxHash}`);
      console.log(`Hop count: ${result.hopCount}`);

      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(result.hopCount).toBeGreaterThanOrEqual(2);

      const completion = await result.waitForAll({
        timeout: 900000,
        progressHook: (event) => {
          console.log(`[waitForAll] hop ${event.hopIndex} status: ${event.status}`);
        },
      });

      expect(completion.success).toBe(true);
    }, 900000);

    it('should drain SOL + counter then send SOL to Solana (payload + cascade)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Cascade — SOL Drain with Payload + SOL Send ===');

      const pushPayload = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });

      // Hop 1 (Route 3): Drain SOL with Push Chain counter increment
      const tx1 = await pushClient.universal.prepareTransaction({
        from: { chain: CHAIN.SOLANA_DEVNET },
        to: COUNTER_ADDRESS_PAYABLE,
        value: BigInt(1_000_000), // 0.001 SOL
        data: pushPayload,
      });

      // Hop 2 (Route 2): Send SOL to Solana
      const tx2 = await pushClient.universal.prepareTransaction({
        to: {
          address: TEST_SOL_TARGET,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(1_000_000), // 0.001 SOL
      });

      const result = await pushClient.universal.executeTransactions([tx1, tx2]);

      console.log(`Initial TX Hash: ${result.initialTxHash}`);
      console.log(`Hop count: ${result.hopCount}`);

      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(result.hopCount).toBeGreaterThanOrEqual(2);

      const completion = await result.waitForAll({
        timeout: 900000,
        progressHook: (event) => {
          console.log(`[waitForAll] hop ${event.hopIndex} status: ${event.status}`);
        },
      });

      expect(completion.success).toBe(true);
    }, 900000);

    it('should drain SOL from Solana then increment EVM counter (cross-VM cascade)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Cascade — SOL Drain + EVM Counter Increment ===');

      const incrementPayload = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });

      // Hop 1 (Route 3): Drain SOL from Solana
      const tx1 = await pushClient.universal.prepareTransaction({
        from: { chain: CHAIN.SOLANA_DEVNET },
        to: ueaAddress,
        value: BigInt(1_000_000), // 0.001 SOL
      });

      // Hop 2 (Route 2): Increment counter on Ethereum Sepolia
      const tx2 = await pushClient.universal.prepareTransaction({
        to: {
          address: '0xF1552eD5ac48C273570500bD10b10C00E1C418bB' as `0x${string}`, // Sepolia counter
          chain: CHAIN.ETHEREUM_SEPOLIA,
        },
        data: incrementPayload,
      });

      const result = await pushClient.universal.executeTransactions([tx1, tx2]);

      console.log(`Initial TX Hash: ${result.initialTxHash}`);
      console.log(`Hop count: ${result.hopCount}`);

      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(result.hopCount).toBeGreaterThanOrEqual(2);

      const completion = await result.waitForAll({
        timeout: 900000,
        progressHook: (event) => {
          console.log(`[waitForAll] hop ${event.hopIndex} status: ${event.status}`);
        },
      });

      expect(completion.success).toBe(true);
    }, 900000);
  });
});
