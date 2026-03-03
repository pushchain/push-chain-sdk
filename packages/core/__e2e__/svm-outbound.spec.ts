/**
 * SVM (Solana) Outbound Transactions (Route 2)
 *
 * Tests for outbound transactions from Push Chain to Solana via the SVM gateway.
 * Covers: Route Detection, SVM Utilities, Withdraw SOL, Withdraw SPL,
 * Execute CPI, Error Handling, Progress Hooks
 *
 * Primary test chain: Solana Devnet
 */
import { PushChain } from '../src';
import { PUSH_NETWORK, CHAIN } from '../src/lib/constants/enums';
import { CHAIN_INFO } from '../src/lib/constants/chain';
import { createWalletClient, http, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import dotenv from 'dotenv';
import path from 'path';
import { chainSupportsOutbound, chainSupportsCEA } from '../src/lib/orchestrator/cea-utils';
import { TransactionRoute, detectRoute } from '../src/lib/orchestrator/route-detector';
import {
  isSvmChain,
  isValidSolanaHexAddress,
  encodeSvmExecutePayload,
} from '../src/lib/orchestrator/payload-builders';
import type {
  UniversalExecuteParams,
  ChainTarget,
  SvmExecutePayloadFields,
} from '../src/lib/orchestrator/orchestrator.types';
import type { ProgressEvent } from '../src/lib/progress-hook/progress-hook.types';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// 32-byte Solana addresses as 0x-prefixed hex
// Random test address (32 bytes)
const TEST_SOL_TARGET =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as `0x${string}`;

// Zero address for Solana (32 bytes of zeros)
const SOL_ZERO_ADDRESS =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;

// Random program address for CPI tests
const TEST_PROGRAM =
  '0xaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd' as `0x${string}`;

describe('SVM (Solana) Outbound Transactions (Route 2)', () => {
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
        rentFee: BigInt(1_500_000),
        instructionId: 2,
      };

      const encoded = encodeSvmExecutePayload(fields);

      expect(encoded).toMatch(/^0x[a-fA-F0-9]+$/);
      // The encoded payload should be non-trivial in length
      // 4B (count) + 2*(32B+1B) + 4B (ixDataLen) + 4B (ixData) + 8B (rentFee) + 1B (instrId) + 32B (program) = 4+66+4+4+8+1+32 = 119 bytes = 238 hex chars
      expect(encoded.length).toBe(2 + 238); // "0x" + 238 hex
    });

    it('should encode SVM execute payload with default instruction ID', () => {
      const fields: SvmExecutePayloadFields = {
        targetProgram: TEST_PROGRAM,
        accounts: [],
        ixData: new Uint8Array([]),
        rentFee: BigInt(0),
        // instructionId omitted → defaults to 2
      };

      const encoded = encodeSvmExecutePayload(fields);
      expect(encoded).toMatch(/^0x[a-fA-F0-9]+$/);

      // 4B (count=0) + 0 accounts + 4B (ixDataLen=0) + 0 ixData + 8B (rentFee) + 1B (instrId) + 32B (program) = 49 bytes = 98 hex chars
      expect(encoded.length).toBe(2 + 98);
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
        value: BigInt(100_000_000), // 0.1 SOL in lamports
      };

      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      console.log(`Target Chain: ${tx.chain}`);

      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tx.chain).toBe(CHAIN.SOLANA_DEVNET);
    }, 180000);
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
          amount: BigInt(1_000_000), // 1 USDT (6 decimals)
          token: pushClient.moveable.token.USDT,
        },
      };

      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    }, 180000);
  });

  // ============================================================================
  // 5. Execute CPI
  // ============================================================================
  describe('5. Execute CPI', () => {
    it('should execute CPI on Solana program', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Execute CPI ===');

      // Sample discriminator + args
      const discriminator = new Uint8Array([0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a]);
      const ixData = new Uint8Array([...discriminator, 0x01, 0x00, 0x00, 0x00]);

      const pdaAddress =
        '0x1111111111111111111111111111111111111111111111111111111111111111' as `0x${string}`;

      const params: UniversalExecuteParams = {
        to: {
          address: TEST_PROGRAM,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(50_000_000), // 0.05 SOL for CPI
        svmExecute: {
          targetProgram: TEST_PROGRAM,
          accounts: [
            { pubkey: pdaAddress, isWritable: true },
            { pubkey: TEST_SOL_TARGET, isWritable: false },
          ],
          ixData,
          rentFee: BigInt(1_500_000),
        },
      };

      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    }, 180000);

    it('should execute CPI with no value (rent-only)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Execute CPI (rent-only) ===');

      const ixData = new Uint8Array([0x01, 0x02, 0x03, 0x04]);

      const params: UniversalExecuteParams = {
        to: {
          address: TEST_PROGRAM,
          chain: CHAIN.SOLANA_DEVNET,
        },
        svmExecute: {
          targetProgram: TEST_PROGRAM,
          accounts: [{ pubkey: TEST_SOL_TARGET, isWritable: true }],
          ixData,
          rentFee: BigInt(2_000_000),
        },
      };

      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    }, 180000);
  });

  // ============================================================================
  // 6. Error Handling
  // ============================================================================
  describe('6. Error Handling', () => {
    it('should reject invalid Solana address (EVM-length)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Invalid Address Length ===');

      const params: UniversalExecuteParams = {
        to: {
          // EVM-length address (20 bytes) - invalid for Solana
          address: '0x1234567890123456789012345678901234567890' as `0x${string}`,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(100_000_000),
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
        value: BigInt(100_000_000),
      };

      await expect(
        pushClient.universal.sendTransaction(params)
      ).rejects.toThrow();
    }, 60000);
  });

  // ============================================================================
  // 7. Progress Hooks
  // ============================================================================
  describe('7. Progress Hooks', () => {
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
        value: BigInt(10_000_000), // 0.01 SOL
      };

      await clientWithHook.universal.sendTransaction(params);

      // Verify we got progress events
      expect(events.length).toBeGreaterThan(0);

      // Verify key events were emitted
      expect(events.some((e) => e.id === 'SEND-TX-01')).toBe(true);
      expect(events.some((e) => e.id.startsWith('SEND-TX-99'))).toBe(true);
    }, 180000);
  });

  // ============================================================================
  // 8. Transaction Preparation (SVM)
  // ============================================================================
  describe('8. Transaction Preparation', () => {
    it('should prepare SVM outbound transaction without executing', async () => {
      if (skipE2E) return;

      const params: UniversalExecuteParams = {
        to: {
          address: TEST_SOL_TARGET,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(100_000_000),
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
  });
});
