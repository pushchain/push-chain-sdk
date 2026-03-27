import '@e2e/shared/setup';
import { PushChain } from '../../../src';
import { CHAIN } from '../../../src/lib/constants/enums';
import { MOVEABLE_TOKENS } from '../../../src/lib/constants/tokens';
import {
  createWalletClient,
  createPublicClient,
  http,
  Hex,
  parseEther,
  encodeFunctionData,
} from 'viem';
import {
  privateKeyToAccount,
  generatePrivateKey,
} from 'viem/accounts';
import { sepolia } from 'viem/chains';


// Use a reliable Sepolia RPC (the default publicnode one can be flaky)
const SEPOLIA_RPC = 'https://1rpc.io/sepolia';

/**
 * E2E tests for pcTx `.at(-1)` fix.
 *
 * The orchestrator returns the **last** pcTx entry from
 * queryUniversalTxStatusFromGatewayTx, which is the final execution result.
 * A prior regression used `.find()` (first match) instead of `.at(-1)`,
 * returning the MintPC tx instead of the executePayload tx.
 *
 * These tests use a **fresh wallet** (generated private key, undeployed UEA)
 * funded from the main wallet — matching the exact user scenario that
 * exposed the bug.
 */
describe('pcTx last-transaction selection (e2e)', () => {
  const originChain = CHAIN.ETHEREUM_SEPOLIA;

  // Main funded wallet used to fund fresh wallets
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mainWalletClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let publicClient: any;
  let mainPushClient: PushChain;

  beforeAll(async () => {
    const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!privateKey) throw new Error('EVM_PRIVATE_KEY not set');

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

    const mainSigner =
      await PushChain.utils.signer.toUniversal(mainWalletClient);
    mainPushClient = await PushChain.initialize(mainSigner, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
      rpcUrls: { [originChain]: [SEPOLIA_RPC] },
    });

    console.log('\n=== PCTX LAST-TX TEST SETUP ===');
    console.log(`Main wallet: ${mainAccount.address}`);
    console.log(`USDT address: ${mainPushClient.moveable.token.USDT.address}`);
  }, 100000);

  /**
   * Helper: create a fresh wallet, fund it with ETH + USDT from the main wallet,
   * and return a PushChain client initialized with that fresh wallet.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function createFreshFundedClient(): Promise<{
    pushClient: PushChain;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    progressEvents: { event: any; timestamp: number }[];
    startTime: number;
  }> {
    const newPrivateKey = generatePrivateKey();
    const newAccount = privateKeyToAccount(newPrivateKey);
    console.log(`Fresh wallet: ${newAccount.address}`);

    // Fund with ETH for gas
    const ethTxHash = await mainWalletClient.sendTransaction({
      to: newAccount.address,
      value: parseEther('0.01'),
    });
    await publicClient.waitForTransactionReceipt({ hash: ethTxHash });
    console.log(`ETH funded: ${ethTxHash}`);

    // Fund with USDT
    const usdt = mainPushClient.moveable.token.USDT;
    const usdtAmount = PushChain.utils.helpers.parseUnits('0.05', {
      decimals: usdt.decimals,
    });
    const erc20TransferData = encodeFunctionData({
      abi: [
        {
          name: 'transfer',
          type: 'function',
          inputs: [
            { name: 'to', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          outputs: [{ type: 'bool' }],
        },
      ],
      functionName: 'transfer',
      args: [newAccount.address, usdtAmount],
    });
    const usdtTxHash = await mainWalletClient.sendTransaction({
      to: usdt.address as `0x${string}`,
      data: erc20TransferData,
    });
    await publicClient.waitForTransactionReceipt({ hash: usdtTxHash });
    console.log(`USDT funded: ${usdtTxHash}`);

    // Create PushChain client with fresh wallet
    const newWalletClient = createWalletClient({
      account: newAccount,
      chain: sepolia,
      transport: http(SEPOLIA_RPC),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progressEvents: { event: any; timestamp: number }[] = [];
    const startTime = Date.now();

    const newSigner =
      await PushChain.utils.signer.toUniversal(newWalletClient);
    const pushClient = await PushChain.initialize(newSigner, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
      rpcUrls: { [originChain]: [SEPOLIA_RPC] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      progressHook: (val: any) => {
        const now = Date.now();
        progressEvents.push({ event: val, timestamp: now });
        const elapsed = ((now - startTime) / 1000).toFixed(2);
        console.log(`[${elapsed}s] ${val.id}: ${val.title}`);
      },
    });

    console.log(`UEA: ${pushClient.universal.account}`);
    return { pushClient, progressEvents, startTime };
  }

  /**
   * Helper: create a PushChain client from the main wallet (already deployed UEA)
   * with progress hook tracking for assertions.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function createMainWalletClientWithHook(): Promise<{
    pushClient: PushChain;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    progressEvents: { event: any; timestamp: number }[];
    startTime: number;
  }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progressEvents: { event: any; timestamp: number }[] = [];
    const startTime = Date.now();

    const mainSigner =
      await PushChain.utils.signer.toUniversal(mainWalletClient);
    const pushClient = await PushChain.initialize(mainSigner, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
      rpcUrls: { [originChain]: [SEPOLIA_RPC] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      progressHook: (val: any) => {
        const now = Date.now();
        progressEvents.push({ event: val, timestamp: now });
        const elapsed = ((now - startTime) / 1000).toFixed(2);
        console.log(`[${elapsed}s] ${val.id}: ${val.title}`);
      },
    });

    console.log(`Main wallet UEA: ${pushClient.universal.account}`);
    return { pushClient, progressEvents, startTime };
  }

  it('should bridge USDT to self from fresh wallet (undeployed UEA)', async () => {
    console.log('\n=== BRIDGE USDT TO SELF — FRESH WALLET ===');
    const { pushClient, progressEvents } = await createFreshFundedClient();

    const usdt = pushClient.moveable.token.USDT;
    const amount = PushChain.utils.helpers.parseUnits('0.01', {
      decimals: usdt.decimals,
    });

    console.log(`Recipient: ${pushClient.universal.account} (self/UEA)`);
    console.log(`Amount: 0.01 USDT`);

    const tx = await pushClient.universal.sendTransaction({
      to: pushClient.universal.account,
      funds: { amount, token: usdt },
    });

    console.log(`TX Hash: ${tx.hash}`);
    expect(tx.hash).toBeDefined();
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log('Receipt:', JSON.stringify(receipt, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    expect(receipt.status).toBe(1);

    // Verify the full funds flow completed
    const hookIds = progressEvents.map((e) => e.event.id);
    expect(hookIds).toContain('SEND-TX-01');
    expect(hookIds).toContain('SEND-TX-06-06'); // Funds Credited on Push Chain
    expect(hookIds).toContain('SEND-TX-99-01'); // Completion
  }, 600000);

  it('should bridge USDT to different address from fresh wallet', async () => {
    console.log('\n=== BRIDGE USDT TO OTHER — FRESH WALLET ===');
    const { pushClient, progressEvents } = await createFreshFundedClient();

    const usdt = pushClient.moveable.token.USDT;
    const amount = PushChain.utils.helpers.parseUnits('0.01', {
      decimals: usdt.decimals,
    });
    const differentAddress =
      '0x742d35Cc6634c0532925A3b844BC9e7595F5bE21' as `0x${string}`;

    console.log(`Recipient: ${differentAddress}`);
    console.log(`Amount: 0.01 USDT`);

    const tx = await pushClient.universal.sendTransaction({
      to: differentAddress,
      funds: { amount, token: usdt },
    });

    console.log(`TX Hash: ${tx.hash}`);
    expect(tx.hash).toBeDefined();
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log(`Receipt Status: ${receipt.status}`);
    expect(receipt.status).toBe(1);

    const hookIds = progressEvents.map((e) => e.event.id);
    expect(hookIds).toContain('SEND-TX-01');
    expect(hookIds).toContain('SEND-TX-06-06');
    expect(hookIds).toContain('SEND-TX-99-01');
  }, 600000);

  it('should bridge native ETH to self from fresh wallet', async () => {
    console.log('\n=== BRIDGE NATIVE ETH TO SELF — FRESH WALLET ===');
    const { pushClient, progressEvents } = await createFreshFundedClient();

    const tokens = MOVEABLE_TOKENS[originChain] || [];
    const ethToken = tokens.find((t) => t.symbol === 'ETH');
    if (!ethToken) throw new Error('ETH token not found for Sepolia');

    const amount = PushChain.utils.helpers.parseUnits('0.0001', 18);

    console.log(`Recipient: ${pushClient.universal.account} (self/UEA)`);
    console.log(`Amount: 0.0001 ETH`);

    const tx = await pushClient.universal.sendTransaction({
      to: pushClient.universal.account,
      funds: { amount, token: ethToken },
    });

    console.log(`TX Hash: ${tx.hash}`);
   
    expect(tx.hash).toBeDefined();
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log(`Receipt : ${JSON.stringify(receipt, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2)}`);

    console.log(`Receipt Status: ${receipt.status}`);
    expect(receipt.status).toBe(1);

    const hookIds = progressEvents.map((e) => e.event.id);
    expect(hookIds).toContain('SEND-TX-01');
    expect(hookIds).toContain('SEND-TX-06-06');
    expect(hookIds).toContain('SEND-TX-99-01');
  }, 600000);

  it('should bridge native ETH to different address from fresh wallet', async () => {
    console.log('\n=== BRIDGE NATIVE ETH TO OTHER — FRESH WALLET ===');
    const { pushClient, progressEvents } = await createFreshFundedClient();

    const tokens = MOVEABLE_TOKENS[originChain] || [];
    const ethToken = tokens.find((t) => t.symbol === 'ETH');
    if (!ethToken) throw new Error('ETH token not found for Sepolia');

    const amount = PushChain.utils.helpers.parseUnits('0.0001', 18);
    const differentAddress =
      '0x742d35Cc6634c0532925A3b844BC9e7595F5bE21' as `0x${string}`;

    console.log(`Recipient: ${differentAddress}`);
    console.log(`Amount: 0.0001 ETH`);

    const tx = await pushClient.universal.sendTransaction({
      to: differentAddress,
      funds: { amount, token: ethToken },
    });

    console.log(`TX Hash: ${tx.hash}`);
    expect(tx.hash).toBeDefined();
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log('Receipt:', JSON.stringify(receipt, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    expect(receipt.status).toBe(1);

    const hookIds = progressEvents.map((e) => e.event.id);
    expect(hookIds).toContain('SEND-TX-01');
    expect(hookIds).toContain('SEND-TX-06-06');
    expect(hookIds).toContain('SEND-TX-99-01');
  }, 600000);

  // ========== EXISTING WALLET (deployed UEA) TESTS ==========

  it('should bridge USDT to self from existing wallet (deployed UEA)', async () => {
    console.log('\n=== BRIDGE USDT TO SELF — EXISTING WALLET ===');
    const { pushClient, progressEvents } = await createMainWalletClientWithHook();

    const usdt = pushClient.moveable.token.USDT;
    const amount = PushChain.utils.helpers.parseUnits('0.01', {
      decimals: usdt.decimals,
    });

    console.log(`Recipient: ${pushClient.universal.account} (self/UEA)`);
    console.log(`Amount: 0.01 USDT`);

    const tx = await pushClient.universal.sendTransaction({
      to: pushClient.universal.account,
      funds: { amount, token: usdt },
    });

    console.log(`TX Hash: ${tx.hash}`);
    expect(tx.hash).toBeDefined();
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log('Receipt:', JSON.stringify(receipt, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    expect(receipt.status).toBe(1);

    const hookIds = progressEvents.map((e) => e.event.id);
    expect(hookIds).toContain('SEND-TX-01');
    expect(hookIds).toContain('SEND-TX-06-06');
    expect(hookIds).toContain('SEND-TX-99-01');
  }, 600000);

  it('should bridge USDT to different address from existing wallet (deployed UEA)', async () => {
    console.log('\n=== BRIDGE USDT TO OTHER — EXISTING WALLET ===');
    const { pushClient, progressEvents } = await createMainWalletClientWithHook();

    const usdt = pushClient.moveable.token.USDT;
    const amount = PushChain.utils.helpers.parseUnits('0.01', {
      decimals: usdt.decimals,
    });
    const differentAddress =
      '0x742d35Cc6634c0532925A3b844BC9e7595F5bE21' as `0x${string}`;

    console.log(`Recipient: ${differentAddress}`);
    console.log(`Amount: 0.01 USDT`);

    const tx = await pushClient.universal.sendTransaction({
      to: differentAddress,
      funds: { amount, token: usdt },
    });

    console.log(`TX Hash: ${tx.hash}`);
    expect(tx.hash).toBeDefined();
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log('Receipt:', JSON.stringify(receipt, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    expect(receipt.status).toBe(1);

    const hookIds = progressEvents.map((e) => e.event.id);
    expect(hookIds).toContain('SEND-TX-01');
    expect(hookIds).toContain('SEND-TX-06-06');
    expect(hookIds).toContain('SEND-TX-99-01');
  }, 600000);

  it('should bridge native ETH to self from existing wallet (deployed UEA)', async () => {
    console.log('\n=== BRIDGE NATIVE ETH TO SELF — EXISTING WALLET ===');
    const { pushClient, progressEvents } = await createMainWalletClientWithHook();

    const tokens = MOVEABLE_TOKENS[originChain] || [];
    const ethToken = tokens.find((t) => t.symbol === 'ETH');
    if (!ethToken) throw new Error('ETH token not found for Sepolia');

    const amount = PushChain.utils.helpers.parseUnits('0.0001', 18);

    console.log(`Recipient: ${pushClient.universal.account} (self/UEA)`);
    console.log(`Amount: 0.0001 ETH`);

    const tx = await pushClient.universal.sendTransaction({
      to: pushClient.universal.account,
      funds: { amount, token: ethToken },
    });

    console.log(`TX Hash: ${tx.hash}`);
    expect(tx.hash).toBeDefined();
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log('Receipt:', JSON.stringify(receipt, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    expect(receipt.status).toBe(1);

    const hookIds = progressEvents.map((e) => e.event.id);
    expect(hookIds).toContain('SEND-TX-01');
    expect(hookIds).toContain('SEND-TX-06-06');
    expect(hookIds).toContain('SEND-TX-99-01');
  }, 600000);

  it('should bridge native ETH to different address from existing wallet (deployed UEA)', async () => {
    console.log('\n=== BRIDGE NATIVE ETH TO OTHER — EXISTING WALLET ===');
    const { pushClient, progressEvents } = await createMainWalletClientWithHook();

    const tokens = MOVEABLE_TOKENS[originChain] || [];
    const ethToken = tokens.find((t) => t.symbol === 'ETH');
    if (!ethToken) throw new Error('ETH token not found for Sepolia');

    const amount = PushChain.utils.helpers.parseUnits('0.0001', 18);
    const differentAddress =
      '0x742d35Cc6634c0532925A3b844BC9e7595F5bE21' as `0x${string}`;

    console.log(`Recipient: ${differentAddress}`);
    console.log(`Amount: 0.0001 ETH`);

    const tx = await pushClient.universal.sendTransaction({
      to: differentAddress,
      funds: { amount, token: ethToken },
    });

    console.log(`TX Hash: ${tx.hash}`);
    expect(tx.hash).toBeDefined();
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log('Receipt:', JSON.stringify(receipt, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    expect(receipt.status).toBe(1);

    const hookIds = progressEvents.map((e) => e.event.id);
    expect(hookIds).toContain('SEND-TX-01');
    expect(hookIds).toContain('SEND-TX-06-06');
    expect(hookIds).toContain('SEND-TX-99-01');
  }, 600000);
});
