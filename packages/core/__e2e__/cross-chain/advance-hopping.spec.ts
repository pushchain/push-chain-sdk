/**
 * E2E Tests for Advance Hopping (Cascaded Transactions)
 *
 * Tests Route 1, Route 2, and Route 3 via the new prepareTransaction + executeTransactions API.
 */
import '@e2e/shared/setup';
import { PushChain } from '../../src';
import { PUSH_NETWORK, CHAIN } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { createWalletClient, createPublicClient, http, Hex, parseEther, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { PreparedUniversalTx } from '../../src/lib/orchestrator/orchestrator.types';
import { ERC20_EVM } from '../../src/lib/constants/abi/erc20.evm';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import { PublicKey } from '@solana/web3.js';

// BSC Testnet USDT address
const BSC_USDT_ADDRESS = '0xBC14F348BC9667be46b35Edc9B68653d86013DC5' as const;

// Push Chain payable counter (for Route 3 inbound tests)
const COUNTER_ADDRESS_PAYABLE = '0x70d8f7a0fF8e493fb9cbEE19Eb780E40Aa872aaf' as `0x${string}`;
const COUNTER_ABI_PAYABLE = [
  { type: 'function', name: 'increment', inputs: [], outputs: [], stateMutability: 'payable' },
  { type: 'function', name: 'countPC', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
] as const;

// BSC Testnet payable counter (accepts native BNB via increment)
const BSC_COUNTER_PAYABLE = '0xf4bd8c13da0f5831d7b6dd3275a39f14ec7ddaa6' as `0x${string}`;
const BSC_COUNTER_ABI = [
  { type: 'function', name: 'count', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'increment', inputs: [], outputs: [], stateMutability: 'payable' },
] as const;

// Solana target (32-byte hex address)
const SOLANA_TARGET = '0x6a44bb5ea802a001386a5b39708523e1a3e1bafc8164ffcb94d1f5afa4849c69' as `0x${string}`;

// Solana test_counter program on devnet (8yNqjrMnFiFbVTVQcKij8tNWWTMdFkrDf9abCGgc2sgx)
const SOL_TEST_PROGRAM = '0x7673075a980bfd5d6b1dffe99c31f63e8938519cc1c2af009dda5e568a94460d' as `0x${string}`;
const SOL_COUNTER_PDA = '0x4f12fe6816ae7e33ebf7db0b154ec3b09e3bf1a7690481e8e9477d5a278ad3af' as `0x${string}`;
const SOL_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;
const SVM_GATEWAY_PROGRAM = new PublicKey('CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS');

describe('Advance Hopping: Cascade API E2E', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;
  let pushPublicClient: ReturnType<typeof createPublicClient>;
  let bscPublicClient: ReturnType<typeof createPublicClient>;
  let ceaPdaHex: `0x${string}`;

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

    pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });

    bscPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0]),
    });

    // Derive Solana CEA PDA for CPI tests
    const senderBytes = Buffer.from(ueaAddress.slice(2), 'hex');
    const [ceaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('push_identity'), senderBytes],
      SVM_GATEWAY_PROGRAM
    );
    ceaPdaHex = ('0x' + Buffer.from(ceaPda.toBytes()).toString('hex')) as `0x${string}`;
    console.log(`CEA PDA: ${ceaPda.toBase58()} (${ceaPdaHex})`);
  });

  // ============================================================================
  // Core Scenarios
  // ============================================================================
  describe('Core Scenarios', () => {

    // ==========================================================================
    // 1. Single Hop — Funds (Route 1)
    //
    // On-chain execution flow:
    //   Push Chain tx:
    //     └─ Value transfer (0.001 PC) to target address on Push Chain
    // ==========================================================================
    describe('1. Single Hop — Funds (Route 1)', () => {
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

    // ==========================================================================
    // 2. 3-Leg Cascade — Route 2 (Payload) + Route 3 + Route 1
    // ==========================================================================
    // ==========================================================================
    // 2. 3-Leg Cascade — Route 2 (Payload) + Route 3 + Route 1
    //
    // On-chain execution flow:
    //   Push Chain tx (single multicall):
    //     ├─ Outbound 1 → BSC: ERC20 approve call (payload only)
    //     └─ Outbound 2 → BSC: Route 3 CEA payload (sendUniversalTxToUEA)
    //          └─ BSC CEA creates inbound back to Push Chain
    //               └─ Push Chain executePayload (multicall):
    //                    ├─ counter.increment() on Push Chain
    //                    └─ Value transfer (0.001 PC) to target
    // ==========================================================================
    describe('2. 3-Leg Cascade — Route 2 (Payload) + Route 3 + Route 1', () => {
      it('should send multi-hop: Payload to BNB + Inbound from BNB + Push transfer (MH-P-1)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: 3-leg Payload — Route 2 + Route 3 + Route 1 ===');

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [targetAddress, BigInt(1000000)],
        });

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE, functionName: 'increment',
        });

        // Hop 1: Route 2 — Payload to BNB (ERC20 approve call)
        const tx1 = await pushClient.universal.prepareTransaction({
          to: { address: BSC_USDT_ADDRESS as `0x${string}`, chain: CHAIN.BNB_TESTNET },
          data: approvePayload,
        });

        // Hop 2: Route 3 — Inbound from BNB to Push Chain (increment counter)
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: incrementPayload,
        });

        // Hop 3: Route 1 — Value transfer on Push Chain
        const tx3 = await pushClient.universal.prepareTransaction({
          to: targetAddress,
          value: parseEther('0.001'),
        });

        const result = await pushClient.universal
          .executeTransactions(tx1)
          .thenOn(tx2)
          .thenOn(tx3)
          .send();

        console.log(`[TEST] Multi-hop Payload TX Hash: ${result.initialTxHash}`);
        console.log(`[TEST] Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(3);
        expect(result.hops).toHaveLength(3);

        const completion = await result.waitForAll({
          timeout: 600000,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
          },
        });
        expect(completion.success).toBe(true);

        const outboundHops = completion.hops.filter(h => h.route === 'UOA_TO_CEA');
        for (const hop of outboundHops) {
          expect(hop.outboundDetails).toBeDefined();
          await verifyExternalTransaction(hop.outboundDetails!.externalTxHash, hop.outboundDetails!.destinationChain);
        }

        // Verify inbound: counter incremented
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < 180000) {
          await new Promise((r) => setTimeout(r, 10000));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
          }) as bigint;
          console.log(`Polling counter: ${counterAfter} (elapsed: ${Math.round((Date.now() - pollStart) / 1000)}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 900000);
    });

    // ==========================================================================
    // 3. 3-Leg Cascade — Route 2 (Funds) + Route 3 + Route 1
    //
    // On-chain execution flow:
    //   Push Chain tx (single multicall):
    //     ├─ Outbound 1 → BSC: value transfer (0.0001 BNB)
    //     └─ Outbound 2 → BSC: Route 3 CEA payload (sendUniversalTxToUEA)
    //          └─ BSC CEA creates inbound back to Push Chain
    //               └─ Push Chain executePayload (multicall):
    //                    ├─ counter.increment() on Push Chain
    //                    └─ Value transfer (0.001 PC) to target
    // ==========================================================================
    describe('3. 3-Leg Cascade — Route 2 (Funds) + Route 3 + Route 1', () => {
      it('should send multi-hop: Outbound to BNB + Inbound from BNB + Push Chain transfer (MH-F-1)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: 3-leg Cascade — Route 2 + Route 3 + Route 1 ===');

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

        // Read Push Chain counter BEFORE
        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'increment',
        });

        // Hop 1: Route 2 — Value transfer outbound to BNB
        const tx1 = await pushClient.universal.prepareTransaction({
          to: {
            address: targetAddress,
            chain: CHAIN.BNB_TESTNET,
          },
          value: parseEther('0.0001'),
          gasLimit: BigInt(2000000),
        });

        // Hop 2: Route 3 — Inbound from BNB to Push Chain (increment counter)
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: incrementPayload,
        });

        // Hop 3: Route 1 — Value transfer on Push Chain
        const tx3 = await pushClient.universal.prepareTransaction({
          to: targetAddress,
          value: parseEther('0.001'),
        });

        // Chain all 3 hops and send
        const result = await pushClient.universal
          .executeTransactions(tx1)
          .thenOn(tx2)
          .thenOn(tx3)
          .send();

        console.log(`[TEST] 3-leg Cascade TX Hash: ${result.initialTxHash}`);
        console.log(`[TEST] Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(3);
        expect(result.hops).toHaveLength(3);
        expect(typeof result.waitForAll).toBe('function');

        // Wait for all hops to complete
        const completion = await result.waitForAll({
          timeout: 600000,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
          },
        });

        expect(completion.success).toBe(true);
        expect(completion.hops).toHaveLength(3);

        // Verify outbound tx on external chain
        const outboundHops = completion.hops.filter(h => h.route === 'UOA_TO_CEA');
        for (const hop of outboundHops) {
          console.log(`  External TX Hash: ${hop.outboundDetails?.externalTxHash}`);
          console.log(`  External Chain: ${hop.outboundDetails?.destinationChain}`);
          console.log(`  External Explorer: ${hop.outboundDetails?.explorerUrl}`);

          expect(hop.outboundDetails).toBeDefined();
          expect(hop.outboundDetails?.externalTxHash).toMatch(/^0x[a-fA-F0-9]+$/);

          await verifyExternalTransaction(hop.outboundDetails!.externalTxHash, hop.outboundDetails!.destinationChain);
        }

        // Verify Push Chain counter incremented (Route 3 inbound)
        const maxInboundWait = 180000;
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < maxInboundWait) {
          await new Promise((r) => setTimeout(r, 10000));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE,
            abi: COUNTER_ABI_PAYABLE,
            functionName: 'countPC',
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling counter: ${counterAfter} (elapsed: ${elapsed}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 900000);
    });

    // ==========================================================================
    // 4. 4-Leg Cascade — Route 2 (BNB Payload) + Route 3 + Route 1 + Route 2 (Solana)
    //
    // On-chain execution flow:
    //   Push Chain tx (single multicall):
    //     ├─ Outbound 1 → BSC: ERC20 approve call (payload only)
    //     └─ Outbound 2 → BSC: Route 3 CEA payload (sendUniversalTxToUEA)
    //          └─ BSC CEA creates inbound back to Push Chain
    //               └─ Push Chain executePayload (multicall):
    //                    ├─ counter.increment() on Push Chain
    //                    ├─ Value transfer (0.001 PC) to target
    //                    ├─ pSOL.approve(UGPC)
    //                    └─ UGPC.sendOutbound → Solana (0.01 SOL)
    // ==========================================================================
    describe('4. 4-Leg Cascade — Route 2 (BNB Payload) + Route 3 + Route 1 + Route 2 (Solana)', () => {
      it('should send multi-hop: Payload to BNB + Inbound + Push + Solana (MH-P-2)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: 4-leg Cascade — BNB + Inbound + Push + Solana ===');

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;
        const solanaTarget =
          '0x6a44bb5ea802a001386a5b39708523e1a3e1bafc8164ffcb94d1f5afa4849c69' as `0x${string}`;

        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM, functionName: 'approve', args: [targetAddress, BigInt(1000000)],
        });
        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE, functionName: 'increment',
        });

        // Hop 1: Route 2 — Payload to BNB
        const tx1 = await pushClient.universal.prepareTransaction({
          to: { address: BSC_USDT_ADDRESS as `0x${string}`, chain: CHAIN.BNB_TESTNET },
          data: approvePayload,
        });

        // Hop 2: Route 3 — Inbound from BNB (increment counter)
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: incrementPayload,
        });

        // Hop 3: Route 1 — Value transfer on Push Chain
        const tx3 = await pushClient.universal.prepareTransaction({
          to: targetAddress, value: parseEther('0.001'),
        });

        // Hop 4: Route 2 — Value transfer to Solana Devnet
        const tx4 = await pushClient.universal.prepareTransaction({
          to: { address: solanaTarget, chain: CHAIN.SOLANA_DEVNET },
          value: BigInt(10_000_000),
        });

        const result = await pushClient.universal
          .executeTransactions(tx1).thenOn(tx2).thenOn(tx3).thenOn(tx4).send();

        console.log(`[TEST] 4-leg TX Hash: ${result.initialTxHash}`);
        console.log(`[TEST] Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(4);
        expect(result.hops).toHaveLength(4);

        const completion = await result.waitForAll({
          timeout: 900000,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
          },
        });
        expect(completion.success).toBe(true);

        const outboundHops = completion.hops.filter(h => h.route === 'UOA_TO_CEA');
        expect(outboundHops.length).toBe(2);
        for (const hop of outboundHops) {
          if (hop.outboundDetails) {
            expect(hop.outboundDetails.externalTxHash).toMatch(/^0x[a-fA-F0-9]+$/);
            await verifyExternalTransaction(hop.outboundDetails.externalTxHash, hop.outboundDetails.destinationChain);
          }
        }

        // Verify inbound: counter incremented
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < 180000) {
          await new Promise((r) => setTimeout(r, 10000));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
          }) as bigint;
          console.log(`Polling counter: ${counterAfter} (elapsed: ${Math.round((Date.now() - pollStart) / 1000)}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 1200000);
    });

    // ==========================================================================
    // 5. 4-Leg Cascade — Route 2 (BNB Funds) + Route 3 + Route 1 + Route 2 (Solana)
    //
    // On-chain execution flow:
    //   Push Chain tx (single multicall):
    //     ├─ Outbound 1 → BSC: value transfer (0.0001 BNB)
    //     └─ Outbound 2 → BSC: Route 3 CEA payload (sendUniversalTxToUEA)
    //          └─ BSC CEA creates inbound back to Push Chain
    //               └─ Push Chain executePayload (multicall):
    //                    ├─ counter.increment() on Push Chain
    //                    ├─ Value transfer (0.001 PC) to target
    //                    ├─ pSOL.approve(UGPC)
    //                    └─ UGPC.sendOutbound → Solana (0.01 SOL)
    // ==========================================================================
    describe('5. 4-Leg Cascade — Route 2 (BNB Funds) + Route 3 + Route 1 + Route 2 (Solana)', () => {
      it('should send multi-hop: Funds to BNB + Inbound + Push + Solana (MH-F-2)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: 4-leg Funds — BNB + Inbound + Push + Solana ===');

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;
        const solanaTarget =
          '0x6a44bb5ea802a001386a5b39708523e1a3e1bafc8164ffcb94d1f5afa4849c69' as `0x${string}`;

        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE, functionName: 'increment',
        });

        // Hop 1: Route 2 — Value transfer to BNB
        const tx1 = await pushClient.universal.prepareTransaction({
          to: { address: targetAddress, chain: CHAIN.BNB_TESTNET },
          value: parseEther('0.0001'),
          gasLimit: BigInt(2000000),
        });

        // Hop 2: Route 3 — Inbound from BNB (increment counter)
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: incrementPayload,
        });

        // Hop 3: Route 1 — Value transfer on Push Chain
        const tx3 = await pushClient.universal.prepareTransaction({
          to: targetAddress, value: parseEther('0.001'),
        });

        // Hop 4: Route 2 — Value transfer to Solana Devnet
        const tx4 = await pushClient.universal.prepareTransaction({
          to: { address: solanaTarget, chain: CHAIN.SOLANA_DEVNET },
          value: BigInt(10_000_000),
        });

        const result = await pushClient.universal
          .executeTransactions(tx1).thenOn(tx2).thenOn(tx3).thenOn(tx4).send();

        console.log(`[TEST] 4-leg Funds TX Hash: ${result.initialTxHash}`);
        console.log(`[TEST] Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(4);
        expect(result.hops).toHaveLength(4);

        const completion = await result.waitForAll({
          timeout: 900000,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
          },
        });
        expect(completion.success).toBe(true);

        const outboundHops = completion.hops.filter(h => h.route === 'UOA_TO_CEA');
        expect(outboundHops.length).toBe(2);
        for (const hop of outboundHops) {
          console.log(`  External TX Hash: ${hop.outboundDetails?.externalTxHash}`);
          console.log(`  External Chain: ${hop.outboundDetails?.destinationChain}`);
          console.log(`  External Explorer: ${hop.outboundDetails?.explorerUrl}`);

          // Direct outbounds have outboundDetails; child outbounds (nested inside
          // Route 3 inbound) are auto-confirmed without external tx tracking.
          if (hop.outboundDetails) {
            expect(hop.outboundDetails.externalTxHash).toMatch(/^0x[a-fA-F0-9]+$/);
            await verifyExternalTransaction(hop.outboundDetails.externalTxHash, hop.outboundDetails.destinationChain);
          }
        }

        // Verify inbound: counter incremented
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < 180000) {
          await new Promise((r) => setTimeout(r, 10000));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
          }) as bigint;
          console.log(`Polling counter: ${counterAfter} (elapsed: ${Math.round((Date.now() - pollStart) / 1000)}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 1200000);
    });

    // ==========================================================================
    // 6. Same-Chain Merging + Route 3 Inbound
    //
    // On-chain execution flow:
    //   Push Chain tx (single multicall — merged same-chain outbounds):
    //     ├─ Outbound → BSC: merged multicall [transfer to addr1, transfer to addr2]
    //     └─ Outbound → BSC: Route 3 CEA payload (sendUniversalTxToUEA)
    //          └─ BSC CEA creates inbound back to Push Chain
    //               └─ Push Chain executePayload:
    //                    └─ counter.increment() on Push Chain
    // ==========================================================================
    describe('6. Same-Chain Merging + Route 3 Inbound', () => {
      it('should send merged same-chain Route 2 hops then Route 3 inbound', async () => {
        if (skipE2E) return;

        const addr1 = '0x1234567890123456789012345678901234567890' as `0x${string}`;
        const addr2 = '0x0987654321098765432109876543210987654321' as `0x${string}`;

        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE, functionName: 'increment',
        });

        const tx1 = await pushClient.universal.prepareTransaction({
          to: { address: addr1, chain: CHAIN.BNB_TESTNET },
          value: parseEther('0.0001'),
        });

        const tx2 = await pushClient.universal.prepareTransaction({
          to: { address: addr2, chain: CHAIN.BNB_TESTNET },
          value: parseEther('0.0001'),
        });

        // Hop 3: Route 3 — Inbound from BNB (increment counter)
        const tx3 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: incrementPayload,
        });

        // Send the merged same-chain hops + Route 3 inbound
        const result = await pushClient.universal
          .executeTransactions(tx1)
          .thenOn(tx2)
          .thenOn(tx3)
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

        // Verify outbound tx on external chain
        const outboundHops = completion.hops.filter(h => h.route === 'UOA_TO_CEA');
        for (const hop of outboundHops) {
          console.log(`  External TX Hash: ${hop.outboundDetails?.externalTxHash}`);
          console.log(`  External Chain: ${hop.outboundDetails?.destinationChain}`);
          console.log(`  External Explorer: ${hop.outboundDetails?.explorerUrl}`);

          expect(hop.outboundDetails).toBeDefined();
          expect(hop.outboundDetails?.externalTxHash).toMatch(/^0x[a-fA-F0-9]+$/);

          await verifyExternalTransaction(hop.outboundDetails!.externalTxHash, hop.outboundDetails!.destinationChain);
        }

        // Verify inbound: counter incremented
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < 180000) {
          await new Promise((r) => setTimeout(r, 10000));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
          }) as bigint;
          console.log(`Polling counter: ${counterAfter} (elapsed: ${Math.round((Date.now() - pollStart) / 1000)}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, 600000);
    });

    // ==========================================================================
    // 7. Multi-Chain: BSC Payload + Inbound + Solana Bridge
    //
    // On-chain execution flow:
    //   Push Chain tx (single multicall):
    //     ├─ Outbound 1 → BSC: value (0.0001 BNB) + counter.increment() on BSC
    //     └─ Outbound 2 → BSC: Route 3 CEA payload (sendUniversalTxToUEA)
    //          └─ BSC CEA creates inbound back to Push Chain
    //               └─ Push Chain executePayload (multicall):
    //                    ├─ counter.increment() on Push Chain
    //                    ├─ pSOL.approve(UGPC)
    //                    └─ UGPC.sendOutbound → Solana (0.01 SOL)
    // ==========================================================================
    describe('7. Multi-Chain — R2(BSC payload) + R3(inbound) + R2(Solana)', () => {
      it('should bridge to BSC with counter increment, inbound to Push, then bridge to Solana', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Multi-Chain — BSC payload + Inbound + Solana ===');

        // Read BSC counter BEFORE
        const bscCounterBefore = await bscPublicClient.readContract({
          address: BSC_COUNTER_PAYABLE, abi: BSC_COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`BSC CounterA BEFORE: ${bscCounterBefore}`);

        // Read Push Chain counter BEFORE
        const pushCounterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${pushCounterBefore}`);

        const bscIncrementPayload = encodeFunctionData({
          abi: BSC_COUNTER_ABI, functionName: 'increment',
        });
        const pushIncrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE, functionName: 'increment',
        });

        // Hop 1: Route 2 — BSC outbound (value + counter increment)
        const tx1 = await pushClient.universal.prepareTransaction({
          to: { address: BSC_COUNTER_PAYABLE, chain: CHAIN.BNB_TESTNET },
          value: parseEther('0.0001'),
          data: bscIncrementPayload,
          gasLimit: BigInt(2000000),
        });

        // Hop 2: Route 3 — Inbound from BSC (increment Push Chain counter)
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: pushIncrementPayload,
        });

        // Hop 3: Route 2 — Solana outbound (value transfer)
        const tx3 = await pushClient.universal.prepareTransaction({
          to: { address: SOLANA_TARGET, chain: CHAIN.SOLANA_DEVNET },
          value: BigInt(10_000_000),
        });

        const result = await pushClient.universal
          .executeTransactions(tx1).thenOn(tx2).thenOn(tx3).send();

        console.log(`[TEST] Multi-Chain TX Hash: ${result.initialTxHash}`);
        console.log(`[TEST] Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(3);

        const completion = await result.waitForAll({
          timeout: 600000,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
          },
        });
        expect(completion.success).toBe(true);

        // Verify BSC outbound
        const outboundHops = completion.hops.filter(h => h.route === 'UOA_TO_CEA');
        for (const hop of outboundHops) {
          if (hop.outboundDetails) {
            expect(hop.outboundDetails.externalTxHash).toMatch(/^0x[a-fA-F0-9]+$/);
            await verifyExternalTransaction(hop.outboundDetails.externalTxHash, hop.outboundDetails.destinationChain);
          }
        }

        // Verify BSC counter incremented
        await new Promise((r) => setTimeout(r, 5000));
        const bscCounterAfter = await bscPublicClient.readContract({
          address: BSC_COUNTER_PAYABLE, abi: BSC_COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`BSC CounterA AFTER: ${bscCounterAfter}`);
        expect(bscCounterAfter).toBeGreaterThan(bscCounterBefore);

        // Verify Push Chain counter incremented (Route 3 inbound)
        const pollStart = Date.now();
        let pushCounterAfter = pushCounterBefore;
        while (Date.now() - pollStart < 180000) {
          await new Promise((r) => setTimeout(r, 10000));
          pushCounterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
          }) as bigint;
          console.log(`Polling Push counter: ${pushCounterAfter} (elapsed: ${Math.round((Date.now() - pollStart) / 1000)}s)`);
          if (pushCounterAfter > pushCounterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${pushCounterAfter}`);
        expect(pushCounterAfter).toBeGreaterThan(pushCounterBefore);
      }, 900000);
    });

    // ==========================================================================
    // 8. Full Round-Trip: BSC + Solana CPI + BSC Inbound + Solana Inbound
    //
    // On-chain execution flow:
    //   Push Chain tx (single multicall):
    //     ├─ Outbound 1 → BSC: value (0.0001 BNB) + counter.increment() on BSC
    //     ├─ Outbound 2 → Solana: CPI receive_sol on test_counter program
    //     └─ Outbound 3 → BSC: Route 3 CEA payload (sendUniversalTxToUEA)
    //          └─ BSC CEA creates inbound back to Push Chain
    //               └─ Push Chain executePayload (merged multicall):
    //                    ├─ counter.increment() on Push Chain (from both R3 hops)
    //                    ├─ pSOL.approve(UGPC)
    //                    └─ UGPC.sendOutbound → Solana (Solana R3 nested as child)
    // ==========================================================================
    describe('8. Full Round-Trip — R2(BSC payload) + R2(Solana CPI) + R3(BSC→Push) + R3(Sol→Push)', () => {
      it('should cascade across BSC and Solana with CPI + dual inbounds', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Full Round-Trip — BSC payload + Solana CPI + dual inbounds ===');

        // Read counters BEFORE
        const bscCounterBefore = await bscPublicClient.readContract({
          address: BSC_COUNTER_PAYABLE, abi: BSC_COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`BSC CounterA BEFORE: ${bscCounterBefore}`);

        const pushCounterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${pushCounterBefore}`);

        const bscIncrementPayload = encodeFunctionData({
          abi: BSC_COUNTER_ABI, functionName: 'increment',
        });
        const pushIncrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE, functionName: 'increment',
        });

        // Solana CPI: receive_sol on test_counter
        const discriminator = new Uint8Array([121, 244, 250, 3, 8, 229, 225, 1]);
        const amountBuf = new Uint8Array(8);
        new DataView(amountBuf.buffer).setBigUint64(0, BigInt(1), true);
        const ixData = new Uint8Array([...discriminator, ...amountBuf]);

        // Hop 1: Route 2 — BSC outbound (value + counter increment)
        const tx1 = await pushClient.universal.prepareTransaction({
          to: { address: BSC_COUNTER_PAYABLE, chain: CHAIN.BNB_TESTNET },
          value: parseEther('0.0001'),
          data: bscIncrementPayload,
          gasLimit: BigInt(2000000),
        });

        // Hop 2: Route 2 — Solana outbound (CPI: receive_sol on test_counter)
        const tx2 = await pushClient.universal.prepareTransaction({
          to: { address: SOL_TEST_PROGRAM, chain: CHAIN.SOLANA_DEVNET },
          value: BigInt(5_000_000),
          svmExecute: {
            targetProgram: SOL_TEST_PROGRAM,
            accounts: [
              { pubkey: SOL_COUNTER_PDA, isWritable: true },
              { pubkey: SOLANA_TARGET, isWritable: true },
              { pubkey: ceaPdaHex, isWritable: true },
              { pubkey: SOL_ZERO_ADDRESS, isWritable: false },
            ],
            ixData,
          },
        });

        // Hop 3: Route 3 — Inbound from BSC (increment Push Chain counter #1)
        const tx3 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: pushIncrementPayload,
        });

        // Hop 4: Route 3 — Inbound from Solana (increment Push Chain counter #2)
        const tx4 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.SOLANA_DEVNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: pushIncrementPayload,
        });

        const result = await pushClient.universal
          .executeTransactions(tx1).thenOn(tx2).thenOn(tx3).thenOn(tx4).send();

        console.log(`[TEST] Full Round-Trip TX Hash: ${result.initialTxHash}`);
        console.log(`[TEST] Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(4);

        const completion = await result.waitForAll({
          timeout: 900000,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
          },
        });
        expect(completion.success).toBe(true);

        // Verify BSC outbound
        const outboundHops = completion.hops.filter(h => h.route === 'UOA_TO_CEA');
        for (const hop of outboundHops) {
          if (hop.outboundDetails) {
            expect(hop.outboundDetails.externalTxHash).toMatch(/^0x[a-fA-F0-9]+$/);
            await verifyExternalTransaction(hop.outboundDetails.externalTxHash, hop.outboundDetails.destinationChain);
          }
        }

        // Verify BSC counter incremented
        await new Promise((r) => setTimeout(r, 5000));
        const bscCounterAfter = await bscPublicClient.readContract({
          address: BSC_COUNTER_PAYABLE, abi: BSC_COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`BSC CounterA AFTER: ${bscCounterAfter}`);
        expect(bscCounterAfter).toBeGreaterThan(bscCounterBefore);

        // Verify Push Chain counter incremented from BSC inbound
        // Both R3 hops' payloads (BSC + Solana) get merged into a single inbound
        // multicall by the cascade composition, so counter increments once (+1).
        const pollStart = Date.now();
        let pushCounterAfter = pushCounterBefore;
        while (Date.now() - pollStart < 180000) {
          await new Promise((r) => setTimeout(r, 10000));
          pushCounterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
          }) as bigint;
          console.log(`Polling Push counter: ${pushCounterAfter} (elapsed: ${Math.round((Date.now() - pollStart) / 1000)}s)`);
          if (pushCounterAfter > pushCounterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${pushCounterAfter}`);
        expect(pushCounterAfter).toBeGreaterThan(pushCounterBefore);
      }, 1200000);
    });

    // ==========================================================================
    // 9. Solana-Originated Inbound — R2(Solana) + R3(Solana→Push)
    //
    // On-chain execution flow:
    //   Push Chain tx (single multicall):
    //     └─ Outbound → Solana: value transfer (0.01 SOL)
    //          └─ Solana delivery confirmed
    //               └─ Route 3 inbound from Solana → Push Chain
    //                    └─ Push Chain executePayload:
    //                         └─ counter.increment() on Push Chain
    // ==========================================================================
    describe('9. Solana-Originated Inbound — R2(Solana) + R3(Solana→Push)', () => {
      it('should outbound to Solana then inbound from Solana to increment Push counter', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Solana-Originated Inbound ===');

        const pushCounterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${pushCounterBefore}`);

        const pushIncrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE, functionName: 'increment',
        });

        // Hop 1: Route 2 — Solana outbound (value transfer)
        const tx1 = await pushClient.universal.prepareTransaction({
          to: { address: SOLANA_TARGET, chain: CHAIN.SOLANA_DEVNET },
          value: BigInt(10_000_000),
        });

        // Hop 2: Route 3 — Inbound from Solana (increment Push Chain counter)
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.SOLANA_DEVNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: pushIncrementPayload,
        });

        const result = await pushClient.universal
          .executeTransactions(tx1).thenOn(tx2).send();

        console.log(`[TEST] Solana Inbound TX Hash: ${result.initialTxHash}`);
        console.log(`[TEST] Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(2);

        const completion = await result.waitForAll({
          timeout: 600000,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
          },
        });
        expect(completion.success).toBe(true);

        // Verify Solana outbound
        const outboundHops = completion.hops.filter(h => h.route === 'UOA_TO_CEA');
        for (const hop of outboundHops) {
          if (hop.outboundDetails) {
            expect(hop.outboundDetails.externalTxHash).toMatch(/^0x[a-fA-F0-9]+$/);
            await verifyExternalTransaction(hop.outboundDetails.externalTxHash, hop.outboundDetails.destinationChain);
          }
        }

        // Verify Push Chain counter incremented (Route 3 inbound from Solana)
        const pollStart = Date.now();
        let pushCounterAfter = pushCounterBefore;
        while (Date.now() - pollStart < 180000) {
          await new Promise((r) => setTimeout(r, 10000));
          pushCounterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
          }) as bigint;
          console.log(`Polling Push counter: ${pushCounterAfter} (elapsed: ${Math.round((Date.now() - pollStart) / 1000)}s)`);
          if (pushCounterAfter > pushCounterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${pushCounterAfter}`);
        expect(pushCounterAfter).toBeGreaterThan(pushCounterBefore);
      }, 900000);
    });
  });

  // ============================================================================
  // Additional Tests
  // ============================================================================
  describe('Additional Tests', () => {

    // ==========================================================================
    // Transaction Preparation
    // ==========================================================================
    describe('Transaction Preparation', () => {
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

    // ==========================================================================
    // Builder API
    // ==========================================================================
    describe('Builder API', () => {
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
    });

    // ==========================================================================
    // Cascade Execution
    // ==========================================================================
    describe('Cascade Execution', () => {
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
    });

    // ==========================================================================
    // Execution Tracking
    // ==========================================================================
    describe('Execution Tracking', () => {
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
});
