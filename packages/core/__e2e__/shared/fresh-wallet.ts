import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  encodeFunctionData,
  WalletClient,
  PublicClient,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { PushChain } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';
import { SEPOLIA_RPC } from './constants';

export interface FreshWalletResult {
  pushClient: PushChain;
  progressEvents: { event: any; timestamp: number }[];
  startTime: number;
}

/**
 * Creates a fresh funded wallet (ETH + USDT) and returns an initialized PushChain client.
 * Extracted from pctx-last-transaction.spec.ts, send-to-self.spec.ts, value-funds-data-to-others.spec.ts.
 */
export async function createFreshFundedClient(
  mainWalletClient: WalletClient,
  publicClient: PublicClient,
  mainPushClient: PushChain,
  opts?: {
    originChain?: CHAIN;
    rpcUrl?: string;
    ethAmount?: string;
    usdtAmount?: string;
    printTraces?: boolean;
  }
): Promise<FreshWalletResult> {
  const rpcUrl = opts?.rpcUrl ?? SEPOLIA_RPC;

  const newPrivateKey = generatePrivateKey();
  const newAccount = privateKeyToAccount(newPrivateKey);
  console.log(`Fresh wallet: ${newAccount.address}`);

  // Fund with ETH for gas
  const ethTxHash = await mainWalletClient.sendTransaction({
    to: newAccount.address,
    value: parseEther(opts?.ethAmount ?? '0.01'),
    account: mainWalletClient.account!,
    chain: sepolia,
  });
  await publicClient.waitForTransactionReceipt({ hash: ethTxHash });
  console.log(`ETH funded: ${ethTxHash}`);

  // Fund with USDT
  const usdt = mainPushClient.moveable.token.USDT;
  const usdtAmount = PushChain.utils.helpers.parseUnits(
    opts?.usdtAmount ?? '0.05',
    { decimals: usdt.decimals }
  );
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
    account: mainWalletClient.account!,
    chain: sepolia,
  });
  await publicClient.waitForTransactionReceipt({ hash: usdtTxHash });
  console.log(`USDT funded: ${usdtTxHash}`);

  // Create PushChain client with fresh wallet
  const originChain = opts?.originChain ?? CHAIN.ETHEREUM_SEPOLIA;
  const newWalletClient = createWalletClient({
    account: newAccount,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  const progressEvents: { event: any; timestamp: number }[] = [];
  const startTime = Date.now();

  const newSigner =
    await PushChain.utils.signer.toUniversal(newWalletClient);
  const pushClient = await PushChain.initialize(newSigner, {
    network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
    rpcUrls: { [originChain]: [rpcUrl] },
    printTraces: opts?.printTraces,
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
 * Creates a PushChain client from the main wallet (already deployed UEA)
 * with progress hook tracking for assertions.
 */
export async function createMainWalletClientWithHook(
  mainWalletClient: WalletClient,
  opts?: {
    originChain?: CHAIN;
    rpcUrl?: string;
    printTraces?: boolean;
  }
): Promise<FreshWalletResult> {
  const rpcUrl = opts?.rpcUrl ?? SEPOLIA_RPC;
  const originChain = opts?.originChain ?? CHAIN.ETHEREUM_SEPOLIA;

  const progressEvents: { event: any; timestamp: number }[] = [];
  const startTime = Date.now();

  if (!mainWalletClient.account) {
    throw new Error('WalletClient must have an account set');
  }
  const mainSigner =
    await PushChain.utils.signer.toUniversal(
      mainWalletClient as unknown as Parameters<typeof PushChain.utils.signer.toUniversal>[0]
    );
  const pushClient = await PushChain.initialize(mainSigner, {
    network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
    rpcUrls: { [originChain]: [rpcUrl] },
    printTraces: opts?.printTraces,
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
