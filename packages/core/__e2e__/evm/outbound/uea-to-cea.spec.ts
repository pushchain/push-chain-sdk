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
import { createWalletClient, http, Hex, parseEther, encodeFunctionData } from 'viem';
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

describe('UEA → CEA: Outbound Transactions (Route 2)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;
  let ceaAddress: `0x${string}`;
  let usdtToken: MoveableToken | undefined;

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
    usdtToken = MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.USDT;
    if (usdtToken) {
      console.log(`USDT Token: ${usdtToken.address} (${usdtToken.decimals} decimals)`);
    }
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

    it('should transfer native pETH to Ethereum Sepolia', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Native pETH Transfer to Ethereum Sepolia ===');

      const params: UniversalExecuteParams = {
        to: {
          address: TEST_TARGET,
          chain: CHAIN.ETHEREUM_SEPOLIA,
        },
        value: parseEther('0.0001'), // 0.0001 ETH
      };

      // Verify route detection
      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      console.log(`Target Chain: ${tx.chain}`);

      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tx.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);

      // Wait for outbound relay and verify external chain details
      console.log('Calling tx.wait() - polling for outbound tx hash...');
      const receipt = await tx.wait();
      console.log(`Receipt status: ${receipt.status}`);
      console.log(`External TX Hash: ${receipt.externalTxHash}`);
      console.log(`External Chain: ${receipt.externalChain}`);
      console.log(`External Explorer: ${receipt.externalExplorerUrl}`);

      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalChain).toBe(CHAIN.ETHEREUM_SEPOLIA);

      // Verify tx succeeded on external chain via RPC
      await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);
    }, 360000);
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

  // ============================================================================
  // 10. ERC20 Withdrawal via Multicall (Flow 2.2)
  // ============================================================================
  describe('10. ERC20 Withdrawal via Multicall (Flow 2.2)', () => {
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
          address: TEST_TARGET,
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

  // ============================================================================
  // 11. ERC20 DeFi Flows (Flows 3.4, 3.5, 3.6)
  // ============================================================================
  describe('11. ERC20 DeFi Flows', () => {
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
          address: BSC_USDT_ADDRESS as `0x${string}`,
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
      console.log('Note: SDK uses burnAmount = 1 wei workaround (precompile rejects 0)');

      // No funds, no value — only data. CEA uses existing balance.
      const approvePayload = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [SPENDER, BigInt(1000000)],
      });

      const params: UniversalExecuteParams = {
        to: {
          address: BSC_USDT_ADDRESS as `0x${string}`,
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
          address: BSC_USDT_ADDRESS as `0x${string}`,
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
  });

  // ============================================================================
  // 12. Native Hybrid DeFi (Flow 3.3)
  // ============================================================================
  describe('12. Native Hybrid DeFi (Flow 3.3)', () => {
    it('should execute native hybrid: multicall value exceeds burnAmount', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Native Hybrid — Multicall Value > Burn (Flow 3.3) ===');
      console.log('Note: Burns 0.0001 BNB but multicall sends 0.0002 BNB (CEA balance covers diff)');

      const burnAmount = parseEther('0.0001'); // Amount burned on Push Chain

      const params: UniversalExecuteParams = {
        to: {
          address: TEST_TARGET,
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
  // 13. CEA Migration (Migration Flow)
  // ==========================================================================
  describe('13. CEA Migration (Migration Flow)', () => {
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
