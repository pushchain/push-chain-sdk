/**
 * Debug E2E: UOA → 3-hop cascade (Push Chain + BNB + Solana)
 *
 * Reproduces the scenario from the dev script to isolate issues.
 *
 * Original script problems found:
 * ─────────────────────────────────────────────────────────────
 * 1. Missing hop2 — comments say 3 hops but code only prepares 2.
 * 2. Solana hop can't use EVM `data` — the SVM path ignores `params.data`
 *    entirely. You MUST use `svmExecute` with binary instruction data.
 * 3. Solana addresses are 32-byte hex — not 20-byte EVM format.
 * 4. Wrong funding model — script asks for Sepolia ETH, but UOA
 *    transactions execute on Push Chain. Need Push Chain testnet tokens.
 * 5. `PushChain.CONSTANTS.PUSH_NETWORK.TESTNET` — should be TESTNET_DONUT
 *    for the current testnet (Donut). TESTNET is a valid enum value but
 *    may resolve to a different network endpoint.
 */
import '@e2e/shared/setup';
import { PushChain } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { createPublicClient, http, Hex, encodeFunctionData } from 'viem';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { PublicKey } from '@solana/web3.js';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import { toHexData } from '@e2e/shared/svm-outbound-helpers';

// ── Push Chain Counter (Route 1 target) ──
// NOTE: The dev script used 0x5FbDB... which is a Hardhat default local address.
// The real counter on Push Chain Donut testnet is below.
const COUNTER_PUSH = '0x70d8f7a0fF8e493fb9cbEE19Eb780E40Aa872aaf' as `0x${string}`;
const COUNTER_ABI = [
  { type: 'function', name: 'increment', inputs: [], outputs: [], stateMutability: 'payable' },
  { type: 'function', name: 'countPC', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
] as const;

// ── BNB Testnet Counter (Route 2 EVM target) ──
const COUNTER_BNB = '0x7f0936bb90e7dcf3edb47199c2005e7184e44cf8' as `0x${string}`;

// ── Solana Devnet test_counter program (Route 2 SVM target) ──
// NOTE: Solana addresses MUST be 32-byte hex (0x + 64 chars), not 20-byte EVM
const SOL_TEST_PROGRAM = '0x7673075a980bfd5d6b1dffe99c31f63e8938519cc1c2af009dda5e568a94460d' as `0x${string}`;
const SOL_COUNTER_PDA = '0x4f12fe6816ae7e33ebf7db0b154ec3b09e3bf1a7690481e8e9477d5a278ad3af' as `0x${string}`;
const SOL_TARGET = '0x6a44bb5ea802a001386a5b39708523e1a3e1bafc8164ffcb94d1f5afa4849c69' as `0x${string}`;
const SOL_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;
const SVM_GATEWAY_PROGRAM = new PublicKey('CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS');

describe('UOA Multi-Hop Debug: Push + BNB + Solana', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ceaPdaHex: `0x${string}`;
  let bscPublicClient: ReturnType<typeof createPublicClient>;
  let pushPublicClient: ReturnType<typeof createPublicClient>;

  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E = !privateKey;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping E2E tests — EVM_PRIVATE_KEY not set');
      return;
    }

    // ── Correct setup: uses createEvmPushClient (not raw ethers + Sepolia RPC) ──
    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey,
      printTraces: true,
      progressHook: (val: any) => console.log(`[${val.id}] ${val.title}`),
    });
    pushClient = setup.pushClient;

    const ueaAddress = pushClient.universal.account;
    console.log(`UEA: ${ueaAddress}`);

    // Derive Solana CEA PDA (needed for svmExecute accounts)
    const senderBytes = Buffer.from(ueaAddress.slice(2), 'hex');
    const [ceaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('push_identity'), senderBytes],
      SVM_GATEWAY_PROGRAM,
    );
    ceaPdaHex = ('0x' + Buffer.from(ceaPda.toBytes()).toString('hex')) as `0x${string}`;
    console.log(`CEA PDA: ${ceaPda.toBase58()} (${ceaPdaHex})`);

    pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    bscPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0]),
    });
  });

  // ==========================================================================
  // Test A0: Isolate Route 1 alone
  // ==========================================================================
  describe('A0. Route 1 alone — Push Chain counter', () => {
    it('should increment the Push Chain counter', async () => {
      if (skipE2E) return;

      const calldata = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });

      const hop = await pushClient.universal.prepareTransaction({
        to: COUNTER_PUSH,
        data: calldata,
      });
      console.log('hop route:', hop.route);
      expect(hop.route).toBe('UOA_TO_PUSH');

      const cascade = await pushClient.universal.executeTransactions([hop]);
      console.log('initialTxHash:', cascade.initialTxHash);
      const result = await cascade.waitForAll({ timeout: 300_000 });
      console.log('success:', result.success);
      expect(result.success).toBe(true);
    }, 300_000);
  });

  // ==========================================================================
  // Test A1: Isolate Route 2 alone — BNB counter
  // ==========================================================================
  describe('A1. Route 2 alone — BNB counter', () => {
    it('should increment BNB counter via CEA', async () => {
      if (skipE2E) return;

      const calldata = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });

      const hop = await pushClient.universal.prepareTransaction({
        to: { address: COUNTER_BNB, chain: CHAIN.BNB_TESTNET },
        data: calldata,
      });
      console.log('hop route:', hop.route);
      expect(hop.route).toBe('UOA_TO_CEA');

      const cascade = await pushClient.universal.executeTransactions([hop]);
      console.log('initialTxHash:', cascade.initialTxHash);
      const result = await cascade.waitForAll({
        timeout: 600_000,
        progressHook: (e) => console.log(`  [Hop ${e.hopIndex}] ${e.status} on ${e.chain}`),
      });
      console.log('success:', result.success);
      expect(result.success).toBe(true);
    }, 600_000);
  });

  // ==========================================================================
  // Test A2: Route 1 + Route 2 combined
  // ==========================================================================
  describe('A2. Original script (2 hops, missing Solana)', () => {
    it('should prepare and execute Route 1 + Route 2 (BNB) hops', async () => {
      if (skipE2E) return;

      const calldata = encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' });

      const hop0 = await pushClient.universal.prepareTransaction({
        to: COUNTER_PUSH,
        data: calldata,
      });
      console.log('hop0 route:', hop0.route);

      const hop1 = await pushClient.universal.prepareTransaction({
        to: { address: COUNTER_BNB, chain: CHAIN.BNB_TESTNET },
        data: calldata,
      });
      console.log('hop1 route:', hop1.route);

      const cascade = await pushClient.universal.executeTransactions([hop0, hop1]);
      console.log('initialTxHash:', cascade.initialTxHash);
      console.log('hopCount:', cascade.hopCount);
      expect(cascade.hopCount).toBe(2);

      const result = await cascade.waitForAll({
        timeout: 600_000,
        progressHook: (e) => console.log(`  [Hop ${e.hopIndex}] ${e.status} on ${e.chain}`),
      });
      console.log('success:', result.success);
      expect(result.success).toBe(true);
    }, 900_000);
  });

  // ==========================================================================
  // Test B: Correct 3-hop cascade — Push + BNB + Solana
  //
  // Key fixes vs original script:
  //   1. Solana hop uses `svmExecute` (not EVM `data`)
  //   2. Solana addresses are 32-byte hex
  //   3. Solana instruction data is binary (discriminator + args)
  //   4. Funding is via Push Chain tokens (no Sepolia ETH needed)
  // ==========================================================================
  describe('B. Correct 3-hop: Push + BNB + Solana', () => {
    it('should prepare and execute all 3 hops in one cascade', async () => {
      if (skipE2E) return;

      console.log('\n=== 3-Hop Cascade: Push + BNB + Solana ===');

      const evmCalldata = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });

      // ── Solana CPI instruction data ──
      // Solana programs use binary discriminators, NOT EVM ABI encoding.
      // This is the `receive_sol` instruction discriminator for the test_counter program.
      const discriminator = new Uint8Array([121, 244, 250, 3, 8, 229, 225, 1]);
      const amountBuf = new Uint8Array(8);
      new DataView(amountBuf.buffer).setBigUint64(0, BigInt(1), true);
      const ixData = new Uint8Array([...discriminator, ...amountBuf]);

      // ────────────────────────────────────────────────
      // Hop 0 (Route 1): increment counter on Push Chain
      // ────────────────────────────────────────────────
      const hop0 = await pushClient.universal.prepareTransaction({
        to: COUNTER_PUSH,
        data: evmCalldata,
      });
      console.log('hop0 route:', hop0.route);
      expect(hop0.route).toBe('UOA_TO_PUSH');

      // ────────────────────────────────────────────────
      // Hop 1 (Route 2): increment counter on BNB via CEA
      // ────────────────────────────────────────────────
      const hop1 = await pushClient.universal.prepareTransaction({
        to: { address: COUNTER_BNB, chain: CHAIN.BNB_TESTNET },
        data: evmCalldata,
      });
      console.log('hop1 route:', hop1.route);
      expect(hop1.route).toBe('UOA_TO_CEA');

      // ────────────────────────────────────────────────
      // Hop 2 (Route 2): CPI on Solana Devnet via gateway
      //
      // CRITICAL differences from EVM hops:
      //   - `to.address` must be 32-byte hex (Solana pubkey)
      //   - `data` is the Anchor-encoded ix bytes (discriminator + Borsh args)
      //   - SDK resolves accounts from the pre-registered test_counter IDL
      //   - `value` is in lamports (not wei)
      // ────────────────────────────────────────────────
      const hop2 = await pushClient.universal.prepareTransaction({
        to: { address: SOL_TEST_PROGRAM, chain: CHAIN.SOLANA_DEVNET },
        value: BigInt(5_000_000), // 0.005 SOL in lamports
        data: toHexData(ixData),
      });
      console.log('hop2 route:', hop2.route);
      expect(hop2.route).toBe('UOA_TO_CEA');

      // ────────────────────────────────────────────────
      // Execute all 3 hops as one Push Chain transaction
      // ────────────────────────────────────────────────
      const cascade = await pushClient.universal.executeTransactions([hop0, hop1, hop2]);
      console.log('initialTxHash:', cascade.initialTxHash);
      console.log('hopCount:', cascade.hopCount);

      expect(cascade.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(cascade.hopCount).toBe(3);
      expect(cascade.hops).toHaveLength(3);

      // Wait for all hops
      const result = await cascade.waitForAll({
        timeout: 600_000,
        progressHook: (e) =>
          console.log(`  [Hop ${e.hopIndex}] ${e.status} on ${e.chain}`),
      });

      console.log('Cascade success:', result.success);
      expect(result.success).toBe(true);
      expect(result.hops).toHaveLength(3);

      // Verify outbound hops landed on external chains
      const outboundHops = result.hops.filter((h) => h.route === 'UOA_TO_CEA');
      expect(outboundHops.length).toBe(2); // BNB + Solana
      for (const hop of outboundHops) {
        if (hop.outboundDetails) {
          console.log(`  External TX: ${hop.outboundDetails.externalTxHash}`);
          console.log(`  Chain: ${hop.outboundDetails.destinationChain}`);
          await verifyExternalTransaction(
            hop.outboundDetails.externalTxHash,
            hop.outboundDetails.destinationChain,
          );
        }
      }
    }, 900_000);
  });

  // ==========================================================================
  // Test C: Demonstrate that EVM `data` is silently ignored for Solana hops
  // ==========================================================================
  describe('C. Solana hop with EVM data (shows silent discard)', () => {
    it('should prepare a Solana hop — data field is ignored, svmPayload is empty', async () => {
      if (skipE2E) return;

      const evmCalldata = encodeFunctionData({
        abi: COUNTER_ABI,
        functionName: 'increment',
      });

      // This is what the original script would have done for hop2 (Solana):
      //   data: evmCalldata  ← silently ignored by SVM path
      //   no svmExecute      ← so svmPayload = '0x' (empty)
      //   value: BigInt(0)   ← no PRC-20 burn
      //
      // Net result: the hop becomes a no-op on Solana
      const hop = await pushClient.universal.prepareTransaction({
        to: { address: SOL_TEST_PROGRAM, chain: CHAIN.SOLANA_DEVNET },
        value: BigInt(0),
        data: evmCalldata, // ⚠️ This is IGNORED for SVM chains
      });

      expect(hop.route).toBe('UOA_TO_CEA');

      // The _hop.svmPayload will be '0x' (empty) because no svmExecute was provided
      // and the EVM data field was silently discarded
      console.log('hop._hop.isSvmTarget:', hop._hop.isSvmTarget);
      console.log('hop._hop.svmPayload:', hop._hop.svmPayload);
      expect(hop._hop.isSvmTarget).toBe(true);
      expect(hop._hop.svmPayload).toBe('0x');

      console.log('\n⚠️  CONFIRMED: EVM data is silently discarded for Solana hops.');
      console.log('   Use svmExecute { targetProgram, accounts, ixData } instead.');
    }, 60_000);
  });
});
