/**
 * SVM (Solana) Outbound & Inbound Transactions (Routes 2 & 3)
 *
 * Tests for outbound transactions from Push Chain to Solana via the SVM gateway,
 * and inbound CEA-to-UEA transactions from Solana back to Push Chain.
 *
 * Covers: Route Detection, SVM Utilities, Withdraw SOL, Withdraw SPL,
 * Execute CPI, FUNDS + CPI, Small Amount, E2E Sync, Transaction Preparation,
 * CEA-to-UEA SOL, CEA-to-UEA SPL, Error Handling, Progress Hooks
 *
 * Primary test chain: Solana Devnet
 */
import '@e2e/shared/setup';
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { MOVEABLE_TOKEN_CONSTANTS } from '../../../src/lib/constants/tokens';
import { createWalletClient, http, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PublicKey } from '@solana/web3.js';
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
  ChainSource,
  SvmExecutePayloadFields,
} from '../../../src/lib/orchestrator/orchestrator.types';
import type { ProgressEvent } from '../../../src/lib/progress-hook/progress-hook.types';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';

// 32-byte Solana addresses as 0x-prefixed hex
// Gateway vault PDA on devnet (known existing account)
const TEST_SOL_TARGET =
  '0x6a44bb5ea802a001386a5b39708523e1a3e1bafc8164ffcb94d1f5afa4849c69' as `0x${string}`;

// Zero address for Solana (32 bytes of zeros)
const SOL_ZERO_ADDRESS =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;

// test_counter program deployed on Solana Devnet (8yNqjrMnFiFbVTVQcKij8tNWWTMdFkrDf9abCGgc2sgx)
const TEST_PROGRAM =
  '0x7673075a980bfd5d6b1dffe99c31f63e8938519cc1c2af009dda5e568a94460d' as `0x${string}`;

// Counter PDA (seeds: ["counter"], program: TEST_PROGRAM) = 6Kg1NF5RRytjGwR6USttBLEYJrqwm65xtJzdPbbFwJKg
const COUNTER_PDA =
  '0x4f12fe6816ae7e33ebf7db0b154ec3b09e3bf1a7690481e8e9477d5a278ad3af' as `0x${string}`;

// SVM Gateway program on devnet (for CEA PDA derivation)
const SVM_GATEWAY_PROGRAM = new PublicKey('CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS');

// Solana Devnet USDT token - must use this (not Ethereum USDT) so getPRC20Address maps to USDT_SOL
const SOL_USDT_TOKEN = MOVEABLE_TOKEN_CONSTANTS.SOLANA_DEVNET.USDT;

