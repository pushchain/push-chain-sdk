import '@e2e/shared/setup';
/**
 * Route 2 Docs Examples — E2E (simulates fresh wallet + prompt funding)
 *
 * Each test mirrors a docs example exactly:
 *   1. Creates a random wallet (like the playground)
 *   2. Main wallet pre-funds: Sepolia ETH + UEA tokens + UEA native PC
 *      (simulates what the prompt tells the user to do)
 *   3. Runs the exact same sendTransaction call from the docs
 *   4. Asserts success
 */
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO, SYNTHETIC_PUSH_ERC20 } from '../../src/lib/constants/chain';
import { ERC20_EVM } from '../../src/lib/constants/abi/erc20.evm';
import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  parseUnits,
  formatEther,
  formatUnits,
  encodeFunctionData,
  defineChain,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { createProgressTracker } from '@e2e/shared/progress-tracker';
import { COUNTER_ABI } from '@e2e/shared/outbound-helpers';

// ── Addresses ──
const TARGET = '0x1234567890123456789012345678901234567890' as `0x${string}`;
const COUNTER_BNB = '0x7f0936bb90e7dcf3edb47199c2005e7184e44cf8' as `0x${string}`;
const SEPOLIA_RPC = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];
const PUSH_RPC = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0];
const PUSH_CHAIN_DEF = defineChain({
  id: Number(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId),
  name: 'Push Testnet',
  nativeCurrency: { name: 'PC', symbol: 'PC', decimals: 18 },
  rpcUrls: { default: { http: [PUSH_RPC] } },
});

const synthetics = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT];
const PETH_ADDRESS = synthetics.pETH as `0x${string}`;
const PUSDT_BNB_ADDRESS = synthetics.USDT_BNB as `0x${string}`;

const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
const skipE2E = !privateKey;

// ── Helpers ──
async function queryBalance(
  client: ReturnType<typeof createPublicClient>,
  token: `0x${string}`,
  owner: `0x${string}`
): Promise<bigint> {
  return (await client.readContract({
    address: token, abi: ERC20_EVM, functionName: 'balanceOf', args: [owner],
  })) as bigint;
}

async function transferPrc20OnPushChain(
  pushClient: PushChain,
  token: `0x${string}`,
  to: `0x${string}`,
  amount: bigint,
  label: string
): Promise<void> {
  const data = encodeFunctionData({
    abi: ERC20_EVM, functionName: 'transfer', args: [to, amount],
  });
  const tx = await pushClient.universal.sendTransaction({ to: token, data });
  const r = await tx.wait();
  console.log(`  [${label}] transfer: ${tx.hash} status=${r.status}`);
}

