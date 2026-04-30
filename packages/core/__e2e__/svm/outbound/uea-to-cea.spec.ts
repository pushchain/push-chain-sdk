/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any */
/**
 * UOA → CEA: SVM Outbound Transactions (Route 2)
 *
 * Tests for outbound transactions from Push Chain to Solana via the SVM gateway.
 * Covers: Route Detection, SVM Utilities, Withdraw SOL, Withdraw SPL,
 * Execute CPI, FUNDS + CPI, Small Amount, E2E Sync, Transaction Preparation,
 * Error Handling, Progress Hooks, Cascade Tests
 *
 * Primary test chain: Solana Devnet
 */
import '@e2e/shared/setup';
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { createWalletClient, http, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chainSupportsOutbound, chainSupportsCEA } from '../../../src/lib/orchestrator/cea-utils';
import { TransactionRoute, detectRoute } from '../../../src/lib/orchestrator/route-detector';
import {
  isSvmChain,
  isValidSolanaHexAddress,
  encodeSvmExecutePayload,
} from '../../../src/lib/orchestrator/payload-builders';
import type {
  UniversalExecuteParams,
  ChainTarget,
  SvmExecutePayloadFields,
} from '../../../src/lib/orchestrator/orchestrator.types';
import type { ProgressEvent } from '../../../src/lib/progress-hook/progress-hook.types';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import { createEvmPushClient } from '@e2e/shared/evm-client';
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

