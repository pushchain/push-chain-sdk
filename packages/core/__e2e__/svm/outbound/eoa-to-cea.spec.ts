/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any */
/**
 * EOA → CEA: SVM Outbound Transactions (Route 2)
 *
 * Tests for outbound transactions from Push Chain native EOA account to Solana.
 * Covers: Withdraw SOL, Withdraw SPL, Execute CPI, Funds + CPI
 *
 * Primary test chain: Solana Devnet
 */
import '@e2e/shared/setup';
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { createWalletClient, http, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { TransactionRoute, detectRoute } from '../../../src/lib/orchestrator/route-detector';
import type { UniversalExecuteParams } from '../../../src/lib/orchestrator/orchestrator.types';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import {
  TEST_SOL_TARGET,
  SOL_ZERO_ADDRESS,
  TEST_PROGRAM,
  COUNTER_PDA,
  SOL_USDT_TOKEN,
  deriveCeaPda,
  buildReceiveSolAccounts,
  buildReceiveSolIxData,
  toHexData,
} from '@e2e/shared/svm-outbound-helpers';

describe('EOA → CEA: SVM Outbound Transactions (Route 2)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let eoaAddress: `0x${string}`;
  let ceaPdaHex: `0x${string}`;

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
  }, 60000);

  // ============================================================================
  // Core Scenarios
  // ============================================================================
  describe('Core Scenarios', () => {
    // ============================================================================
    // 1. Funds (SOL) — withdraw SOL from Push EOA
    // ============================================================================
    describe('1. Funds (SOL)', () => {
      it('should withdraw SOL to Solana Devnet from Push EOA', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: EOA Withdraw SOL (Route 2) ===');

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_SOL_TARGET,
            chain: CHAIN.SOLANA_DEVNET,
          },
          value: BigInt(10_000_000), // 0.01 SOL in lamports
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.SOLANA_DEVNET);

        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);
    });

    // ============================================================================
    // 2. Funds (SPL) — withdraw SPL from Push EOA
    // ============================================================================
    describe('2. Funds (SPL)', () => {
      it('should withdraw SPL token (pUSDT mapped) to Solana Devnet from Push EOA', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: EOA Withdraw SPL Token (Route 2) ===');

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_SOL_TARGET,
            chain: CHAIN.SOLANA_DEVNET,
          },
          funds: {
            amount: BigInt(100_000), // 0.1 USDT (6 decimals)
            token: SOL_USDT_TOKEN,
          },
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.SOLANA_DEVNET);

        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);
    });

    // ============================================================================
    // 3. Payload (CPI) — execute CPI from Push EOA (no funds)
    // ============================================================================
    describe('3. Payload (CPI)', () => {
      it('should execute CPI on Solana program from Push EOA (no funds)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: EOA Execute CPI (Route 2, no funds) ===');

        const ixData = buildReceiveSolIxData(BigInt(0));

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_PROGRAM,
            chain: CHAIN.SOLANA_DEVNET,
          },
          data: toHexData(ixData),
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
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);
    });

    // ============================================================================
    // 4. Funds + Payload (SPL + CPI) — SPL + CPI from Push EOA
    // ============================================================================
    describe('4. Funds + Payload (SPL + CPI)', () => {
      it('should execute CPI with SPL token funds from Push EOA', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: EOA SPL Funds + CPI (Route 2) ===');

        const ixData = buildReceiveSolIxData(BigInt(1));

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_PROGRAM,
            chain: CHAIN.SOLANA_DEVNET,
          },
          funds: {
            amount: BigInt(100_000), // 0.1 USDT (6 decimals)
            token: SOL_USDT_TOKEN,
          },
          data: toHexData(ixData),
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.SOLANA_DEVNET);

        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);
    });

    // ============================================================================
    // 5. Funds + Payload (SOL + CPI) — SOL + CPI from Push EOA
    // ============================================================================
    describe('5. Funds + Payload (SOL + CPI)', () => {
      it('should execute CPI with SOL funds from Push EOA', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: EOA SOL Funds + CPI (Route 2) ===');

        const ixData = buildReceiveSolIxData(BigInt(1));

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_PROGRAM,
            chain: CHAIN.SOLANA_DEVNET,
          },
          value: BigInt(5_000_000), // 0.005 SOL for CPI
          data: toHexData(ixData),
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.SOLANA_DEVNET);

        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);
    });

    // ============================================================================
    // 6. Native Funds — SOL value-only from Push EOA
    // ============================================================================
    describe('6. Native Funds', () => {
      it('should withdraw SOL (value-only) to Solana from Push EOA', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: EOA Native Funds (SOL value-only, Route 2) ===');

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_SOL_TARGET,
            chain: CHAIN.SOLANA_DEVNET,
          },
          value: BigInt(5_000_000), // 0.005 SOL
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.SOLANA_DEVNET);

        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);
    });

    // ============================================================================
    // 7. Native Funds + CPI — SOL + CPI from Push EOA
    // ============================================================================
    describe('7. Native Funds + CPI', () => {
      it('should withdraw SOL and execute CPI from Push EOA', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: EOA Native Funds + CPI (Route 2) ===');

        const ixData = buildReceiveSolIxData(BigInt(1));

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_PROGRAM,
            chain: CHAIN.SOLANA_DEVNET,
          },
          value: BigInt(5_000_000), // 0.005 SOL
          data: toHexData(ixData),
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.SOLANA_DEVNET);

        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);
    });
  });
});
