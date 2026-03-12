/**
 * E2E Tests for Advance Hopping (Cascaded Transactions)
 *
 * Tests Route 1 and Route 2 via the new prepareTransaction + executeTransactions API.
 * Route 3 E2E deferred until Route 3 issues are fixed.
 */
import '@e2e/shared/setup';
import { PushChain } from '../../src';
import { PUSH_NETWORK, CHAIN } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { createWalletClient, http, Hex, parseEther, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { PreparedUniversalTx } from '../../src/lib/orchestrator/orchestrator.types';
import { ERC20_EVM } from '../../src/lib/constants/abi/erc20.evm';

// BSC Testnet USDT address
const BSC_USDT_ADDRESS = '0xBC14F348BC9667be46b35Edc9B68653d86013DC5' as const;

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

    it('should send merged same-chain Route 2 hops', async () => {
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

      // Send the merged same-chain hops
      const result = await pushClient.universal
        .executeTransactions(tx1)
        .thenOn(tx2)
        .send();

      console.log(`[TEST] Merged same-chain hops TX Hash: ${result.initialTxHash}`);
      console.log(`[TEST] Hop count: ${result.hopCount}`);

      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(result.hopCount).toBeGreaterThanOrEqual(1);
      expect(result.hops.length).toBeGreaterThanOrEqual(1);
      expect(typeof result.waitForAll).toBe('function');

      // Wait for all hops to complete
      const completion = await result.waitForAll({
        timeout: 300000,
        progressHook: (event) => {
          console.log(`[TEST:waitForAll] hop ${event.hopIndex} status: ${event.status}`);
        },
      });

      expect(completion.success).toBe(true);
    }, 600000);

    it('should send multi-hop: Payload to BNB + Payload to Push (MH-P-1)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Multi-hop Payload BNB + Push ===');

      const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

      // Hop 1: Route 2 — Payload to BNB (ERC20 approve call)
      const approvePayload = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [targetAddress, BigInt(1000000)],
      });

      const tx1 = await pushClient.universal.prepareTransaction({
        to: {
          address: BSC_USDT_ADDRESS as `0x${string}`,
          chain: CHAIN.BNB_TESTNET,
        },
        data: approvePayload,
      });

      // Hop 2: Route 1 — Value transfer on Push Chain
      const tx2 = await pushClient.universal.prepareTransaction({
        to: targetAddress,
        value: parseEther('0.001'),
      });

      // Chain and send
      const result = await pushClient.universal
        .executeTransactions(tx1)
        .thenOn(tx2)
        .send();

      console.log(`[TEST] Multi-hop Payload TX Hash: ${result.initialTxHash}`);
      console.log(`[TEST] Hop count: ${result.hopCount}`);

      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(result.hopCount).toBe(2);
      expect(result.hops).toHaveLength(2);
      expect(typeof result.waitForAll).toBe('function');

      // Wait for all hops to complete
      const completion = await result.waitForAll({
        timeout: 600000,
        progressHook: (event) => {
          console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
        },
      });

      expect(completion.success).toBe(true);
      expect(completion.hops).toHaveLength(2);
    }, 900000);

    it('should send multi-hop: Funds to BNB + Funds to Push (MH-F-1)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: Multi-hop Funds BNB + Push ===');

      const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

      // Hop 1: Route 2 — Value transfer to BNB
      const tx1 = await pushClient.universal.prepareTransaction({
        to: {
          address: targetAddress,
          chain: CHAIN.BNB_TESTNET,
        },
        value: parseEther('0.0001'),
        gasLimit: BigInt(2000000),
      });

      // Hop 2: Route 1 — Value transfer on Push Chain
      const tx2 = await pushClient.universal.prepareTransaction({
        to: targetAddress,
        value: parseEther('0.001'),
      });

      // Chain and send
      const result = await pushClient.universal
        .executeTransactions(tx1)
        .thenOn(tx2)
        .send();

      console.log(`[TEST] Multi-hop Funds TX Hash: ${result.initialTxHash}`);
      console.log(`[TEST] Hop count: ${result.hopCount}`);

      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(result.hopCount).toBe(2);
      expect(result.hops).toHaveLength(2);
      expect(typeof result.waitForAll).toBe('function');

      // Wait for all hops to complete
      const completion = await result.waitForAll({
        timeout: 600000,
        progressHook: (event) => {
          console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
        },
      });

      expect(completion.success).toBe(true);
      expect(completion.hops).toHaveLength(2);
    }, 900000);
  });

  // ============================================================================
  // Multi-hop: 3-leg hops (MH-P-2, MH-F-2)
  // ============================================================================
  describe('3-leg multi-hop cascades', () => {
    it('should send multi-hop: Payload to BNB + Payload to Push + Payload to Solana (MH-P-2)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: 3-leg Payload Hop — BNB + Push + Solana (MH-P-2) ===');

      const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;
      // Solana target: 32-byte hex address (gateway vault PDA on devnet)
      const solanaTarget =
        '0x6a44bb5ea802a001386a5b39708523e1a3e1bafc8164ffcb94d1f5afa4849c69' as `0x${string}`;

      // Hop 1: Route 2 — Payload to BNB (ERC20 approve call)
      const approvePayload = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [targetAddress, BigInt(1000000)],
      });

      const tx1 = await pushClient.universal.prepareTransaction({
        to: {
          address: BSC_USDT_ADDRESS as `0x${string}`,
          chain: CHAIN.BNB_TESTNET,
        },
        data: approvePayload,
      });

      // Hop 2: Route 1 — Value transfer on Push Chain
      const tx2 = await pushClient.universal.prepareTransaction({
        to: targetAddress,
        value: parseEther('0.001'),
      });

      // Hop 3: Route 2 — Value transfer to Solana Devnet
      const tx3 = await pushClient.universal.prepareTransaction({
        to: {
          address: solanaTarget,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(10_000_000), // 0.01 SOL in lamports
      });

      // Chain all 3 hops and send
      const result = await pushClient.universal
        .executeTransactions(tx1)
        .thenOn(tx2)
        .thenOn(tx3)
        .send();

      console.log(`[TEST] 3-leg Payload TX Hash: ${result.initialTxHash}`);
      console.log(`[TEST] Hop count: ${result.hopCount}`);

      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(result.hopCount).toBe(3);
      expect(result.hops).toHaveLength(3);
      expect(typeof result.waitForAll).toBe('function');

      // Wait for all hops to complete
      const completion = await result.waitForAll({
        timeout: 900000,
        progressHook: (event) => {
          console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
        },
      });

      expect(completion.success).toBe(true);
      expect(completion.hops).toHaveLength(3);
    }, 1200000);

    it('should send multi-hop: Funds to BNB + Funds to Push + Funds to Solana (MH-F-2)', async () => {
      if (skipE2E) return;

      console.log('\n=== Test: 3-leg Funds Hop — BNB + Push + Solana (MH-F-2) ===');

      const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;
      const solanaTarget =
        '0x6a44bb5ea802a001386a5b39708523e1a3e1bafc8164ffcb94d1f5afa4849c69' as `0x${string}`;

      // Hop 1: Route 2 — Value transfer to BNB
      const tx1 = await pushClient.universal.prepareTransaction({
        to: {
          address: targetAddress,
          chain: CHAIN.BNB_TESTNET,
        },
        value: parseEther('0.0001'),
        gasLimit: BigInt(2000000),
      });

      // Hop 2: Route 1 — Value transfer on Push Chain
      const tx2 = await pushClient.universal.prepareTransaction({
        to: targetAddress,
        value: parseEther('0.001'),
      });

      // Hop 3: Route 2 — Value transfer to Solana Devnet
      const tx3 = await pushClient.universal.prepareTransaction({
        to: {
          address: solanaTarget,
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(10_000_000), // 0.01 SOL in lamports
      });

      // Chain all 3 hops and send
      const result = await pushClient.universal
        .executeTransactions(tx1)
        .thenOn(tx2)
        .thenOn(tx3)
        .send();

      console.log(`[TEST] 3-leg Funds TX Hash: ${result.initialTxHash}`);
      console.log(`[TEST] Hop count: ${result.hopCount}`);

      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(result.hopCount).toBe(3);
      expect(result.hops).toHaveLength(3);
      expect(typeof result.waitForAll).toBe('function');

      // Wait for all hops to complete
      const completion = await result.waitForAll({
        timeout: 900000,
        progressHook: (event) => {
          console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
        },
      });

      expect(completion.success).toBe(true);
      expect(completion.hops).toHaveLength(3);
    }, 1200000);
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