describe('SVM (Solana) Outbound & Inbound Transactions (Routes 2 & 3)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;
  let ceaPdaHex: `0x${string}`;

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

    ueaAddress = pushClient.universal.account;
    console.log(`UEA Address: ${ueaAddress}`);

    // Derive CEA PDA from UEA (EVM address) for CPI tests
    // Seeds: ["push_identity", sender_evm_address_20_bytes], Program: SVM Gateway
    const senderBytes = Buffer.from(ueaAddress.slice(2), 'hex'); // 20 bytes
    const [ceaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('push_identity'), senderBytes],
      SVM_GATEWAY_PROGRAM
    );
    ceaPdaHex = ('0x' + Buffer.from(ceaPda.toBytes()).toString('hex')) as `0x${string}`;
    console.log(`CEA PDA: ${ceaPda.toBase58()}`);
    console.log(`CEA PDA Hex: ${ceaPdaHex}`);
  }, 60000);

  // ============================================================================
  // 1. Route Detection (SVM)
  // ============================================================================
  describe('1. Route Detection', () => {
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
  // 2. SVM Utilities
  // ============================================================================
  describe('2. SVM Utilities', () => {
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
  // 3. Withdraw SOL
  // ============================================================================
  describe('3. Withdraw SOL', () => {
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

  // ============================================================================
  // 4. Withdraw SPL Token
  // ============================================================================
  describe('4. Withdraw SPL Token', () => {
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

  // ============================================================================
  // 5. Execute CPI
  // ============================================================================
  describe('5. Execute CPI', () => {
    it('should execute CPI on Solana program', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Execute CPI (receive_sol on test_counter) ===');

      // receive_sol discriminator: [121, 244, 250, 3, 8, 229, 225, 1]
      // args: amount (u64 LE) = 1 lamport
      const discriminator = new Uint8Array([121, 244, 250, 3, 8, 229, 225, 1]);
      const amountBuf = new Uint8Array(8);
      new DataView(amountBuf.buffer).setBigUint64(0, BigInt(1), true); // LE
      const ixData = new Uint8Array([...discriminator, ...amountBuf]);

      // receive_sol accounts: counter (writable), recipient (writable), cea_authority (writable), system_program
      const params: UniversalExecuteParams = {
        to: {
          address: TEST_PROGRAM,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(5_000_000), // 0.005 SOL for CPI
        // gasLimit omitted → per-chain default from UniversalCore
        svmExecute: {
          targetProgram: TEST_PROGRAM,
          accounts: [
            { pubkey: COUNTER_PDA, isWritable: true },       // counter PDA
            { pubkey: TEST_SOL_TARGET, isWritable: true },    // recipient
            { pubkey: ceaPdaHex, isWritable: true },           // cea_authority (actual CEA PDA)
            { pubkey: SOL_ZERO_ADDRESS, isWritable: false },   // system_program (0x00...00)
          ],
          ixData,
        },
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

      // receive_sol discriminator + amount=0 (no SOL transfer, just counter increment)
      const discriminator = new Uint8Array([121, 244, 250, 3, 8, 229, 225, 1]);
      const amountBuf = new Uint8Array(8); // 0 amount
      const ixData = new Uint8Array([...discriminator, ...amountBuf]);

      // receive_sol accounts: counter (writable), recipient (writable), cea_authority (writable), system_program
      const params: UniversalExecuteParams = {
        to: {
          address: TEST_PROGRAM,
          chain: CHAIN.SOLANA_DEVNET,
        },
        // gasLimit omitted → per-chain default from UniversalCore
        svmExecute: {
          targetProgram: TEST_PROGRAM,
          accounts: [
            { pubkey: COUNTER_PDA, isWritable: true },       // counter PDA
            { pubkey: TEST_SOL_TARGET, isWritable: true },    // recipient
            { pubkey: ceaPdaHex, isWritable: true },           // cea_authority (actual CEA PDA)
            { pubkey: SOL_ZERO_ADDRESS, isWritable: false },   // system_program (0x00...00)
          ],
          ixData,
        },
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

      // receive_sol discriminator + amount=1 lamport
      const discriminator = new Uint8Array([121, 244, 250, 3, 8, 229, 225, 1]);
      const amountBuf = new Uint8Array(8);
      new DataView(amountBuf.buffer).setBigUint64(0, BigInt(1), true); // LE
      const ixData = new Uint8Array([...discriminator, ...amountBuf]);

      const params: UniversalExecuteParams = {
        to: {
          address: TEST_PROGRAM,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(5_000_000), // 0.005 SOL for CPI
        // gasLimit omitted → per-chain default from UniversalCore
        svmExecute: {
          targetProgram: TEST_PROGRAM,
          accounts: [
            { pubkey: COUNTER_PDA, isWritable: true },       // counter PDA
            { pubkey: TEST_SOL_TARGET, isWritable: true },    // recipient
            { pubkey: ceaPdaHex, isWritable: true },           // cea_authority (actual CEA PDA)
            { pubkey: SOL_ZERO_ADDRESS, isWritable: false },   // system_program (0x00...00)
          ],
          ixData,
        },
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
  // 6. FUNDS + CPI (SOL transfer + CPI execution)
  // ============================================================================
  describe('6. FUNDS + CPI', () => {
    it('should withdraw SOL and execute CPI on Solana program in same tx', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: FUNDS + CPI (receive_sol on test_counter) ===');

      // receive_sol discriminator + amount=1 lamport
      const discriminator = new Uint8Array([121, 244, 250, 3, 8, 229, 225, 1]);
      const amountBuf = new Uint8Array(8);
      new DataView(amountBuf.buffer).setBigUint64(0, BigInt(1), true);
      const ixData = new Uint8Array([...discriminator, ...amountBuf]);

      // receive_sol accounts: counter (writable), recipient (writable), cea_authority (writable), system_program
      const params: UniversalExecuteParams = {
        to: {
          address: TEST_PROGRAM,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(5_000_000), // 0.005 SOL transferred alongside CPI
        // gasLimit omitted → per-chain default from UniversalCore
        svmExecute: {
          targetProgram: TEST_PROGRAM,
          accounts: [
            { pubkey: COUNTER_PDA, isWritable: true },       // counter PDA
            { pubkey: TEST_SOL_TARGET, isWritable: true },    // recipient
            { pubkey: ceaPdaHex, isWritable: true },           // cea_authority (actual CEA PDA)
            { pubkey: SOL_ZERO_ADDRESS, isWritable: false },   // system_program (0x00...00)
          ],
          ixData,
        },
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

  // ============================================================================
  // 6a. SPL FUNDS + CPI (S-3.3: SPL token transfer + CPI execution)
  // ============================================================================
  describe('6a. SPL FUNDS + CPI (S-3.3)', () => {
    it('should execute CPI on Solana program with SPL token funds', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SPL FUNDS + CPI (receive_sol on test_counter with USDT) ===');

      // receive_sol discriminator + amount=1 (token unit, not SOL)
      const discriminator = new Uint8Array([121, 244, 250, 3, 8, 229, 225, 1]);
      const amountBuf = new Uint8Array(8);
      new DataView(amountBuf.buffer).setBigUint64(0, BigInt(1), true);
      const ixData = new Uint8Array([...discriminator, ...amountBuf]);

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
        svmExecute: {
          targetProgram: TEST_PROGRAM,
          accounts: [
            { pubkey: COUNTER_PDA, isWritable: true },
            { pubkey: TEST_SOL_TARGET, isWritable: true },
            { pubkey: ceaPdaHex, isWritable: true },
            { pubkey: SOL_ZERO_ADDRESS, isWritable: false },
          ],
          ixData,
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
      console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

      // Verify tx succeeded on external chain via RPC
      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 360000);
  });

  // ============================================================================
  // 6b. SPL CPI-only (S-3.4: SPL token context, amount=0, execute-only)
  // ============================================================================
  describe('6b. SPL CPI-only (S-3.4)', () => {
    it('should execute CPI with SPL token context but no burn (amount=0)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: SPL CPI-only (S-3.4: USDT context, no burn) ===');

      // receive_sol discriminator + amount=0
      const discriminator = new Uint8Array([121, 244, 250, 3, 8, 229, 225, 1]);
      const amountBuf = new Uint8Array(8); // 0 amount
      const ixData = new Uint8Array([...discriminator, ...amountBuf]);

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
        svmExecute: {
          targetProgram: TEST_PROGRAM,
          accounts: [
            { pubkey: COUNTER_PDA, isWritable: true },
            { pubkey: TEST_SOL_TARGET, isWritable: true },
            { pubkey: ceaPdaHex, isWritable: true },
            { pubkey: SOL_ZERO_ADDRESS, isWritable: false },
          ],
          ixData,
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
      console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

      // Verify tx succeeded on external chain via RPC
      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 360000);
  });

  // ============================================================================
  // 7. Small Amount Transfer
  // ============================================================================
  describe('7. Small Amount Transfer', () => {
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
  });

  // ============================================================================
  // 8. E2E Outbound with Sync
  // ============================================================================
  describe('8. E2E Outbound with Sync', () => {
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
  // 9. Transaction Preparation (SVM)
  // ============================================================================
  describe('9. Transaction Preparation', () => {
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
      expect(typeof prepared.thenOn).toBe('function');
      expect(typeof prepared.send).toBe('function');
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

      const builder = pushClient.universal.executeTransactions(firstPrepared);

      expect(typeof builder.thenOn).toBe('function');
      expect(typeof builder.send).toBe('function');

      // Chain with a second SVM outbound
      const secondPrepared = await pushClient.universal.prepareTransaction({
        to: {
          address: TEST_SOL_TARGET,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(5_000_000),
        // gasLimit omitted → per-chain default from UniversalCore
      });

      const chainedBuilder = builder.thenOn(secondPrepared);

      expect(typeof chainedBuilder.thenOn).toBe('function');
      expect(typeof chainedBuilder.send).toBe('function');
    }, 60000);
  });

  // ============================================================================
  // 10. CEA-to-UEA SOL (Route 3 SVM)
  // ============================================================================
  describe('10. CEA-to-UEA SOL (Route 3 SVM)', () => {
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

    it('should drain SOL from Solana gateway back to UEA on Push Chain', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: CEA-to-UEA SOL ===');

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
        to: ueaAddress,
        value: BigInt(5_000_000), // 0.005 SOL in lamports
        // gasLimit omitted → per-chain default from UniversalCore
      };

      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      console.log(`Source Chain: ${tx.chain}`);

      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Wait for relay
      console.log('Calling tx.wait() - polling for external chain details...');
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
    }, 600000);
  });

  // ============================================================================
  // 11. CEA-to-UEA SPL (Route 3 SVM)
  // ============================================================================
  describe('11. CEA-to-UEA SPL (Route 3 SVM)', () => {
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
        // gasLimit omitted → per-chain default from UniversalCore
      };

      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Wait for relay
      console.log('Calling tx.wait() - polling for external chain details...');
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
    }, 600000);
  });

  // ============================================================================
  // 11a. CEA-to-UEA SOL + extraPayload (S-4.7: drain SOL + Push Chain payload)
  // ============================================================================
  describe('11a. CEA-to-UEA SOL + extraPayload (S-4.7)', () => {
    it('should drain SOL from Solana gateway with Push Chain execution payload', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: CEA-to-UEA SOL + extraPayload (S-4.7) ===');

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
        to: ueaAddress,
        value: BigInt(5_000_000), // 0.005 SOL drain amount
        // gasLimit omitted → per-chain default from UniversalCore
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
      console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

      // Verify tx succeeded on external chain via RPC
      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 600000);
  });

  // ============================================================================
  // 11b. Hybrid Self-Call Flows (S-4.1, S-4.2, S-4.5, S-4.6)
  //
  // SVM gateway program auto-handles CEA pre-existing balance — it drains
  // ALL funds from the CEA PDA, not just the burned amount. No SDK code
  // changes are needed (unlike EVM). These tests confirm the behavior.
  // ============================================================================
  describe('11b. Hybrid Self-Call (CEA pre-existing balance, SVM auto-handles)', () => {
    // S-4.1: SOL self-call with topUp > 0
    // User burns X SOL on Push Chain. CEA PDA already holds Y SOL from prior activity.
    // Gateway drains X + Y automatically.
    it('S-4.1: should drain SOL including pre-existing CEA balance (hybrid)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: S-4.1 SOL Hybrid Self-Call (burn + CEA pre-existing) ===');
      console.log('SVM gateway auto-drains all CEA PDA balance — no extra SDK logic needed');

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
        to: ueaAddress,
        value: BigInt(1_000_000), // 0.001 SOL burn amount
        // gasLimit omitted → per-chain default from UniversalCore
        // Gateway will drain this + any pre-existing SOL in CEA PDA
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

    // S-4.2: SPL self-call with topUp > 0
    // User burns X USDT on Push Chain. CEA PDA already holds Y USDT from prior activity.
    // Gateway drains X + Y automatically.
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
        // gasLimit omitted → per-chain default from UniversalCore
        // Gateway will drain this + any pre-existing USDT in CEA PDA
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

    // S-4.5: SOL self-call + payload with topUp > 0
    // Same as S-4.1 but includes a Push Chain execution payload.
    it('S-4.5: should drain SOL (hybrid) with Push Chain payload', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: S-4.5 SOL Hybrid Self-Call + Payload ===');
      console.log('SVM gateway auto-drains all CEA PDA balance — no extra SDK logic needed');

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
        to: ueaAddress,
        value: BigInt(1_000_000), // 0.001 SOL burn amount
        // gasLimit omitted → per-chain default from UniversalCore
        data: '0xdeadbeef', // arbitrary Push Chain payload
        // Gateway will drain this + any pre-existing SOL in CEA PDA
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

    // S-4.6: SPL self-call + payload with topUp > 0
    // Same as S-4.2 but includes a Push Chain execution payload.
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
        // gasLimit omitted → per-chain default from UniversalCore
        data: '0xdeadbeef', // arbitrary Push Chain payload
        // Gateway will drain this + any pre-existing USDT in CEA PDA
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
  // 12. Error Handling
  // ============================================================================
  describe('12. Error Handling', () => {
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
  // 13. Progress Hooks
  // ============================================================================
  describe('13. Progress Hooks', () => {
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
      expect(events.some((e) => e.id === 'SEND-TX-01')).toBe(true);
      expect(events.some((e) => e.id.startsWith('SEND-TX-99'))).toBe(true);

      // Wait for outbound relay and verify external chain details
      const receipt = await tx.wait();
      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

      // Verify tx succeeded on external chain via RPC
      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 360000);

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
        // gasLimit omitted → per-chain default from UniversalCore
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

      // Verify tx succeeded on external chain via RPC
      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 600000);
  });
});

// =============================================================================
// EOA SVM: Outbound & Inbound from Push Chain Native Account (Routes 2 & 3)
// =============================================================================
describe('EOA SVM (Solana) Outbound & Inbound (Routes 2 & 3)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let eoaAddress: `0x${string}`;
  let ceaPdaHex: `0x${string}`;

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

    // Derive CEA PDA from EOA (EVM address) for CPI tests
    // Seeds: ["push_identity", sender_evm_address_20_bytes], Program: SVM Gateway
    const senderBytes = Buffer.from(eoaAddress.slice(2), 'hex'); // 20 bytes
    const [ceaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('push_identity'), senderBytes],
      SVM_GATEWAY_PROGRAM
    );
    ceaPdaHex = ('0x' + Buffer.from(ceaPda.toBytes()).toString('hex')) as `0x${string}`;
    console.log(`CEA PDA: ${ceaPda.toBase58()}`);
    console.log(`CEA PDA Hex: ${ceaPdaHex}`);
  }, 60000);

  // ============================================================================
  // 1. EOA Withdraw SPL Token (Route 2)
  // ============================================================================
  describe('1. EOA Withdraw SPL Token (Route 2)', () => {
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
        // gasLimit omitted → per-chain default from UniversalCore
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

      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

      // Verify tx succeeded on external chain via RPC
      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 360000);
  });

  // ============================================================================
  // 2. EOA Execute CPI (Route 2, no funds)
  // ============================================================================
  describe('2. EOA Execute CPI (Route 2)', () => {
    it('should execute CPI on Solana program from Push EOA (no funds)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: EOA Execute CPI (Route 2, no funds) ===');

      // receive_sol discriminator + amount=0 (no SOL transfer, just counter increment)
      const discriminator = new Uint8Array([121, 244, 250, 3, 8, 229, 225, 1]);
      const amountBuf = new Uint8Array(8); // 0 amount
      const ixData = new Uint8Array([...discriminator, ...amountBuf]);

      const params: UniversalExecuteParams = {
        to: {
          address: TEST_PROGRAM,
          chain: CHAIN.SOLANA_DEVNET,
        },
        // gasLimit omitted → per-chain default from UniversalCore
        svmExecute: {
          targetProgram: TEST_PROGRAM,
          accounts: [
            { pubkey: COUNTER_PDA, isWritable: true },       // counter PDA
            { pubkey: TEST_SOL_TARGET, isWritable: true },    // recipient
            { pubkey: ceaPdaHex, isWritable: true },           // cea_authority (actual CEA PDA)
            { pubkey: SOL_ZERO_ADDRESS, isWritable: false },   // system_program (0x00...00)
          ],
          ixData,
        },
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
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

      // Verify tx succeeded on external chain via RPC
      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 360000);
  });

  // ============================================================================
  // 3. EOA SPL Funds + CPI (Route 2)
  // ============================================================================
  describe('3. EOA SPL Funds + CPI (Route 2)', () => {
    it('should execute CPI with SPL token funds from Push EOA', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: EOA SPL Funds + CPI (Route 2) ===');

      // receive_sol discriminator + amount=1 (token unit)
      const discriminator = new Uint8Array([121, 244, 250, 3, 8, 229, 225, 1]);
      const amountBuf = new Uint8Array(8);
      new DataView(amountBuf.buffer).setBigUint64(0, BigInt(1), true);
      const ixData = new Uint8Array([...discriminator, ...amountBuf]);

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
        svmExecute: {
          targetProgram: TEST_PROGRAM,
          accounts: [
            { pubkey: COUNTER_PDA, isWritable: true },
            { pubkey: TEST_SOL_TARGET, isWritable: true },
            { pubkey: ceaPdaHex, isWritable: true },
            { pubkey: SOL_ZERO_ADDRESS, isWritable: false },
          ],
          ixData,
        },
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
      console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);

      // Verify tx succeeded on external chain via RPC
      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 360000);
  });

  // ============================================================================
  // 4. EOA CEA-to-UEA SOL (Route 3) — drain SOL back to Push Chain
  // ============================================================================
  describe('4. EOA CEA-to-UEA SOL (Route 3)', () => {
    it('should drain SOL from Solana gateway back to EOA on Push Chain', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: EOA CEA-to-UEA SOL (Route 3) ===');

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
        to: eoaAddress,
        value: BigInt(5_000_000), // 0.005 SOL in lamports
        // gasLimit omitted → per-chain default from UniversalCore
      };

      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      console.log(`Source Chain: ${tx.chain}`);

      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Wait for relay
      console.log('Calling tx.wait() - polling for external chain details...');
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
    }, 600000);
  });

  // ============================================================================
  // 5. EOA CEA-to-UEA SPL (Route 3) — drain SPL back to Push Chain
  // ============================================================================
  describe('5. EOA CEA-to-UEA SPL (Route 3)', () => {
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
        // gasLimit omitted → per-chain default from UniversalCore
      };

      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Wait for relay
      console.log('Calling tx.wait() - polling for external chain details...');
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
    }, 600000);
  });
});
