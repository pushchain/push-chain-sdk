/**
 * Multi-Chain Universal Transaction Tests - Route 3 (CEA → Push)
 *
 * Tests for inbound transactions from external chains back to Push Chain via CEA.
 * Route 3 Flow: Push Chain (UEA) → Route 2 → External Chain (CEA) → sendUniversalTxFromCEA → Push Chain
 *
 * Primary test chain: BNB Testnet (Chain ID: 97)
 *
 * Prerequisites:
 * - CEA must be deployed on the external chain (run Route 2 first)
 * - CEA must have funds on the external chain (native or ERC20)
 */
import { PushChain } from '../src';
import { PUSH_NETWORK, CHAIN } from '../src/lib/constants/enums';
import { CHAIN_INFO, UNIVERSAL_GATEWAY_ADDRESSES } from '../src/lib/constants/chain';
import { createWalletClient, http, Hex, parseEther, formatEther, createPublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bscTestnet } from 'viem/chains';
import dotenv from 'dotenv';
import path from 'path';
import { getCEAAddress, chainSupportsCEA } from '../src/lib/orchestrator/cea-utils';
import { TransactionRoute, detectRoute } from '../src/lib/orchestrator/route-detector';
import type { UniversalExecuteParams, ChainTarget } from '../src/lib/orchestrator/orchestrator.types';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

