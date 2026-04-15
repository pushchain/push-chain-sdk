import '@e2e/shared/setup';
/**
 * Multichain Docs Examples — E2E (simulates fresh wallet + prompt funding)
 *
 * Tests the 3 "More Examples" from Send Multichain Transactions docs:
 *   #1 Fund BNB CEA then Increment Counter (2-hop cascade)
 *   #2 Batch Contract Calls: Push + BNB + Solana (3-hop cascade)
 *   #3 Cross-Chain AMM Swap: ETH → pSOL (3-hop cascade) — skipped if no pETH
 *
 * Each test creates a random wallet, pre-funds its UEA from the main wallet
 * (simulating the prompt), then runs the exact cascade code from the docs.
 */
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  formatEther,
  defineChain,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { createProgressTracker } from '@e2e/shared/progress-tracker';
import { TEST_PROGRAM as SOL_TEST_PROGRAM } from '@e2e/shared/svm-outbound-helpers';
import testCounterIdl from '../../src/lib/orchestrator/svm-idl/__fixtures__/test_counter.idl.json';

const SEPOLIA_RPC = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];
const PUSH_RPC = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0];
const PUSH_CHAIN_DEF = defineChain({
  id: Number(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId),
  name: 'Push Testnet',
  nativeCurrency: { name: 'PC', symbol: 'PC', decimals: 18 },
  rpcUrls: { default: { http: [PUSH_RPC] } },
});

// Counters (same as docs)
const COUNTER_PUSH = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const COUNTER_BNB = '0x7f0936bb90e7dcf3edb47199c2005e7184e44cf8';
const COUNTER_ABI = [
  { inputs: [], name: 'increment', outputs: [], stateMutability: 'nonpayable', type: 'function' },
] as const;

const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
const skipE2E = !privateKey;

