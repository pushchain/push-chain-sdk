import '@e2e/shared/setup';
/**
 * Route 3: Fresh Wallet "UEA is not deployed" Bug Reproduction
 *
 * Reproduces the failure that occurs when a FRESH wallet (UEA not yet deployed)
 * attempts a Route 3 inbound transaction (CEA → Push Chain).
 *
 * Root cause: Route 3 uses the signed verification path (not fee-locking),
 * which broadcasts a Cosmos MsgExecutePayload. The chain rejects this with
 * "UEA is not deployed" because the UEA must exist before a CEA can bridge
 * funds/payloads back to it.
 *
 * PRE-FIX:  Test 1 (fresh wallet, no prior UEA) FAILS with "UEA is not deployed"
 * POST-FIX: SDK should auto-deploy UEA before attempting Route 3,
 *           or use fee-locking path which auto-deploys UEA.
 * Test 2 (deployed UEA baseline) should always PASS.
 */
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
  parseEther,
  type Hex,
  type WalletClient,
  type PublicClient,
} from 'viem';
import {
  generatePrivateKey,
  privateKeyToAccount,
} from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { COUNTER_ABI } from '@e2e/shared/outbound-helpers';
import { createProgressTracker } from '@e2e/shared/progress-tracker';

// Push Chain counter contract (Route 3 executes ON Push Chain, not external)
const PUSH_COUNTER_ADDRESS = '0x7f0936bb90e7dcf3edb47199c2005e7184e44cf8' as `0x${string}`;

// Sepolia RPC for funding fresh wallets
const SEPOLIA_RPC = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];

const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
const skipE2E = !privateKey;