describe('Route 2: Docs Examples (Fresh Wallet)', () => {
  // Shared clients
  let mainPushClient: PushChain;
  let mainAccount: ReturnType<typeof privateKeyToAccount>;
  let mainUeaAddress: `0x${string}`;
  let sepoliaPublicClient: ReturnType<typeof createPublicClient>;
  let pushPublicClient: ReturnType<typeof createPublicClient>;
  let pushEoaWallet: ReturnType<typeof createWalletClient>;

  // Per-test fresh wallet helper
  async function createFundedFreshWallet(opts: {
    pEth?: bigint;
    pUsdtBnb?: bigint;
    nativePC?: bigint;
  }): Promise<PushChain> {
    const freshKey = generatePrivateKey();
    const freshAccount = privateKeyToAccount(freshKey);
    console.log(`\n  Fresh wallet: ${freshAccount.address}`);

    // 1. Fund Sepolia ETH
    const mainWalletClient = createWalletClient({
      account: mainAccount, chain: sepolia, transport: http(SEPOLIA_RPC),
    });
    const fundHash = await mainWalletClient.sendTransaction({
      to: freshAccount.address, value: parseEther('0.005'),
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

    // 3. Pre-fund UEA on Push Chain (simulates what the prompt asks the user to do)
    if (opts.nativePC) {
      const h = await (pushEoaWallet as any).sendTransaction({
        to: freshUea as `0x${string}`, value: opts.nativePC,
      });
      await pushPublicClient.waitForTransactionReceipt({ hash: h });
      console.log(`  Funded ${formatEther(opts.nativePC)} PC`);
    }
    if (opts.pEth) {
      await transferPrc20OnPushChain(mainPushClient, PETH_ADDRESS, freshUea as `0x${string}`, opts.pEth, 'pETH');
    }
    if (opts.pUsdtBnb) {
      await transferPrc20OnPushChain(mainPushClient, PUSDT_BNB_ADDRESS, freshUea as `0x${string}`, opts.pUsdtBnb, 'pUSDT_BNB');
    }

    return freshPushClient;
  }

  beforeAll(async () => {
    if (skipE2E) return;

    mainAccount = privateKeyToAccount(privateKey);
    const mainSetup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA, privateKey, printTraces: true,
    });
    mainPushClient = mainSetup.pushClient;
    mainUeaAddress = mainPushClient.universal.account;

    sepoliaPublicClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });
    pushPublicClient = createPublicClient({ transport: http(PUSH_RPC) });
    pushEoaWallet = createWalletClient({
      account: mainAccount, chain: PUSH_CHAIN_DEF, transport: http(PUSH_RPC),
    });

    // Ensure main UEA has enough pETH (bridge if needed)
    const mainPeth = await queryBalance(pushPublicClient, PETH_ADDRESS, mainUeaAddress);
    console.log(`Main UEA pETH: ${formatEther(mainPeth)}`);
    if (mainPeth < parseEther('0.002')) {
      console.log('Bridging ETH as pETH to main UEA...');
      const bridgeTx = await mainPushClient.universal.sendTransaction({
        to: mainUeaAddress,
        funds: { amount: parseEther('0.005'), token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH },
      });
      await bridgeTx.wait();
      console.log(`Bridged pETH: ${bridgeTx.hash}`);
    }

    // Move pUSDT_BNB from EOA to UEA if needed
    const ueaPusdt = await queryBalance(pushPublicClient, PUSDT_BNB_ADDRESS, mainUeaAddress);
    if (ueaPusdt < parseUnits('0.04', 6)) {
      const eoaPusdt = await queryBalance(pushPublicClient, PUSDT_BNB_ADDRESS, mainAccount.address);
      if (eoaPusdt > BigInt(0)) {
        console.log('Moving pUSDT_BNB from EOA to UEA...');
        const data = encodeFunctionData({
          abi: ERC20_EVM, functionName: 'transfer',
          args: [mainUeaAddress, eoaPusdt],
        });
        const h = await (pushEoaWallet as any).sendTransaction({ to: PUSDT_BNB_ADDRESS, data });
        await pushPublicClient.waitForTransactionReceipt({ hash: h });
      }
    }

    // Log final balances
    const [pc, peth, pusdt] = await Promise.all([
      pushPublicClient.getBalance({ address: mainUeaAddress }),
      queryBalance(pushPublicClient, PETH_ADDRESS, mainUeaAddress),
      queryBalance(pushPublicClient, PUSDT_BNB_ADDRESS, mainUeaAddress),
    ]);
    console.log(`\nMain UEA ready: ${formatEther(pc)} PC | ${formatEther(peth)} pETH | ${formatUnits(pusdt, 6)} pUSDT_BNB`);
  }, 300000);

  // =========================================================================
  // #2  Funds Transfer (Native Value to External Chain)
  //     Docs: burn pETH → send ETH to TARGET on Sepolia
  // =========================================================================
  it('#2 Native Value: burn pETH → ETH to Sepolia', async () => {
    if (skipE2E) return;
    console.log('\n=== #2 Native Value Transfer ===');

    const client = await createFundedFreshWallet({
      pEth: parseEther('0.001'),
      nativePC: parseEther('5'),
    });

    // Exact same call as the docs example
    const tx = await client.universal.sendTransaction({
      to: { address: TARGET, chain: CHAIN.ETHEREUM_SEPOLIA },
      value: PushChain.utils.helpers.parseUnits('0.0005', 18),
    });
    console.log(`TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Status: ${receipt.status} | External TX: ${receipt.externalTxHash} | Chain: ${receipt.externalChain}`);

    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeDefined();
    expect(receipt.externalChain).toBe(CHAIN.ETHEREUM_SEPOLIA);
  }, 360000);

  // =========================================================================
  // #3  Funds Transfer (Assets to External Chain)
  //     Docs: burn pUSDT_BNB → send USDT to TARGET on BNB Testnet
  // =========================================================================
  it('#3 Assets: burn pUSDT_BNB → USDT to BNB Testnet', async () => {
    if (skipE2E) return;
    console.log('\n=== #3 Assets Transfer ===');

    const client = await createFundedFreshWallet({
      pUsdtBnb: parseUnits('0.01', 6),
      nativePC: parseEther('5'),
    });

    const usdt = PushChain.CONSTANTS.MOVEABLE.TOKEN.BNB_TESTNET.USDT;
    const tx = await client.universal.sendTransaction({
      to: { address: TARGET, chain: CHAIN.BNB_TESTNET },
      funds: {
        amount: PushChain.utils.helpers.parseUnits('0.01', { decimals: usdt.decimals }),
        token: usdt,
      },
    });
    console.log(`TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Status: ${receipt.status} | External TX: ${receipt.externalTxHash} | Chain: ${receipt.externalChain}`);

    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeDefined();
    expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
  }, 360000);

  // =========================================================================
  // #4  Funds with Payload (Assets + Contract Call on External Chain)
  //     Docs: burn pUSDT_BNB + call counter.increment() on BNB Testnet
  // =========================================================================
  it('#4 Funds+Payload: burn pUSDT_BNB + counter.increment() on BNB', async () => {
    if (skipE2E) return;
    console.log('\n=== #4 Funds + Payload ===');

    const client = await createFundedFreshWallet({
      pUsdtBnb: parseUnits('0.01', 6),
      nativePC: parseEther('5'),
    });

    const usdt = PushChain.CONSTANTS.MOVEABLE.TOKEN.BNB_TESTNET.USDT;
    const data = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI], functionName: 'increment',
    });

    const tx = await client.universal.sendTransaction({
      to: { address: COUNTER_BNB, chain: CHAIN.BNB_TESTNET },
      data,
      funds: {
        amount: PushChain.utils.helpers.parseUnits('0.01', { decimals: usdt.decimals }),
        token: usdt,
      },
    });
    console.log(`TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Status: ${receipt.status} | External TX: ${receipt.externalTxHash} | Chain: ${receipt.externalChain}`);

    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeDefined();
    expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);
  }, 360000);
});
