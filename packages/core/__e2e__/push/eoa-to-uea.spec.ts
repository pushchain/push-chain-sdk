import '@e2e/shared/setup';
/**
 * EOA → UEA Transfer Tests
 *
 * Validates two scenarios:
 * 1. Random EOA sending value to a RANDOM (other) UEA
 * 2. Random EOA sending value to its OWN UEA (self-transfer)
 *
 * Both cases use fresh wallets (undeployed UEAs) funded on the origin chain
 * and on Push Chain to ensure the transaction can go through.
 */
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import {
  createWalletClient,
  createPublicClient,
  http,
  type Hex,
} from 'viem';
import {
  generatePrivateKey,
  privateKeyToAccount,
} from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { createProgressTracker } from '@e2e/shared/progress-tracker';

const SEPOLIA_RPC = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];
const PUSH_RPC = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0];

const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
const skipE2E = !privateKey;

describe('EOA → UEA Transfers', () => {
  // Main wallet — already deployed UEA, used to fund fresh wallets
  let mainPushClient: PushChain;
  let mainWalletClient: ReturnType<typeof createWalletClient>;

  const sepoliaPublicClient = createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC),
  });

  const pushPublicClient = createPublicClient({
    transport: http(PUSH_RPC),
  });

  beforeAll(async () => {
    if (skipE2E) return;

    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey,
      progressHook: (v) => console.log('[main]', v.id, v.title),
    });
    mainPushClient = setup.pushClient;
    mainWalletClient = setup.walletClient;
  }, 120_000);

  // ==========================================================================
  // Test 1: Random EOA → Random (other) UEA
  //
  // Creates two fresh wallets:
  //   - Sender: fresh EOA funded on Sepolia + its UEA funded on Push Chain
  //   - Receiver: fresh EOA whose UEA address is computed but NOT funded/deployed
  //
  // Sender's UEA sends value to Receiver's UEA address.
  // ==========================================================================
  it('should transfer value from random EOA to a different random UEA', async () => {
    if (skipE2E) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    const tracker = createProgressTracker();

    // --- Sender: fresh wallet ---
    const senderKey = generatePrivateKey();
    const senderAccount = privateKeyToAccount(senderKey);
    console.log(`\nSender EOA: ${senderAccount.address}`);

    // Fund sender on Sepolia
    const fundSenderHash = await mainWalletClient.sendTransaction({
      to: senderAccount.address,
      value: BigInt(1e15), // 0.001 ETH — covers fee-locking gas
      account: mainWalletClient.account!,
      chain: sepolia,
    });
    await sepoliaPublicClient.waitForTransactionReceipt({ hash: fundSenderHash });
    console.log(`Sender funded on Sepolia: ${fundSenderHash}`);

    // Create sender's PushChain client
    const senderWalletClient = createWalletClient({
      account: senderAccount,
      chain: sepolia,
      transport: http(SEPOLIA_RPC),
    });
    const senderSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      senderWalletClient,
      {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );
    const senderPushClient = await PushChain.initialize(senderSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: tracker.hook,
    });
    const senderUEA = senderPushClient.universal.account;
    console.log(`Sender UEA: ${senderUEA}`);

    // --- Receiver: fresh wallet (just derive the UEA address) ---
    const receiverKey = generatePrivateKey();
    const receiverAccount = privateKeyToAccount(receiverKey);
    console.log(`Receiver EOA: ${receiverAccount.address}`);

    const receiverWalletClient = createWalletClient({
      account: receiverAccount,
      chain: sepolia,
      transport: http(SEPOLIA_RPC),
    });
    const receiverSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      receiverWalletClient,
      {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );
    const receiverUEA = await PushChain.utils.account.convertOriginToExecutor(
      receiverSigner.account,
      { onlyCompute: true }
    );
    console.log(`Receiver UEA: ${receiverUEA.address} (deployed: ${receiverUEA.deployed})`);

    // --- Send value from sender's UEA to receiver's UEA ---
    const sendAmount = BigInt(100);
    console.log(`\nSending ${sendAmount} wei from sender UEA → receiver UEA...`);

    const tx = await senderPushClient.universal.sendTransaction({
      to: receiverUEA.address,
      value: sendAmount,
    });

    console.log(`TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
    expect(receipt.status).toBe(1);

    // Verify receiver UEA balance increased
    const receiverBalance = await pushPublicClient.getBalance({
      address: receiverUEA.address,
    });
    console.log(`Receiver UEA balance after transfer: ${receiverBalance} wei`);
    expect(receiverBalance).toBeGreaterThanOrEqual(sendAmount);

    // Dump progress events
    console.log('\n=== Progress Events ===');
    for (const { event } of tracker.events) {
      console.log(`  [${event.id}] (${event.level}) ${event.title}: ${event.message}`);
    }
  }, 300_000);

  // ==========================================================================
  // Test 2: Random EOA → Self UEA
  //
  // Creates a fresh wallet, funds it on Sepolia, and sends value from the
  // fresh wallet's UEA to itself (to: own UEA address).
  // ==========================================================================
  it('should transfer value from random EOA to its own UEA (self-transfer)', async () => {
    if (skipE2E) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    const tracker = createProgressTracker();

    // --- Fresh wallet ---
    const freshKey = generatePrivateKey();
    const freshAccount = privateKeyToAccount(freshKey);
    console.log(`\nFresh EOA: ${freshAccount.address}`);

    // Fund fresh wallet on Sepolia
    const fundHash = await mainWalletClient.sendTransaction({
      to: freshAccount.address,
      value: BigInt(1e15), // 0.001 ETH — covers fee-locking gas
      account: mainWalletClient.account!,
      chain: sepolia,
    });
    await sepoliaPublicClient.waitForTransactionReceipt({ hash: fundHash });
    console.log(`Fresh wallet funded on Sepolia: ${fundHash}`);

    // Create fresh wallet's PushChain client
    const freshWalletClient = createWalletClient({
      account: freshAccount,
      chain: sepolia,
      transport: http(SEPOLIA_RPC),
    });
    const freshSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      freshWalletClient,
      {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );
    const freshPushClient = await PushChain.initialize(freshSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: tracker.hook,
    });
    const freshUEA = freshPushClient.universal.account;
    console.log(`Fresh UEA: ${freshUEA}`);

    // Check UEA state before self-transfer
    const codeBefore = await pushPublicClient.getCode({ address: freshUEA });
    const balanceBefore = await pushPublicClient.getBalance({ address: freshUEA });
    console.log(`UEA deployed before: ${codeBefore !== undefined}`);
    console.log(`UEA balance before:  ${balanceBefore} wei`);

    // --- Self-transfer: send value to own UEA ---
    const sendAmount = BigInt(1e3);
    console.log(`\nSending ${sendAmount} wei to self UEA...`);

    const tx = await freshPushClient.universal.sendTransaction({
      to: freshUEA,
      value: sendAmount,
    });

    console.log(`TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
    expect(receipt.status).toBe(1);

    // Check UEA state after self-transfer — UEA should now be deployed
    const codeAfter = await pushPublicClient.getCode({ address: freshUEA });
    console.log(`UEA deployed after: ${codeAfter !== undefined}`);

    // Dump progress events
    console.log('\n=== Progress Events ===');
    for (const { event } of tracker.events) {
      console.log(`  [${event.id}] (${event.level}) ${event.title}: ${event.message}`);
    }
  }, 300_000);
});