describe('Multichain Docs Examples (Fresh Wallet)', () => {
  let mainAccount: ReturnType<typeof privateKeyToAccount>;
  let sepoliaPublicClient: ReturnType<typeof createPublicClient>;
  let pushPublicClient: ReturnType<typeof createPublicClient>;
  let pushEoaWallet: ReturnType<typeof createWalletClient>;

  // Creates a fresh wallet, funds it, pre-funds UEA with PC
  async function createFundedFreshWallet(): Promise<{ client: PushChain; walletAddress: string }> {
    const freshKey = generatePrivateKey();
    const freshAccount = privateKeyToAccount(freshKey);
    console.log(`\n  Fresh wallet: ${freshAccount.address}`);

    // 1. Fund Sepolia ETH
    const mainWalletClient = createWalletClient({
      account: mainAccount, chain: sepolia, transport: http(SEPOLIA_RPC),
    });
    const fundHash = await mainWalletClient.sendTransaction({
      to: freshAccount.address, value: parseEther('0.02'),
    });
    await sepoliaPublicClient.waitForTransactionReceipt({ hash: fundHash });

    // 2. Init fresh PushChain client
    const freshWalletClient = createWalletClient({
      account: freshAccount, chain: sepolia, transport: http(SEPOLIA_RPC),
    });
    const tracker = createProgressTracker();
    const signer = await PushChain.utils.signer.toUniversalFromKeypair(
      freshWalletClient,
      { chain: CHAIN.ETHEREUM_SEPOLIA, library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM },
    );
    const freshPushClient = await PushChain.initialize(signer, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      printTraces: true,
      progressHook: tracker.hook,
    });
    const freshUea = freshPushClient.universal.account;
    console.log(`  Fresh UEA: ${freshUea}`);

    // 3. Pre-fund UEA with native PC from main EOA BEFORE deploying.
    // The UEA contract doesn't exist yet, but the address can hold PC.
    // When fee-locking deploys it during the cascade, the PC is already there.
    // prepareTransaction will see the balance and compute correct nativeValueForGas.
    const pcAmount = parseEther('5');
    const pcHash = await (pushEoaWallet as any).sendTransaction({
      to: freshUea as `0x${string}`, value: pcAmount,
    });
    await pushPublicClient.waitForTransactionReceipt({ hash: pcHash });
    console.log(`  Funded ${formatEther(pcAmount)} PC`);

    return { client: freshPushClient, walletAddress: freshAccount.address };
  }

  beforeAll(async () => {
    if (skipE2E) return;
    mainAccount = privateKeyToAccount(privateKey);
    sepoliaPublicClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });
    pushPublicClient = createPublicClient({ transport: http(PUSH_RPC) });
    pushEoaWallet = createWalletClient({
      account: mainAccount, chain: PUSH_CHAIN_DEF, transport: http(PUSH_RPC),
    });
    console.log(`Main EOA: ${mainAccount.address}`);
  }, 30000);

  // =========================================================================
  // #1  Fund BNB CEA then Increment Counter (2-hop cascade)
  //     Hop 0 (Route 1): increment counter on Push Chain
  //     Hop 1 (Route 2): increment counter on BNB Testnet via CEA
  // =========================================================================
  it('#1 Fund BNB CEA & Counter: Route 1 + Route 2 cascade', async () => {
    if (skipE2E) return;
    console.log('\n=== #1 Fund BNB CEA & Counter ===');

    const { client } = await createFundedFreshWallet();
    const calldata = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI], functionName: 'increment',
    });

    // Exact same code as the docs example
    const hop0 = await client.universal.prepareTransaction({
      to: COUNTER_PUSH, value: BigInt(0), data: calldata,
    });
    console.log(`hop0 prepared - route: ${hop0.route}`);

    const hop1 = await client.universal.prepareTransaction({
      to: { address: COUNTER_BNB, chain: CHAIN.BNB_TESTNET },
      value: BigInt(0), data: calldata,
    });
    console.log(`hop1 prepared - route: ${hop1.route}`);

    const cascade = await client.universal.executeTransactions([hop0, hop1]);
    console.log(`Cascade submitted: ${cascade.initialTxHash} | hops: ${cascade.hopCount}`);
    expect(cascade.hopCount).toBe(2);

    const result = await cascade.wait({
      progressHook: (e: any) => console.log(`  [Hop ${e.hopIndex}] ${e.status} on ${e.chain}`),
    });
    console.log(`Success: ${result.success}`);
    expect(result.success).toBe(true);
  }, 600000);

  // =========================================================================
  // #2  Batch Contract Calls: Push + BNB + Solana (3-hop cascade)
  //     Hop 0 (Route 1): Push Chain counter
  //     Hop 1 (Route 2): BNB counter via CEA
  //     Hop 2 (Route 2): Solana Devnet via CEA
  // =========================================================================
  it('#2 Batch Calls: Route 1 + Route 2 BNB + Route 2 Solana', async () => {
    if (skipE2E) return;
    console.log('\n=== #2 Batch Contract Calls ===');

    const { client, walletAddress } = await createFundedFreshWallet();
    const calldata = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI], functionName: 'increment',
    });

    const hop0 = await client.universal.prepareTransaction({
      to: COUNTER_PUSH, value: BigInt(0), data: calldata,
    });
    console.log(`hop0 prepared - route: ${hop0.route}`);

    const hop1 = await client.universal.prepareTransaction({
      to: { address: COUNTER_BNB, chain: CHAIN.BNB_TESTNET },
      value: BigInt(0), data: calldata,
    });
    console.log(`hop1 prepared - route: ${hop1.route}`);

    // Hop 2: IDL-driven — matches docs verbatim. SDK resolves accounts from the registered IDL.
    // CPI-only (no value) — no pSOL burn needed.
    const solCalldata = PushChain.utils.helpers.encodeTxData({
      abi: testCounterIdl,
      functionName: 'receive_sol',
      args: [BigInt(0)],
    });
    const hop2 = await client.universal.prepareTransaction({
      to: { address: SOL_TEST_PROGRAM, chain: CHAIN.SOLANA_DEVNET },
      value: BigInt(0),
      data: solCalldata,
    });
    console.log(`hop2 prepared - route: ${hop2.route}`);

    const cascade = await client.universal.executeTransactions([hop0, hop1, hop2]);
    console.log(`Cascade submitted: ${cascade.initialTxHash} | hops: ${cascade.hopCount}`);
    expect(cascade.hopCount).toBe(3);

    const result = await cascade.wait({
      progressHook: (e: any) => console.log(`  [Hop ${e.hopIndex}] ${e.status} on ${e.chain}`),
    });
    console.log(`Success: ${result.success}`);
    expect(result.success).toBe(true);
  }, 600000);
});