describe('Route 3: Fresh Wallet UEA Not Deployed Bug', () => {
  let mainWalletClient: WalletClient;
  let publicClient: PublicClient;

  beforeAll(async () => {
    if (skipE2E) return;

    const mainAccount = privateKeyToAccount(privateKey);
    mainWalletClient = createWalletClient({
      account: mainAccount,
      chain: sepolia,
      transport: http(SEPOLIA_RPC),
    });
    publicClient = createPublicClient({
      chain: sepolia,
      transport: http(SEPOLIA_RPC),
    });
  }, 30000);

  // ==========================================================================
  // Test 1: Fresh wallet Route 3 — CEA → Push Chain (payload only)
  //
  // PRE-FIX:  FAILS with "UEA is not deployed" because the signed verification
  //           path requires the UEA to exist on Push Chain before Route 3 can
  //           execute.
  // POST-FIX: SDK should detect fresh wallet and auto-deploy UEA first (e.g.,
  //           via fee-locking self-transfer), then proceed with Route 3.
  // ==========================================================================
  it('should execute Route 3 from a fresh wallet (UEA auto-deploy)', async () => {
    if (skipE2E) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    // Create a fresh random wallet
    const freshPrivateKey = generatePrivateKey();
    const freshAccount = privateKeyToAccount(freshPrivateKey);
    console.log(`\n=== Fresh wallet: ${freshAccount.address} ===`);

    // Fund the fresh wallet with Sepolia ETH
    const fundTxHash = await mainWalletClient.sendTransaction({
      to: freshAccount.address,
      value: parseEther('0.005'),
      account: mainWalletClient.account!,
      chain: sepolia,
    });
    await publicClient.waitForTransactionReceipt({ hash: fundTxHash });
    console.log(`Funded fresh wallet: ${fundTxHash}`);

    // Create PushChain client with the fresh wallet
    const freshWalletClient = createWalletClient({
      account: freshAccount,
      chain: sepolia,
      transport: http(SEPOLIA_RPC),
    });

    const tracker = createProgressTracker();
    const universalSigner =
      await PushChain.utils.signer.toUniversalFromKeypair(freshWalletClient, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      });
    const freshPushClient = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      printTraces: true,
      progressHook: tracker.hook,
    });

    const ueaAddress = freshPushClient.universal.account;
    console.log(`Fresh wallet UEA: ${ueaAddress}`);

    // Verify UEA is NOT deployed (fresh wallet)
    const pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    const ueaCode = await pushPublicClient.getCode({ address: ueaAddress });
    console.log(`UEA deployed before Route 3: ${ueaCode !== undefined}`);
    expect(ueaCode).toBeUndefined(); // Must be undeployed for this test

    // Encode increment() calldata for Push Chain counter
    const data = encodeFunctionData({
      abi: COUNTER_ABI,
      functionName: 'increment',
    });

    // Route 3: from: { chain } + to: string address
    // Fresh wallet — UEA not deployed.
    // PRE-FIX: Should fail with "UEA is not deployed"
    // POST-FIX: SDK should auto-deploy UEA then execute Route 3
    const tx = await freshPushClient.universal.sendTransaction({
      from: { chain: CHAIN.BNB_TESTNET },
      to: PUSH_COUNTER_ADDRESS,
      data,
    });

    console.log(`Push Chain TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // Wait for relay
    console.log('Waiting for outbound relay...');
    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
    console.log(`External TX Hash: ${receipt.externalTxHash}`);
    console.log(`External Chain: ${receipt.externalChain}`);

    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeDefined();
  }, 360000);

  // ==========================================================================
  // Test 2: Ethers v6 fresh wallet — mirrors the dev's external script exactly
  //
  // Uses ethers.js signer, toUniversal(), PUSH_NETWORK.TESTNET, and
  // encodeTxData() to match the dev's docs playground code.
  // ==========================================================================
  it('should execute Route 3 from ethers v6 fresh wallet (dev script scenario)', async () => {
    if (skipE2E) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    let ethers: typeof import('ethers');
    try {
      ethers = await import('ethers');
    } catch {
      console.log('Skipping — ethers not installed');
      return;
    }

    const wallet = ethers.Wallet.createRandom();
    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
    const signer = wallet.connect(provider);
    console.log(`\n=== Ethers v6 fresh wallet: ${wallet.address} ===`);

    // Fund from main wallet
    const mainAccount = privateKeyToAccount(privateKey);
    const fundTxHash = await mainWalletClient.sendTransaction({
      to: wallet.address as `0x${string}`,
      value: parseEther('0.005'),
      account: mainAccount,
      chain: sepolia,
    });
    await publicClient.waitForTransactionReceipt({ hash: fundTxHash });
    console.log(`Funded ethers wallet: ${fundTxHash}`);

    const tracker = createProgressTracker();
    const universalSigner = await PushChain.utils.signer.toUniversal(signer);
    const pushClient = await PushChain.initialize(universalSigner, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
      printTraces: true,
      progressHook: tracker.hook,
    });

    const ueaAddress = pushClient.universal.account;
    console.log(`Ethers fresh wallet UEA: ${ueaAddress}`);

    // Verify UEA is NOT deployed
    const pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    const ueaCode = await pushPublicClient.getCode({ address: ueaAddress });
    console.log(`UEA deployed before Route 3: ${ueaCode !== undefined}`);
    expect(ueaCode).toBeUndefined();

    const data = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });

    // Route 3: from: { chain } means "use my CEA on BNB_TESTNET"
    // to: string address means "execute on Push Chain"
    const tx = await pushClient.universal.sendTransaction({
      from: { chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
      to: PUSH_COUNTER_ADDRESS,
      data,
    });

    console.log(`Push Chain TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    console.log('Waiting for outbound relay...');
    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
    console.log(`External TX Hash: ${receipt.externalTxHash}`);
    console.log(`External Chain: ${receipt.externalChain}`);
    if (receipt.externalExplorerUrl) {
      console.log(`Explorer: ${receipt.externalExplorerUrl}`);
    }

    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeDefined();
  }, 360000);

  // ==========================================================================
  // Test 3: Baseline — Route 3 WITH prior UEA deployment (should always pass)
  //
  // Uses the main wallet whose UEA is already deployed. Acts as a control
  // test to confirm Route 3 works when UEA exists.
  // ==========================================================================
  it('should execute Route 3 from a deployed UEA (baseline)', async () => {
    if (skipE2E) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    console.log('\n=== Baseline: deployed UEA ===');

    const tracker = createProgressTracker();
    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey,
      printTraces: true,
      progressHook: tracker.hook,
    });
    const pushClient = setup.pushClient;
    const ueaAddress = pushClient.universal.account;
    console.log(`Main wallet UEA: ${ueaAddress}`);

    // Ensure UEA is deployed
    const pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    const code = await pushPublicClient.getCode({ address: ueaAddress });
    if (code === undefined) {
      console.log('UEA not deployed — deploying via self-transfer...');
      const deployTx = await pushClient.universal.sendTransaction({
        to: ueaAddress,
        value: BigInt(1),
      });
      const deployReceipt = await deployTx.wait();
      console.log(`UEA deployed — status: ${deployReceipt.status}`);
    }

    const data = encodeFunctionData({
      abi: COUNTER_ABI,
      functionName: 'increment',
    });

    // Route 3: should work because UEA is deployed
    const tx = await pushClient.universal.sendTransaction({
      from: { chain: CHAIN.BNB_TESTNET },
      to: PUSH_COUNTER_ADDRESS,
      data,
    });

    console.log(`Push Chain TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    console.log('Waiting for outbound relay...');
    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
    console.log(`External TX Hash: ${receipt.externalTxHash}`);
    console.log(`External Chain: ${receipt.externalChain}`);

    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeDefined();
  }, 360000);
});