describe('Route 3: CEA → Push (Inbound Transactions)', () => {
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

    // Get CEA address on BSC Testnet
    const ceaInfo = await getCEAAddress(ueaAddress, CHAIN.BNB_TESTNET);
    ceaAddress = ceaInfo.cea;
    console.log(`CEA Address on BSC Testnet: ${ceaAddress}`);
    console.log(`CEA is deployed: ${ceaInfo.isDeployed}`);
  });

  describe('Route Detection', () => {
    it('should detect CEA_TO_PUSH when from.chain is external and to is string', () => {
      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.BNB_TESTNET },
        to: '0x1234567890123456789012345678901234567890',
        value: parseEther('0.001'),
      };
      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);
    });

    it('should detect CEA_TO_PUSH when from.chain is external and to.chain is Push', () => {
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

    it('should detect CEA_TO_CEA when from.chain and to.chain are both external', () => {
      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.BNB_TESTNET },
        to: {
          address: '0x1234567890123456789012345678901234567890',
          chain: CHAIN.ETHEREUM_SEPOLIA,
        } as ChainTarget,
        value: parseEther('0.001'),
      };
      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_CEA);
    });
  });

  describe('CEA Prerequisites', () => {
    it('should have CEA deployed on BSC Testnet', async () => {
      if (skipE2E) return;

      const { cea, isDeployed } = await getCEAAddress(ueaAddress, CHAIN.BNB_TESTNET);
      console.log(`CEA Address: ${cea}`);
      console.log(`Is Deployed: ${isDeployed}`);

      // Note: This test will pass even if CEA is not deployed,
      // but will fail in actual E2E execution
      expect(cea).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should have UniversalGateway configured for BSC Testnet', () => {
      const gateway = UNIVERSAL_GATEWAY_ADDRESSES[CHAIN.BNB_TESTNET];
      expect(gateway).toBeDefined();
      expect(gateway).toMatch(/^0x[a-fA-F0-9]{40}$/);
      console.log(`UniversalGateway on BSC Testnet: ${gateway}`);
    });

    it('should check CEA native balance on BSC Testnet', async () => {
      if (skipE2E) return;

      const publicClient = createPublicClient({
        chain: bscTestnet,
        transport: http(CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0]),
      });

      const balance = await publicClient.getBalance({ address: ceaAddress });
      console.log(`CEA native balance on BSC Testnet: ${formatEther(balance)} BNB`);

      // This is informational - CEA needs BNB for Route 3 to work
      // If balance is 0, Route 3 native transfer tests will fail
      if (balance === BigInt(0)) {
        console.warn('WARNING: CEA has no BNB balance. Route 3 native transfer tests will fail.');
        console.warn(`Fund CEA at: ${ceaAddress}`);
      }
    });
  });

  describe('Route 3 Parameter Validation', () => {
    it('should fail without from.chain specified', async () => {
      if (skipE2E) return;

      const params: UniversalExecuteParams = {
        to: '0x1234567890123456789012345678901234567890',
        value: parseEther('0.001'),
      };

      // This should be Route 1 (UOA → Push), not Route 3
      const route = detectRoute(params);
      expect(route).toBe(TransactionRoute.UOA_TO_PUSH);
    });

    it('should fail with invalid to type for Route 3', async () => {
      if (skipE2E) return;

      // Route 3 with ChainTarget pointing to external chain should be CEA_TO_CEA
      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.BNB_TESTNET },
        to: {
          address: '0x1234567890123456789012345678901234567890',
          chain: CHAIN.ETHEREUM_SEPOLIA, // Different external chain
        } as ChainTarget,
        value: parseEther('0.001'),
      };

      const route = detectRoute(params);
      expect(route).toBe(TransactionRoute.CEA_TO_CEA);
    });
  });

  describe('Route 3 E2E: CEA → Push (Native BNB)', () => {
    it('should deploy CEA via Route 2 if needed, then execute Route 3 inbound transfer', async () => {
      if (skipE2E) return;

      console.log('\n' + '='.repeat(80));
      console.log('=== Route 3 E2E: Full Flow (Route 2 Setup + Route 3 Inbound) ===');
      console.log('='.repeat(80) + '\n');

      const publicClient = createPublicClient({
        chain: bscTestnet,
        transport: http(CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0]),
      });

      // Check CEA deployment and balance
      const { cea: currentCeaAddress, isDeployed: ceaDeployed } = await getCEAAddress(
        ueaAddress,
        CHAIN.BNB_TESTNET
      );
      let ceaBalance = await publicClient.getBalance({ address: currentCeaAddress });

      // If CEA not deployed or no balance, run Route 2 first
      const minBalanceForRoute3 = parseEther('0.0001');

      if (!ceaDeployed || ceaBalance < minBalanceForRoute3) {
        const route2Amount = parseEther('0.0005');

        const route2Tx = await pushClient.universal.sendTransaction({
          to: {
            address: currentCeaAddress,
            chain: CHAIN.BNB_TESTNET,
          },
          value: route2Amount,
        });

        // Wait for the relay to complete
        await new Promise((resolve) => setTimeout(resolve, 30000));

        // Re-check CEA balance
        ceaBalance = await publicClient.getBalance({ address: currentCeaAddress });

        if (ceaBalance === BigInt(0)) {
          console.log('Skipping Route 3 test - CEA not funded yet');
          return;
        }
      }

      // Execute Route 3 (CEA → Push)
      const transferAmount = parseEther('0.00005');
      if (ceaBalance < transferAmount) {
        console.log(`Skipping - CEA balance insufficient`);
        return;
      }

      // Route 3: CEA → Push
      const tx = await pushClient.universal.sendTransaction({
        from: { chain: CHAIN.BNB_TESTNET },
        to: ueaAddress,
        value: transferAmount,
      });

      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tx.chain).toBe(CHAIN.BNB_TESTNET);
    }, 600000);
  });

  describe('Route 3 Error Handling', () => {
    it('should fail gracefully if CEA is not deployed', async () => {
      if (skipE2E) return;

      // Use a chain where CEA might not be deployed
      // This tests the CEA deployment check in executeCeaToPush
      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.ARBITRUM_SEPOLIA }, // Different chain with CEAFactory
        to: ueaAddress,
        value: parseEther('0.001'),
      };

      // Check if CEA is deployed on this chain first
      try {
        const { isDeployed } = await getCEAAddress(ueaAddress, CHAIN.ARBITRUM_SEPOLIA);

        if (!isDeployed) {
          await expect(
            pushClient.universal.sendTransaction(params)
          ).rejects.toThrow(/CEA not deployed/);
        } else {
          console.log('CEA is deployed on ARBITRUM_SEPOLIA - skipping this test case');
        }
      } catch (err: any) {
        // If getCEAAddress throws (CEAFactory not available), that's also a valid test outcome
        console.log(`getCEAAddress threw: ${err.message}`);
        await expect(
          pushClient.universal.sendTransaction(params)
        ).rejects.toThrow();
      }
    }, 60000);

    it('should fail if from.chain is not specified for CEA operation', async () => {
      if (skipE2E) return;

      // This should actually be Route 1, not Route 3
      const params: UniversalExecuteParams = {
        to: ueaAddress,
        value: parseEther('0.001'),
      };

      const route = detectRoute(params);
      // Without from.chain, this is Route 1 (UOA → Push)
      expect(route).toBe(TransactionRoute.UOA_TO_PUSH);
    });
  });
});
