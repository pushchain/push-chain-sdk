/**
 * CEA → Push: Inbound Transactions (Route 3)
 *
 * Tests for inbound transactions from external chains back to Push Chain via CEA.
 * Covers: Route Detection, CEA Prerequisites, Transaction Preparation, FUNDS only,
 * PAYLOAD only, FUNDS + PAYLOAD, E2E Sync, Error Handling, Progress Hooks
 *
 * Primary test chain: BNB Testnet (Chain ID: 97)
 *
 * Prerequisites:
 * - CEA must be deployed on the external chain
 * - The burn/deposit mechanism carries value through the relay (no pre-funding needed)
 */
import { PushChain } from '../src';
import { PUSH_NETWORK, CHAIN } from '../src/lib/constants/enums';
import { CHAIN_INFO, UNIVERSAL_GATEWAY_ADDRESSES } from '../src/lib/constants/chain';
import { createWalletClient, http, Hex, parseEther, formatEther, createPublicClient, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import dotenv from 'dotenv';
import path from 'path';
import { getCEAAddress, chainSupportsCEA } from '../src/lib/orchestrator/cea-utils';
import { TransactionRoute, detectRoute } from '../src/lib/orchestrator/route-detector';
import type { UniversalExecuteParams, ChainTarget } from '../src/lib/orchestrator/orchestrator.types';
import type { ProgressEvent } from '../src/lib/progress-hook/progress-hook.types';
import { ERC20_EVM } from '../src/lib/constants/abi/erc20.evm';
import { MOVEABLE_TOKENS, type MoveableToken } from '../src/lib/constants/tokens';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Test constants
const TEST_TARGET = '0x1234567890123456789012345678901234567890' as `0x${string}`;

describe('CEA → Push: Inbound Transactions (Route 3)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;
  let ceaAddress: `0x${string}`;
  let usdtToken: MoveableToken | undefined;

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
    const ceaResult = await getCEAAddress(ueaAddress, CHAIN.BNB_TESTNET);
    ceaAddress = ceaResult.cea;
    console.log(`CEA Address on BSC: ${ceaAddress}, deployed: ${ceaResult.isDeployed}`);

    // Get USDT token for ERC20 self-call flows
    const tokens = MOVEABLE_TOKENS[CHAIN.BNB_TESTNET] || [];
    usdtToken = tokens.find(t => t.symbol === 'USDT');
    if (usdtToken) {
      console.log(`USDT Token (BNB Testnet): ${usdtToken.address} (${usdtToken.decimals} decimals)`);
    }

  }, 60000);

  // ============================================================================
  // 1. Route Detection
  // ============================================================================
  describe('1. Route Detection', () => {
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

    it('should detect UOA_TO_PUSH when from.chain is not specified', () => {
      const params: UniversalExecuteParams = {
        to: '0x1234567890123456789012345678901234567890',
        value: parseEther('0.001'),
      };
      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_PUSH);
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

  // ============================================================================
  // 2. CEA Prerequisites
  // ============================================================================
  describe('2. CEA Prerequisites', () => {
    it('should report BNB Testnet supports CEA', () => {
      expect(chainSupportsCEA(CHAIN.BNB_TESTNET)).toBe(true);
    });

    it('should report Ethereum Sepolia supports CEA', () => {
      expect(chainSupportsCEA(CHAIN.ETHEREUM_SEPOLIA)).toBe(true);
    });

    it('should compute deterministic CEA address', async () => {
      if (skipE2E) return;

      const result1 = await getCEAAddress(ueaAddress, CHAIN.BNB_TESTNET);
      const result2 = await getCEAAddress(ueaAddress, CHAIN.BNB_TESTNET);

      expect(result1.cea).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(result2.cea).toBe(result1.cea);
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
        transport: http(CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0]),
      });
      const balance = await publicClient.getBalance({ address: ceaAddress });
      console.log(`CEA native balance on BSC Testnet: ${formatEther(balance)} BNB`);

      if (balance === BigInt(0)) {
        console.warn('WARNING: CEA has no BNB balance on external chain.');
        console.warn(`CEA address: ${ceaAddress}`);
      }
    });
  });

  // ============================================================================
  // 3. Transaction Preparation
  // ============================================================================
  describe('3. Transaction Preparation', () => {
    it('should prepare Route 3 transaction without executing', async () => {
      if (skipE2E) return;

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.BNB_TESTNET },
        to: ueaAddress,
        value: parseEther('0.00005'),
      };

      const prepared = await pushClient.universal.prepareTransaction(params);

      console.log(`Prepared tx route: ${prepared.route}`);
      console.log(`Estimated gas: ${prepared.estimatedGas}`);
      console.log(`Nonce: ${prepared.nonce}`);

      expect(prepared.route).toBe('CEA_TO_PUSH');
      expect(prepared.payload).toBeDefined();
      expect(typeof prepared.thenOn).toBe('function');
      expect(typeof prepared.send).toBe('function');
    });

    it('should create chained builder from prepared Route 3 transaction', async () => {
      if (skipE2E) return;

      const firstPrepared = await pushClient.universal.prepareTransaction({
        from: { chain: CHAIN.BNB_TESTNET },
        to: ueaAddress,
        value: parseEther('0.00005'),
      });

      const builder = pushClient.universal.executeTransactions(firstPrepared);

      expect(typeof builder.thenOn).toBe('function');
      expect(typeof builder.send).toBe('function');

      // Chain with a Route 2 outbound
      const secondPrepared = await pushClient.universal.prepareTransaction({
        to: {
          address: TEST_TARGET,
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
    it('should transfer native BNB from CEA to Push Chain', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Native BNB Inbound (CEA → Push) ===');

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.BNB_TESTNET },
        to: ueaAddress,
        value: parseEther('0.00005'),
      };

      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      console.log(`Source Chain: ${tx.chain}`);

      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

      // Wait for outbound relay and verify external chain details
      console.log('Calling tx.wait() - polling for outbound tx hash...');
      const receipt = await tx.wait();
      console.log(`Receipt status: ${receipt.status}`);
      console.log(`External TX Hash: ${receipt.externalTxHash}`);
      console.log(`External Chain: ${receipt.externalChain}`);

      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
    }, 600000);

    it('should handle small amount inbound transfer', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Small Amount Inbound ===');

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.BNB_TESTNET },
        to: ueaAddress,
        value: BigInt(1000), // Small amount
      };

      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Wait for outbound relay and verify external chain details
      console.log('Calling tx.wait() - polling for outbound tx hash...');
      const receipt = await tx.wait();
      console.log(`Receipt status: ${receipt.status}`);
      console.log(`External TX Hash: ${receipt.externalTxHash}`);

      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
    }, 600000);

  });

  // ============================================================================
  // 5. PAYLOAD Only
  // ============================================================================
  describe('5. PAYLOAD Only', () => {
    it('should execute Route 3 with payload for Push Chain execution', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Payload-Only Inbound ===');

      // Payload to execute on Push Chain after inbound arrives
      // Using ERC20 approve as a safe no-op on Push Chain
      const pushPayload = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [TEST_TARGET, BigInt(1000000)],
      });

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.BNB_TESTNET },
        to: TEST_TARGET, // Push Chain target
        data: pushPayload,
      };

      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Wait for outbound relay and verify external chain details
      console.log('Calling tx.wait() - polling for outbound tx hash...');
      const receipt = await tx.wait();
      console.log(`Receipt status: ${receipt.status}`);
      console.log(`External TX Hash: ${receipt.externalTxHash}`);

      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
    }, 600000);
  });

  // ============================================================================
  // 6. FUNDS + PAYLOAD
  // ============================================================================
  describe('6. FUNDS + PAYLOAD', () => {
    it('should transfer native BNB and execute Push Chain contract call', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: FUNDS + PAYLOAD Inbound ===');

      // Payload to execute on Push Chain after inbound + funds arrive
      const pushPayload = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [TEST_TARGET, BigInt(500000)],
      });

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.BNB_TESTNET },
        to: TEST_TARGET,
        value: parseEther('0.00005'), // Native BNB from CEA
        data: pushPayload,
      };

      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

      // Wait for outbound relay and verify external chain details
      console.log('Calling tx.wait() - polling for outbound tx hash...');
      const receipt = await tx.wait();
      console.log(`Receipt status: ${receipt.status}`);
      console.log(`External TX Hash: ${receipt.externalTxHash}`);

      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
    }, 600000);
  });

  // ============================================================================
  // 7. E2E Inbound with Sync
  // ============================================================================
  describe('7. E2E Inbound with Sync', () => {
    it('should execute Route 3 inbound and verify receipt via .wait()', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: E2E Inbound with .wait() ===');

      const tx = await pushClient.universal.sendTransaction({
        from: { chain: CHAIN.BNB_TESTNET },
        to: ueaAddress,
        value: parseEther('0.00005'),
      });

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // .wait() polls for external chain details
      console.log('Calling tx.wait() - polling for external chain details...');
      const receipt = await tx.wait();

      console.log(`Receipt status: ${receipt.status}`);
      console.log(`External TX Hash: ${receipt.externalTxHash}`);
      console.log(`External Chain: ${receipt.externalChain}`);
      console.log(`External Explorer URL: ${receipt.externalExplorerUrl}`);

      expect(receipt.hash).toBe(tx.hash);
      expect(receipt.status).toBe(1);
      expect(receipt.externalTxHash).toBeDefined();
      expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
      expect(receipt.externalExplorerUrl).toContain(receipt.externalTxHash);
    }, 600000);
  });

  // ============================================================================
  // 8. Error Handling
  // ============================================================================
  describe('8. Error Handling', () => {
    it('should fail gracefully if CEA is not deployed on target chain', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: CEA Not Deployed Error ===');

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.ARBITRUM_SEPOLIA },
        to: ueaAddress,
        value: parseEther('0.001'),
      };

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
        // If getCEAAddress throws (CEAFactory not available), that's also a valid outcome
        console.log(`getCEAAddress threw: ${err.message}`);
        await expect(
          pushClient.universal.sendTransaction(params)
        ).rejects.toThrow();
      }
    }, 60000);

    it('should detect CEA_TO_CEA (not Route 3) when to.chain is external', () => {
      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.BNB_TESTNET },
        to: {
          address: TEST_TARGET,
          chain: CHAIN.ETHEREUM_SEPOLIA,
        } as ChainTarget,
        value: parseEther('0.001'),
      };

      // This is Route 4 (CEA_TO_CEA), not Route 3
      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_CEA);
    });

    it('should treat missing from.chain as Route 1 (UOA_TO_PUSH)', () => {
      const params: UniversalExecuteParams = {
        to: ueaAddress || '0x1234567890123456789012345678901234567890',
        value: parseEther('0.001'),
      };

      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_PUSH);
    });
  });

  // ============================================================================
  // 9. Progress Hooks
  // ============================================================================
  describe('9. Progress Hooks', () => {
    it('should emit correct hooks for Route 3 FUNDS flow', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Progress Hooks (Route 3 FUNDS) ===');

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

      const tx = await clientWithHook.universal.sendTransaction({
        from: { chain: CHAIN.BNB_TESTNET },
        to: clientWithHook.universal.account,
        value: parseEther('0.00005'),
      });

      // Verify we got progress events
      expect(events.length).toBeGreaterThan(0);

      // Verify key events were emitted
      expect(events.some(e => e.id === 'SEND-TX-01')).toBe(true);
      expect(events.some(e => e.id.startsWith('SEND-TX-99'))).toBe(true);
    }, 600000);
  });

  // ============================================================================
  // 10. ERC20 Self-Call Flows (Flows 4.2, 4.6)
  // ============================================================================
  describe('10. ERC20 Self-Call Flows', () => {
    it('should bridge ERC20 USDT back from CEA to Push Chain (Flow 4.2)', async () => {
      if (skipE2E) return;
      if (!usdtToken) {
        console.log('Skipping - USDT token not found in MOVEABLE_TOKENS for BNB Testnet');
        return;
      }

      console.log('\n=== Test: ERC20 Self-Call — Bridge USDT Back (Flow 4.2) ===');
      console.log('Burns ERC20 on external chain, mints on Push Chain. SDK auto-adds approve step.');

      const bridgeAmount = BigInt(10000); // 0.01 USDT (6 decimals)

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.BNB_TESTNET },
        to: ueaAddress, // Self — bridge back to own UEA
        funds: {
          amount: bridgeAmount,
          token: usdtToken,
        },
      };

      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

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
    }, 600000);

    it('should bridge ERC20 USDT with Push Chain payload (Flow 4.6)', async () => {
      if (skipE2E) return;
      if (!usdtToken) {
        console.log('Skipping - USDT token not found');
        return;
      }

      console.log('\n=== Test: ERC20 Self-Call + Payload (Flow 4.6) ===');
      console.log('Burns ERC20 on external chain + executes payload on Push Chain.');

      const bridgeAmount = BigInt(10000); // 0.01 USDT

      // Payload to execute on Push Chain after inbound
      const pushPayload = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [TEST_TARGET, BigInt(1000000)],
      });

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.BNB_TESTNET },
        to: TEST_TARGET, // Push Chain target for payload execution
        funds: {
          amount: bridgeAmount,
          token: usdtToken,
        },
        data: pushPayload,
      };

      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

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
    }, 600000);
  });
});
