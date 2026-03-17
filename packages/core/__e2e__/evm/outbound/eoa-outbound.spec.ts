import '@e2e/shared/setup';
/**
 * EOA → CEA: Outbound Transactions (Route 2) from Push Chain Native EOA
 *
 * Tests for outbound transactions from a Push Chain native account (EOA) to
 * external chains via CEA. Unlike UEA tests that originate from Ethereum Sepolia,
 * these tests use PUSH_TESTNET_DONUT as the origin chain.
 *
 * Coverage: R2-P-3 (Payload), R2-F-9 (Funds), R2-PF-10 (Payload + Funds)
 */
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { createWalletClient, http, Hex, parseEther, encodeFunctionData } from 'viem';
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

// Test target address
const TEST_TARGET = '0x1234567890123456789012345678901234567890' as `0x${string}`;

describe('EOA → CEA: Outbound from Push Chain Native Account (Route 2)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let eoaAddress: `0x${string}`;
  let ceaAddress: `0x${string}`;
  let usdtToken: MoveableToken | undefined;

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
  }, 60000);

  // ============================================================================
  // R2-F-9: Push Chain native EOA sends funds outbound
  // ============================================================================
  describe('R2-F-9: EOA FUNDS Only', () => {
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
  // R2-P-3: Push Chain native EOA sends payload outbound
  // ============================================================================
  describe('R2-P-3: EOA PAYLOAD Only', () => {
    it('should execute ERC20 approve call on BSC from Push EOA', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: EOA ERC20 Approve Call (R2-P-3) ===');

      const spenderAddress = '0x9999999999999999999999999999999999999999' as `0x${string}`;

      const payload = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [spenderAddress, BigInt(1000000)],
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
  // R2-PF-10: Push Chain native EOA sends payload + funds outbound
  // ============================================================================
  describe('R2-PF-10: EOA PAYLOAD + FUNDS', () => {
    it('should transfer pBNB and execute contract call from Push EOA', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: EOA pBNB + Contract Call (R2-PF-10) ===');

      const approvePayload = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [TEST_TARGET, BigInt(1000000)],
      });

      // Multicall: send BNB + approve in one transaction
      const params: UniversalExecuteParams = {
        to: {
          address: TEST_TARGET,
          chain: CHAIN.BNB_TESTNET,
        },
        value: parseEther('0.0001'), // Burns pBNB, funds CEA with BNB
        data: [
          // Call 1: CEA sends BNB to recipient
          { to: TEST_TARGET, value: parseEther('0.0001'), data: '0x' as `0x${string}` },
          // Call 2: CEA calls approve (value=0, non-payable)
          { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: approvePayload },
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
    }, 360000);
  });

  // ============================================================================
  // R2-F-ERC20: Push Chain native EOA sends ERC-20 funds outbound
  // ============================================================================
  describe('R2-F-ERC20: EOA FUNDS (ERC-20)', () => {
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
  // R2-MC: Push Chain native EOA sends multicall outbound (no funds)
  // ============================================================================
  describe('R2-MC: EOA MULTICALL Only', () => {
    it('should execute multicall with two approve calls on BSC from Push EOA', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: EOA Multicall — Two Approve Calls (R2-MC) ===');

      const spender1 = '0x9999999999999999999999999999999999999999' as `0x${string}`;
      const spender2 = '0x8888888888888888888888888888888888888888' as `0x${string}`;

      const approveCall1 = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [spender1, BigInt(1000000)],
      });

      const approveCall2 = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [spender2, BigInt(500000)],
      });

      const params: UniversalExecuteParams = {
        to: {
          address: BSC_USDT_ADDRESS as `0x${string}`,
          chain: CHAIN.BNB_TESTNET,
        },
        data: [
          { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: approveCall1 },
          { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: approveCall2 },
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
    }, 360000);
  });

  // ============================================================================
  // R2-FP-ERC20: Push Chain native EOA sends ERC-20 funds + payload outbound
  // ============================================================================
  describe('R2-FP-ERC20: EOA FUNDS + PAYLOAD (ERC-20)', () => {
    it('should transfer ERC-20 USDT and execute contract call from Push EOA', async () => {
      if (skipE2E) return;
      if (!usdtToken) {
        console.log('Skipping - USDT token not found');
        return;
      }

      console.log('\n=== Test: EOA ERC-20 USDT + Contract Call (R2-FP-ERC20) ===');

      const withdrawAmount = BigInt(10000); // 0.01 USDT (6 decimals)

      const erc20TransferPayload = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'transfer',
        args: [TEST_TARGET, withdrawAmount],
      });

      const approvePayload = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [TEST_TARGET, BigInt(1000000)],
      });

      const params: UniversalExecuteParams = {
        to: {
          address: TEST_TARGET,
          chain: CHAIN.BNB_TESTNET,
        },
        funds: {
          amount: withdrawAmount,
          token: usdtToken,
        },
        data: [
          { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: erc20TransferPayload },
          { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: approvePayload },
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
    }, 360000);
  });
});
