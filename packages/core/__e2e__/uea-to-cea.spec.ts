/**
 * UEA → CEA: Outbound Transactions (Route 2)
 *
 * Tests for outbound transactions from Push Chain to external chains via CEA.
 * Covers: Route Detection, CEA Utilities, Transaction Preparation, FUNDS only,
 * PAYLOAD only, FUNDS + PAYLOAD, E2E Sync, Error Handling, Progress Hooks
 *
 * Primary test chain: BNB Testnet (Chain ID: 97)
 */
import { PushChain } from '../src';
import { PUSH_NETWORK, CHAIN } from '../src/lib/constants/enums';
import { CHAIN_INFO } from '../src/lib/constants/chain';
import { MOVEABLE_TOKENS } from '../src/lib/constants/tokens';
import { createWalletClient, http, Hex, parseEther, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import dotenv from 'dotenv';
import path from 'path';
import { getCEAAddress, chainSupportsCEA } from '../src/lib/orchestrator/cea-utils';
import { TransactionRoute, detectRoute } from '../src/lib/orchestrator/route-detector';
import type { UniversalExecuteParams, ChainTarget } from '../src/lib/orchestrator/orchestrator.types';
import type { ProgressEvent } from '../src/lib/progress-hook/progress-hook.types';
import { ERC20_EVM } from '../src/lib/constants/abi/erc20.evm';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// BSC Testnet token addresses
const BSC_USDT_ADDRESS = '0xBC14F348BC9667be46b35Edc9B68653d86013DC5' as const;
const NATIVE_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

// Test target address (random address for testing)
const TEST_TARGET = '0x1234567890123456789012345678901234567890' as `0x${string}`;

describe('UEA → CEA: Outbound Transactions (Route 2)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;
  let ceaAddress: `0x${string}`;

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
  }, 60000);

  // ============================================================================
  // 1. Route Detection
  // ============================================================================
  describe('1. Route Detection', () => {
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

  // ============================================================================
  // 2. CEA Address Utilities
  // ============================================================================
  describe('2. CEA Address Utilities', () => {
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

  // ============================================================================
  // 3. Transaction Preparation
  // ============================================================================
  describe('3. Transaction Preparation', () => {
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

  // ============================================================================
  // 4. FUNDS Only
  // ============================================================================
  describe('4. FUNDS Only', () => {
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
    }, 180000);

    it('should transfer ERC-20 pUSDT to BSC Testnet', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: ERC-20 pUSDT Transfer ===');

      // For ERC-20, we need to specify the token
      // The SDK should handle burning pUSDT on Push Chain
      // and the CEA receiving USDT on BSC
      const params: UniversalExecuteParams = {
        to: {
          address: TEST_TARGET,
          chain: CHAIN.BNB_TESTNET,
        },
        // For ERC-20 transfers, we use data to encode the transfer
        // But for Route 2 outbound, value represents the token amount
        value: BigInt(10000), // 0.01 USDT (6 decimals)
      };

      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    }, 180000);

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
    }, 180000);
  });

  // ============================================================================
  // 5. PAYLOAD Only
  // ============================================================================
  describe('5. PAYLOAD Only', () => {
    // NOTE: Payload-only tests should use functions that don't require the CEA
    // to have token balance. ERC20 `approve` is ideal because it sets allowance
    // without requiring actual tokens. ERC20 `transfer` would fail because
    // the CEA (msg.sender) doesn't have the tokens to transfer.

    it('should execute ERC20 approve call on BSC', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: ERC20 Approve Call ===');

      const spenderAddress = '0x9999999999999999999999999999999999999999' as `0x${string}`;

      const payload = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [spenderAddress, BigInt(1000000)], // Approve 1 USDT
      });

      const params: UniversalExecuteParams = {
        to: {
          address: BSC_USDT_ADDRESS as `0x${string}`,
          chain: CHAIN.BNB_TESTNET,
        },
        data: payload,
      };

      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    }, 180000);

    it('should execute multicall payload', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Multicall Payload ===');

      // Multiple operations in a single payload
      // NOTE: Using approve calls since they don't require CEA to have token balance
      const call1 = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [TEST_TARGET, BigInt(1000000)],
      });

      const spender2 = '0x8888888888888888888888888888888888888888' as `0x${string}`;
      const call2 = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [spender2, BigInt(500000)],
      });

      // For multicall, we use the data array format
      const params: UniversalExecuteParams = {
        to: {
          address: BSC_USDT_ADDRESS as `0x${string}`,
          chain: CHAIN.BNB_TESTNET,
        },
        data: [
          { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: call1 },
          { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: call2 },
        ],
      };

      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    }, 180000);
  });

  // ============================================================================
  // 6. FUNDS + PAYLOAD
  // ============================================================================
  describe('6. FUNDS + PAYLOAD', () => {
    // NOTE: When combining native value transfer with non-payable function calls
    // (like ERC20 approve/transfer), you MUST use multicall array format to
    // separate them. Attaching value directly to a non-payable call will revert.
    // Per SDK_Outbound_Flow_Guide.pdf Section 9.2 (Multi-Token Withdrawal).

    it('should transfer pBNB and execute contract call', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: pBNB + Contract Call ===');

      const approvePayload = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [TEST_TARGET, BigInt(1000000)],
      });

      // Per SDK_Outbound_Flow_Guide.pdf Section 9.2:
      // Use multicall array to separate native transfer from non-payable call
      // Top-level `value` burns pBNB on Push Chain → CEA receives BNB
      const params: UniversalExecuteParams = {
        to: {
          address: TEST_TARGET,
          chain: CHAIN.BNB_TESTNET,
        },
        value: parseEther('0.0001'), // Burns pBNB, funds CEA with BNB
        data: [
          // Call 1: CEA sends BNB (from burned pBNB) to recipient
          { to: TEST_TARGET, value: parseEther('0.0001'), data: '0x' as `0x${string}` },
          // Call 2: CEA calls approve (value=0, non-payable)
          { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: approvePayload },
        ],
      };

      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    }, 180000);

    it('should transfer pBNB with multicall', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: pBNB + Multicall ===');

      const approveCall = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [TEST_TARGET, BigInt(500000)],
      });

      // Top-level `value` burns pBNB on Push Chain → CEA receives BNB
      // Multicall array tells CEA how to use those funds
      const params: UniversalExecuteParams = {
        to: {
          address: TEST_TARGET,
          chain: CHAIN.BNB_TESTNET,
        },
        value: parseEther('0.0001'), // Burns pBNB, funds CEA with BNB
        data: [
          // Call 1: CEA sends BNB (from burned pBNB) to recipient
          { to: TEST_TARGET, value: parseEther('0.0001'), data: '0x' as `0x${string}` },
          // Call 2: CEA calls approve (value=0, non-payable)
          { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: approveCall },
        ],
      };

      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    }, 180000);
  });

  // ============================================================================
  // 7. E2E Outbound with Sync
  // ============================================================================
  describe('7. E2E Outbound with Sync', () => {
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
    }, 180000);

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
      expect(receipt.externalExplorerUrl).toContain(receipt.externalTxHash);
    }, 600000); // 10 min timeout for full E2E with relay
  });

  // ============================================================================
  // 8. Error Handling
  // ============================================================================
  describe('8. Error Handling', () => {
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

  // ============================================================================
  // 9. Progress Hooks
  // ============================================================================
  describe('9. Progress Hooks', () => {
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
});
