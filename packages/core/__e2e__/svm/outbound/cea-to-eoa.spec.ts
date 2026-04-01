/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any */
/**
 * CEA → EOA: SVM Inbound Transactions (Route 3)
 *
 * Tests for inbound transactions from Solana back to Push Chain,
 * targeting an EOA (Push Chain native account) signer (PUSH_PRIVATE_KEY).
 * Covers: Funds (SOL/SPL), Payload execution on Push Chain
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
  ChainSource,
} from '../../../src/lib/orchestrator/orchestrator.types';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import {
  COUNTER_ADDRESS_PAYABLE,
  COUNTER_ABI_PAYABLE,
} from '@e2e/shared/inbound-helpers';
import { COUNTER_ABI } from '@e2e/shared/outbound-helpers';
import {
  SOL_USDT_TOKEN,
  deriveCeaPda,
} from '@e2e/shared/svm-outbound-helpers';

describe('CEA → EOA: SVM Inbound Transactions (Route 3)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let eoaAddress: `0x${string}`;
  let ceaPdaHex: `0x${string}`;
  let pushPublicClient: ReturnType<typeof createPublicClient>;

  const privateKey = process.env['PUSH_PRIVATE_KEY'] as Hex;
  const skipE2E = !privateKey;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping E2E tests - PUSH_PRIVATE_KEY not set');
      return;
    }

    const originChain = CHAIN.PUSH_TESTNET_DONUT;
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

    pushClient = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      printTraces: true,
      progressHook: (val: any) => {
        console.log(`[${val.id}] ${val.title}`);
      },
    });

    eoaAddress = pushClient.universal.account;
    console.log(`Push EOA Address: ${eoaAddress}`);

    const derived = deriveCeaPda(eoaAddress);
    ceaPdaHex = derived.ceaPdaHex;
    console.log(`CEA PDA: ${derived.ceaPda.toBase58()}`);
    console.log(`CEA PDA Hex: ${ceaPdaHex}`);

    pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
  }, 60000);

  // ============================================================================
  // Core Scenarios
  // ============================================================================
  describe('Core Scenarios', () => {
    // ============================================================================
    // 1. Funds (SOL) — drain SOL to EOA
    // ============================================================================
    describe('1. Funds (SOL)', () => {
      it('should drain SOL from Solana gateway back to EOA on Push Chain', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: EOA CEA-to-UEA SOL (Route 3) ===');

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
          to: eoaAddress,
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
    // 2. Funds (SPL) — drain SPL to EOA
    // ============================================================================
    describe('2. Funds (SPL)', () => {
      it('should drain SPL token (USDT) from Solana gateway back to EOA on Push Chain', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: EOA CEA-to-UEA SPL (Route 3) ===');

        const params: UniversalExecuteParams = {
          from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
          to: eoaAddress,
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
    // 3. SOL + Payload — drain SOL to EOA with counter payload
    // ============================================================================
    describe('3. SOL + Payload', () => {
      it('should drain SOL to EOA with Push Chain counter payload', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: EOA SOL + Counter Payload (Route 3) ===');

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
    // 4. SPL + Payload — drain SPL to EOA with counter payload
    // ============================================================================
    describe('4. SPL + Payload', () => {
      it('should drain SPL to EOA with Push Chain counter payload', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: EOA SPL + Counter Payload (Route 3) ===');

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
  });
});