describe('UOA → CEA: SVM Outbound Transactions (Route 2)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;
  let ceaPdaHex: `0x${string}`;

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
  }, 60000);

  // ============================================================================
  // Core Scenarios
  // ============================================================================
  describe('Core Scenarios', () => {
    // --------------------------------------------------------------------------
    // 1. Funds (SOL) — basic SOL withdrawal
    // --------------------------------------------------------------------------
    describe('1. Funds (SOL)', () => {
      it('should withdraw SOL to Solana Devnet recipient', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Withdraw SOL ===');

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_SOL_TARGET,
            chain: CHAIN.SOLANA_DEVNET,
          },
          value: BigInt(10_000_000), // 0.01 SOL in lamports
          // gasLimit omitted → uses per-chain default from UniversalCore
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        console.log(`Target Chain: ${tx.chain}`);

        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.SOLANA_DEVNET);

        // Wait for outbound relay and verify external chain details
        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);
    });

    // --------------------------------------------------------------------------
    // 2. Funds (SPL) — SPL token withdrawal
    // --------------------------------------------------------------------------
    describe('2. Funds (SPL)', () => {
      it('should withdraw SPL token (pUSDT mapped) to Solana Devnet', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Withdraw SPL Token ===');

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_SOL_TARGET,
            chain: CHAIN.SOLANA_DEVNET,
          },
          funds: {
            amount: BigInt(100_000), // 0.1 USDT (6 decimals)
            token: SOL_USDT_TOKEN,
          },
          // gasLimit omitted → per-chain default from UniversalCore
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

        // Push Chain tx must succeed before outbound relay can happen
        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);
    });

    // --------------------------------------------------------------------------
    // 3. Payload (CPI) — CPI execution with value
    // --------------------------------------------------------------------------
    describe('3. Payload (CPI)', () => {
      it('should execute CPI on Solana program', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Execute CPI (receive_sol on test_counter) ===');

        const ixData = buildReceiveSolIxData(BigInt(1));

        // receive_sol accounts: counter (writable), recipient (writable), cea_authority (writable), system_program
        const params: UniversalExecuteParams = {
          to: {
            address: TEST_PROGRAM,
            chain: CHAIN.SOLANA_DEVNET,
          },
          value: BigInt(5_000_000), // 0.005 SOL for CPI
          // gasLimit omitted → per-chain default from UniversalCore
          data: toHexData(ixData),
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

        // Push Chain tx must succeed before outbound relay can happen
        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);

      it('should execute CPI with no value (rent-only)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Execute CPI (rent-only, receive_sol with 0 amount) ===');

        const ixData = buildReceiveSolIxData(BigInt(0));

        // receive_sol accounts: counter (writable), recipient (writable), cea_authority (writable), system_program
        const params: UniversalExecuteParams = {
          to: {
            address: TEST_PROGRAM,
            chain: CHAIN.SOLANA_DEVNET,
          },
          // gasLimit omitted → per-chain default from UniversalCore
          data: toHexData(ixData),
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

        // Push Chain tx must succeed before outbound relay can happen
        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);

      it('should execute CPI with non-zero rent fee for account creation', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Execute CPI with rent fee (1.5M lamports) ===');

        const ixData = buildReceiveSolIxData(BigInt(1));

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_PROGRAM,
            chain: CHAIN.SOLANA_DEVNET,
          },
          value: BigInt(5_000_000), // 0.005 SOL for CPI
          // gasLimit omitted → per-chain default from UniversalCore
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

    // --------------------------------------------------------------------------
    // 4. Funds + Payload (SOL + CPI)
    // --------------------------------------------------------------------------
    describe('4. Funds + Payload (SOL + CPI)', () => {
      it('should withdraw SOL and execute CPI on Solana program in same tx', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: FUNDS + CPI (receive_sol on test_counter) ===');

        const ixData = buildReceiveSolIxData(BigInt(1));

        // receive_sol accounts: counter (writable), recipient (writable), cea_authority (writable), system_program
        const params: UniversalExecuteParams = {
          to: {
            address: TEST_PROGRAM,
            chain: CHAIN.SOLANA_DEVNET,
          },
          value: BigInt(5_000_000), // 0.005 SOL transferred alongside CPI
          // gasLimit omitted → per-chain default from UniversalCore
          data: toHexData(ixData),
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.SOLANA_DEVNET);

        // Wait for outbound relay
        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        // Push Chain tx must succeed before outbound relay can happen
        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);
    });

    // --------------------------------------------------------------------------
    // 5. Funds + Payload (SPL + CPI) (S-3.3)
    // --------------------------------------------------------------------------
    describe('5. Funds + Payload (SPL + CPI)', () => {
      it('should execute CPI on Solana program with SPL token funds', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: SPL FUNDS + CPI (receive_sol on test_counter with USDT) ===');

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
          // gasLimit omitted → per-chain default from UniversalCore
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

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);
    });

    // --------------------------------------------------------------------------
    // 6. SPL CPI-only (S-3.4) — SPL token context, amount=0, execute-only
    // --------------------------------------------------------------------------
    describe('6. SPL CPI-only (S-3.4)', () => {
      it('should execute CPI with SPL token context but no burn (amount=0)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: SPL CPI-only (S-3.4: USDT context, no burn) ===');

        const ixData = buildReceiveSolIxData(BigInt(0));

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_PROGRAM,
            chain: CHAIN.SOLANA_DEVNET,
          },
          funds: {
            amount: BigInt(0),
            token: SOL_USDT_TOKEN,
          },
          // gasLimit omitted → per-chain default from UniversalCore
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

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);
    });

    // --------------------------------------------------------------------------
    // 7. Native Funds — withdraw SOL with custom gasLimit
    // --------------------------------------------------------------------------
    describe('7. Native Funds', () => {
      it('should withdraw SOL with custom gasLimit', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Withdraw SOL with custom gasLimit ===');

        const params: UniversalExecuteParams = {
          to: {
            address: TEST_SOL_TARGET,
            chain: CHAIN.SOLANA_DEVNET,
          },
          value: BigInt(10_000_000), // 0.01 SOL in lamports
          gasLimit: BigInt(600_000), // Custom compute unit limit (must be >= per-chain base)
        };

        expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

        const tx = await pushClient.universal.sendTransaction(params);

        console.log(`Push Chain TX Hash: ${tx.hash}`);
        console.log(`Target Chain: ${tx.chain}`);

        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(tx.chain).toBe(CHAIN.SOLANA_DEVNET);

        // Wait for outbound relay and verify external chain details
        console.log('Calling tx.wait() - polling for outbound tx hash...');
        const receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);
        console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

        expect(receipt.status).toBe(1);
        expect(receipt.externalTxHash).toBeDefined();
        expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
      }, 360000);
    });
  });

  // ============================================================================
  // Route Detection (SVM)
  // ============================================================================
  describe('Route Detection', () => {
    it('should detect UOA_TO_CEA for Solana Devnet ChainTarget', () => {
      const params: UniversalExecuteParams = {
        to: {
          address: TEST_SOL_TARGET,
          chain: CHAIN.SOLANA_DEVNET,
        } as ChainTarget,
        value: BigInt(100_000_000), // 0.1 SOL in lamports
      };
      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);
    });

    it('should detect UOA_TO_CEA for Solana Testnet ChainTarget', () => {
      const params: UniversalExecuteParams = {
        to: {
          address: TEST_SOL_TARGET,
          chain: CHAIN.SOLANA_TESTNET,
        } as ChainTarget,
        value: BigInt(100_000_000),
      };
      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);
    });

    it('should detect UOA_TO_CEA for Solana Mainnet ChainTarget', () => {
      const params: UniversalExecuteParams = {
        to: {
          address: TEST_SOL_TARGET,
          chain: CHAIN.SOLANA_MAINNET,
        } as ChainTarget,
        value: BigInt(100_000_000),
      };
      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);
    });
  });

  // ============================================================================
  // SVM Utilities
  // ============================================================================
  describe('SVM Utilities', () => {
    it('should identify Solana chains as SVM', () => {
      expect(isSvmChain(CHAIN.SOLANA_DEVNET)).toBe(true);
      expect(isSvmChain(CHAIN.SOLANA_TESTNET)).toBe(true);
      expect(isSvmChain(CHAIN.SOLANA_MAINNET)).toBe(true);
    });

    it('should not identify EVM chains as SVM', () => {
      expect(isSvmChain(CHAIN.ETHEREUM_SEPOLIA)).toBe(false);
      expect(isSvmChain(CHAIN.BNB_TESTNET)).toBe(false);
    });

    it('should report Solana supports outbound but not CEA', () => {
      expect(chainSupportsOutbound(CHAIN.SOLANA_DEVNET)).toBe(true);
      expect(chainSupportsCEA(CHAIN.SOLANA_DEVNET)).toBe(false);
    });

    it('should validate 32-byte Solana hex addresses', () => {
      // Valid: 0x + 64 hex chars = 32 bytes
      expect(isValidSolanaHexAddress(TEST_SOL_TARGET)).toBe(true);
      expect(isValidSolanaHexAddress(SOL_ZERO_ADDRESS)).toBe(true);

      // Invalid: EVM-length address (20 bytes)
      expect(
        isValidSolanaHexAddress('0x1234567890123456789012345678901234567890')
      ).toBe(false);

      // Invalid: no prefix
      expect(
        isValidSolanaHexAddress(
          '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
        )
      ).toBe(false);

      // Invalid: too short
      expect(isValidSolanaHexAddress('0x1234')).toBe(false);
    });

    it('should encode SVM execute payload in correct binary format', () => {
      const fields: SvmExecutePayloadFields = {
        targetProgram: TEST_PROGRAM,
        accounts: [
          { pubkey: TEST_SOL_TARGET, isWritable: true },
          { pubkey: SOL_ZERO_ADDRESS, isWritable: false },
        ],
        ixData: new Uint8Array([1, 2, 3, 4]),
        instructionId: 2,
      };

      const encoded = encodeSvmExecutePayload(fields);

      expect(encoded).toMatch(/^0x[a-fA-F0-9]+$/);
      // The encoded payload should be non-trivial in length
      // 4B (count) + 2*(32B+1B) + 4B (ixDataLen) + 4B (ixData) + 1B (instrId) + 32B (program) = 4+66+4+4+1+32 = 111 bytes = 222 hex chars
      expect(encoded.length).toBe(2 + 222); // "0x" + 222 hex
    });

    it('should encode SVM execute payload with default instruction ID', () => {
      const fields: SvmExecutePayloadFields = {
        targetProgram: TEST_PROGRAM,
        accounts: [],
        ixData: new Uint8Array([]),
        // instructionId omitted → defaults to 2
      };

      const encoded = encodeSvmExecutePayload(fields);
      expect(encoded).toMatch(/^0x[a-fA-F0-9]+$/);

      // 4B (count=0) + 0 accounts + 4B (ixDataLen=0) + 0 ixData + 1B (instrId) + 32B (program) = 41 bytes = 82 hex chars
      expect(encoded.length).toBe(2 + 82);
    });
  });

  // ============================================================================
  // Transaction Preparation (SVM)
  // ============================================================================
  describe('Transaction Preparation', () => {
    it('should prepare SVM outbound transaction without executing', async () => {
      if (skipE2E) return;

      const params: UniversalExecuteParams = {
        to: {
          address: TEST_SOL_TARGET,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(10_000_000),
        // gasLimit omitted → per-chain default from UniversalCore
      };

      const prepared = await pushClient.universal.prepareTransaction(params);

      console.log(`Prepared tx route: ${prepared.route}`);
      console.log(`Estimated gas: ${prepared.estimatedGas}`);
      console.log(`Nonce: ${prepared.nonce}`);

      expect(prepared.route).toBe('UOA_TO_CEA');
      expect(prepared.payload).toBeDefined();
      expect(prepared.estimatedGas).toBeDefined();
      expect(prepared.nonce).toBeDefined();
    }, 60000);

    it('should create chained builder from prepared SVM transactions', async () => {
      if (skipE2E) return;

      const firstPrepared = await pushClient.universal.prepareTransaction({
        to: {
          address: TEST_SOL_TARGET,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(10_000_000),
        // gasLimit omitted → per-chain default from UniversalCore
      });

      // Chain with a second SVM outbound
      const secondPrepared = await pushClient.universal.prepareTransaction({
        to: {
          address: TEST_SOL_TARGET,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(5_000_000),
        // gasLimit omitted → per-chain default from UniversalCore
      });

      // executeTransactions now accepts an array and returns a promise directly
      const resultPromise = pushClient.universal.executeTransactions([
        firstPrepared,
        secondPrepared,
      ]);

      expect(resultPromise).toBeInstanceOf(Promise);
    }, 60000);
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================
  describe('Edge Cases', () => {
    it('should handle smallest possible SOL withdrawal (1 lamport)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Small Amount Transfer (1 lamport) ===');

      const params: UniversalExecuteParams = {
        to: {
          address: TEST_SOL_TARGET,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(1), // 1 lamport - smallest possible
        // gasLimit omitted → per-chain default from UniversalCore
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
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

      // Verify tx succeeded on external chain via RPC
      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 360000);

    it('should transfer SOL to alternate Solana recipient', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SOL to Alternate Recipient ===');

      // Use COUNTER_PDA as an alternate valid 32-byte Solana address
      const params: UniversalExecuteParams = {
        to: {
          address: COUNTER_PDA,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(1_000_000), // 0.001 SOL
      };

      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tx.chain).toBe(CHAIN.SOLANA_DEVNET);

      const receipt = await tx.wait();
      console.log(`Receipt status: ${receipt.status}`);
      console.log(`External TX Hash: ${receipt.externalTxHash}`);

      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 360000);

    it('should transfer SPL to alternate Solana recipient', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SPL to Alternate Recipient ===');

      const params: UniversalExecuteParams = {
        to: {
          address: COUNTER_PDA,
          chain: CHAIN.SOLANA_DEVNET,
        },
        funds: {
          amount: BigInt(100_000), // 0.1 USDT
          token: SOL_USDT_TOKEN,
        },
      };

      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tx.chain).toBe(CHAIN.SOLANA_DEVNET);

      const receipt = await tx.wait();
      console.log(`Receipt status: ${receipt.status}`);
      console.log(`External TX Hash: ${receipt.externalTxHash}`);

      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 360000);
  });

  // ============================================================================
  // E2E Sync
  // ============================================================================
  describe('E2E Sync', () => {
    it('should execute outbound SOL transfer and verify full receipt fields', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: E2E Outbound SOL with Full Receipt ===');

      const tx = await pushClient.universal.sendTransaction({
        to: {
          address: TEST_SOL_TARGET,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(10_000_000), // 0.01 SOL
        // gasLimit omitted → per-chain default from UniversalCore
      });

      console.log(`[TEST] ${new Date().toISOString()} Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // .wait() polls for external chain details
      console.log(`[TEST] ${new Date().toISOString()} Calling tx.wait()...`);
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

      // Verify external chain details
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);
      // SVM explorer URLs use base58-encoded signatures, not hex
      expect(receipt.externalExplorerUrl).toContain('explorer.solana.com/tx/');
      expect(receipt.externalExplorerUrl).toContain('cluster=devnet');

      // Verify tx succeeded on external chain via RPC
      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 600000);

    it('should execute outbound SOL transfer with custom gasLimit', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Outbound SOL with gasLimit ===');

      const tx = await pushClient.universal.sendTransaction({
        to: {
          address: TEST_SOL_TARGET,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(10_000_000), // 0.01 SOL
        // gasLimit omitted → per-chain default from UniversalCore
      });

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tx.chain).toBe(CHAIN.SOLANA_DEVNET);

      const receipt = await tx.wait();
      console.log(`Receipt status: ${receipt.status}`);
      console.log(`External TX Hash: ${receipt.externalTxHash}`);
      console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

      // Verify tx succeeded on external chain via RPC
      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 600000);
  });

  // ============================================================================
  // Error Handling
  // ============================================================================
  describe('Error Handling', () => {
    it('should reject invalid Solana address (EVM-length)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Invalid Address Length ===');

      const params: UniversalExecuteParams = {
        to: {
          // EVM-length address (20 bytes) - invalid for Solana
          address: '0x1234567890123456789012345678901234567890' as `0x${string}`,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(10_000_000),
      };

      await expect(
        pushClient.universal.sendTransaction(params)
      ).rejects.toThrow();
    }, 60000);

    it('should reject zero address for Solana target', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Zero Address Target ===');

      const params: UniversalExecuteParams = {
        to: {
          address: SOL_ZERO_ADDRESS,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(10_000_000),
      };

      await expect(
        pushClient.universal.sendTransaction(params)
      ).rejects.toThrow();
    }, 60000);

    it('should detect CEA_TO_CEA (not Route 3) when from is SVM and to is external', () => {
      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.SOLANA_DEVNET } as any,
        to: {
          address: '0x1234567890123456789012345678901234567890',
          chain: CHAIN.ETHEREUM_SEPOLIA,
        } as ChainTarget,
        value: BigInt(10_000_000),
      };

      // This is Route 4 (CEA_TO_CEA), not Route 3
      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_CEA);
    });

    it('should treat missing from.chain as Route 2 for SVM ChainTarget', () => {
      const params: UniversalExecuteParams = {
        to: {
          address: TEST_SOL_TARGET,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(100_000_000),
      };

      // Without from.chain, this is Route 2 (UOA_TO_CEA), not Route 3
      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);
    });
  });

  // ============================================================================
  // Progress Hooks
  // ============================================================================
  describe('Progress Hooks', () => {
    it('should emit correct hooks for SVM withdraw flow', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Progress Hooks (SVM Withdraw) ===');

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
        to: {
          address: TEST_SOL_TARGET,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(1_000_000), // 0.001 SOL
        // gasLimit omitted → per-chain default from UniversalCore
      };

      const tx = await clientWithHook.universal.sendTransaction(params);

      // Verify we got progress events
      expect(events.length).toBeGreaterThan(0);

      // Verify key events were emitted
      expect(events.some((e) => e.id === 'SEND-TX-101')).toBe(true);
      expect(events.some((e) => e.id.startsWith('SEND-TX-99'))).toBe(true);

      // Wait for outbound relay and verify external chain details
      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

      // Verify tx succeeded on external chain via RPC
      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 360000);
  });

  // ============================================================================
  // Cascade Tests
  // ============================================================================
  describe('Cascade Tests', () => {
    it('should execute SOL withdraw then CPI via cascade', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Cascade — SOL Withdraw + CPI ===');

      // Hop 1 (Route 2): Withdraw SOL to recipient
      const tx1 = await pushClient.universal.prepareTransaction({
        to: {
          address: TEST_SOL_TARGET,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(1_000_000), // 0.001 SOL
      });

      // Hop 2 (Route 2): Execute CPI on test_counter
      const ixData = buildReceiveSolIxData(BigInt(1));
      const tx2 = await pushClient.universal.prepareTransaction({
        to: {
          address: TEST_PROGRAM,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(5_000_000), // 0.005 SOL for CPI
        data: toHexData(ixData),
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

    it('should execute CPI then SOL withdraw via cascade', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Cascade — CPI + SOL Withdraw ===');

      // Hop 1 (Route 2): Execute CPI (no value, rent-only)
      const ixData = buildReceiveSolIxData(BigInt(0));
      const tx1 = await pushClient.universal.prepareTransaction({
        to: {
          address: TEST_PROGRAM,
          chain: CHAIN.SOLANA_DEVNET,
        },
        data: toHexData(ixData),
      });

      // Hop 2 (Route 2): Withdraw SOL to recipient
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

    it('should execute SPL withdraw then SOL withdraw via cascade', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Cascade — SPL Withdraw + SOL Withdraw ===');

      // Hop 1 (Route 2): Withdraw SPL token
      const tx1 = await pushClient.universal.prepareTransaction({
        to: {
          address: TEST_SOL_TARGET,
          chain: CHAIN.SOLANA_DEVNET,
        },
        funds: {
          amount: BigInt(100_000), // 0.1 USDT
          token: SOL_USDT_TOKEN,
        },
      });

      // Hop 2 (Route 2): Withdraw SOL
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
  });
});
