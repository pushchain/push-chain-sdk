/**
 * E2E Tests for Advance Hopping (Cascaded Transactions)
 *
 * Tests Route 1 and Route 2 via the new prepareTransaction + executeTransactions API.
 * Route 3 E2E deferred until Route 3 issues are fixed.
 */
import { PushChain } from '../src';
import { PUSH_NETWORK, CHAIN } from '../src/lib/constants/enums';
import { CHAIN_INFO } from '../src/lib/constants/chain';
import { createWalletClient, http, Hex, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import dotenv from 'dotenv';
import path from 'path';
import type { PreparedUniversalTx } from '../src/lib/orchestrator/orchestrator.types';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

describe('Advance Hopping: Cascade API E2E', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;

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
  });

  // ============================================================================
  // Route 1: prepareTransaction + send
  // ============================================================================
  describe('Route 1: prepareTransaction + send', () => {
    it('should prepare a Push Chain transaction with HopDescriptor', async () => {
      if (skipE2E) return;

      const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

      const prepared = await pushClient.universal.prepareTransaction({
        to: targetAddress,
        value: parseEther('0.001'),
      });

      console.log(`[TEST] Prepared Route: ${prepared.route}`);

      expect(prepared.route).toBe('UOA_TO_PUSH');
      expect(prepared._hop).toBeDefined();
      expect(prepared._hop.route).toBe('UOA_TO_PUSH');
      expect(prepared._hop.ueaAddress).toBe(ueaAddress);
      expect(prepared._hop.pushMulticalls).toBeDefined();
      expect(prepared._hop.pushMulticalls!.length).toBeGreaterThan(0);
      expect(typeof prepared.thenOn).toBe('function');
      expect(typeof prepared.send).toBe('function');
    });

    it('should send a prepared Route 1 transaction', async () => {
      if (skipE2E) return;

      const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

      const prepared = await pushClient.universal.prepareTransaction({
        to: targetAddress,
        value: parseEther('0.001'),
      });

      expect(prepared.route).toBe('UOA_TO_PUSH');

      const response = await prepared.send();
      console.log(`[TEST] Route 1 TX Hash: ${response.hash}`);

      expect(response.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    }, 180000);
  });

  // ============================================================================
  // Route 2: prepareTransaction + send
  // ============================================================================
  describe('Route 2: prepareTransaction + send', () => {
    it('should prepare an outbound transaction with HopDescriptor', async () => {
      if (skipE2E) return;

      const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

      const prepared = await pushClient.universal.prepareTransaction({
        to: {
          address: targetAddress,
          chain: CHAIN.BNB_TESTNET,
        },
        value: parseEther('0.0001'),
      });

      console.log(`[TEST] Prepared Route: ${prepared.route}`);
      console.log(`[TEST] CEA Address: ${prepared._hop.ceaAddress}`);
      console.log(`[TEST] PRC20 Token: ${prepared._hop.prc20Token}`);
      console.log(`[TEST] Gas Token: ${prepared._hop.gasToken}`);
      console.log(`[TEST] Gas Fee: ${prepared._hop.gasFee}`);

      expect(prepared.route).toBe('UOA_TO_CEA');
      expect(prepared._hop).toBeDefined();
      expect(prepared._hop.route).toBe('UOA_TO_CEA');
      expect(prepared._hop.targetChain).toBe(CHAIN.BNB_TESTNET);
      expect(prepared._hop.ceaAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(prepared._hop.prc20Token).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(prepared._hop.ceaMulticalls).toBeDefined();
      expect(prepared._hop.ceaMulticalls!.length).toBeGreaterThan(0);
    }, 60000);

    it('should send a prepared Route 2 transaction', async () => {
      if (skipE2E) return;

      const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

      const prepared = await pushClient.universal.prepareTransaction({
        to: {
          address: targetAddress,
          chain: CHAIN.BNB_TESTNET,
        },
        value: parseEther('0.00015'),
        gasLimit: BigInt(2000000),
      });

      expect(prepared.route).toBe('UOA_TO_CEA');

      const response = await prepared.send();
      console.log(`[TEST] Route 2 TX Hash: ${response.hash}`);

      expect(response.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(response.chain).toBe(CHAIN.BNB_TESTNET);
    }, 180000);
  });

  // ============================================================================
  // Cascade API: executeTransactions
  // ============================================================================
  describe('executeTransactions cascade API', () => {
    it('should create cascaded builder from a single prepared tx', async () => {
      if (skipE2E) return;

      const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

      const tx1 = await pushClient.universal.prepareTransaction({
        to: targetAddress,
        value: parseEther('0.001'),
      });

      const builder = pushClient.universal.executeTransactions(tx1);

      expect(typeof builder.thenOn).toBe('function');
      expect(typeof builder.send).toBe('function');
    });

    it('should chain two prepared transactions', async () => {
      if (skipE2E) return;

      const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

      const tx1 = await pushClient.universal.prepareTransaction({
        to: targetAddress,
        value: parseEther('0.001'),
      });

      const tx2 = await pushClient.universal.prepareTransaction({
        to: {
          address: targetAddress,
          chain: CHAIN.BNB_TESTNET,
        },
        value: parseEther('0.0001'),
      });

      const chainedBuilder = pushClient.universal
        .executeTransactions(tx1)
        .thenOn(tx2);

      expect(typeof chainedBuilder.thenOn).toBe('function');
      expect(typeof chainedBuilder.send).toBe('function');
    });

    it('should send a single-hop cascade (Route 1)', async () => {
      if (skipE2E) return;

      const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

      const tx1 = await pushClient.universal.prepareTransaction({
        to: targetAddress,
        value: parseEther('0.001'),
      });

      const result = await pushClient.universal.executeTransactions(tx1).send();

      console.log(`[TEST] Cascade initial TX Hash: ${result.initialTxHash}`);
      console.log(`[TEST] Hop count: ${result.hopCount}`);

      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(result.hopCount).toBe(1);
      expect(result.hops).toHaveLength(1);
      expect(result.hops[0].route).toBe('UOA_TO_PUSH');
      expect(result.hops[0].status).toBe('confirmed');
      expect(typeof result.waitForAll).toBe('function');
    }, 180000);

    it('should send a single-hop cascade (Route 2)', async () => {
      if (skipE2E) return;

      const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

      const tx1 = await pushClient.universal.prepareTransaction({
        to: {
          address: targetAddress,
          chain: CHAIN.BNB_TESTNET,
        },
        value: parseEther('0.00015'),
        gasLimit: BigInt(2000000),
      });

      const result = await pushClient.universal.executeTransactions(tx1).send();

      console.log(`[TEST] Cascade Route 2 TX Hash: ${result.initialTxHash}`);
      console.log(`[TEST] Hop count: ${result.hopCount}`);

      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(result.hopCount).toBe(1);
      expect(result.hops).toHaveLength(1);
      expect(result.hops[0].route).toBe('UOA_TO_CEA');
      expect(result.hops[0].status).toBe('confirmed');
    }, 180000);

    it('should prepare two Route 2 txs to same chain (for merging test)', async () => {
      if (skipE2E) return;

      const addr1 = '0x1234567890123456789012345678901234567890' as `0x${string}`;
      const addr2 = '0x0987654321098765432109876543210987654321' as `0x${string}`;

      const tx1 = await pushClient.universal.prepareTransaction({
        to: {
          address: addr1,
          chain: CHAIN.BNB_TESTNET,
        },
        value: parseEther('0.0001'),
      });

      const tx2 = await pushClient.universal.prepareTransaction({
        to: {
          address: addr2,
          chain: CHAIN.BNB_TESTNET,
        },
        value: parseEther('0.0001'),
      });

      // Both should be Route 2 targeting BNB Testnet
      expect(tx1.route).toBe('UOA_TO_CEA');
      expect(tx2.route).toBe('UOA_TO_CEA');
      expect(tx1._hop.targetChain).toBe(CHAIN.BNB_TESTNET);
      expect(tx2._hop.targetChain).toBe(CHAIN.BNB_TESTNET);

      // Verify the builder can chain them
      const builder = pushClient.universal
        .executeTransactions(tx1)
        .thenOn(tx2);

      expect(typeof builder.send).toBe('function');
    }, 60000);
  });

  // ============================================================================
  // waitForAll tracking
  // ============================================================================
  describe('waitForAll tracking', () => {
    it('should track Route 1 cascade with waitForAll', async () => {
      if (skipE2E) return;

      const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

      const tx1 = await pushClient.universal.prepareTransaction({
        to: targetAddress,
        value: parseEther('0.001'),
      });

      const result = await pushClient.universal.executeTransactions(tx1).send();

      const completion = await result.waitForAll({
        timeout: 60000,
        progressHook: (event) => {
          console.log(`[TEST:waitForAll] hop ${event.hopIndex} status: ${event.status}`);
        },
      });

      expect(completion.success).toBe(true);
      expect(completion.hops).toHaveLength(1);
      expect(completion.hops[0].status).toBe('confirmed');
    }, 180000);
  });
});
