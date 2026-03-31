import {
  createWalletClient,
  http,
  parseEther,
  encodeFunctionData,
  WalletClient,
  PublicClient,
} from 'viem';
import type { Chain } from 'viem';
import type { ProgressEvent } from '../../src/lib/progress-hook/progress-hook.types';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { SEPOLIA_RPC } from './constants';

export interface FreshWalletResult {
  pushClient: PushChain;
  progressEvents: { event: ProgressEvent; timestamp: number }[];
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
    viemChain?: Chain;
    rpcUrl?: string;
    ethAmount?: string;
    usdtAmount?: string;
    printTraces?: boolean;
  }
): Promise<FreshWalletResult> {
  const originChain = opts?.originChain ?? CHAIN.ETHEREUM_SEPOLIA;
  const viemChain = opts?.viemChain ?? sepolia;
  const rpcUrl = opts?.rpcUrl ?? CHAIN_INFO[originChain]?.defaultRPC[0] ?? SEPOLIA_RPC;

  const newPrivateKey = generatePrivateKey();
  const newAccount = privateKeyToAccount(newPrivateKey);
  console.log(`Fresh wallet: ${newAccount.address}`);

  // Fund with ETH/native for gas
  const ethTxHash = await mainWalletClient.sendTransaction({
    to: newAccount.address,
    value: parseEther(opts?.ethAmount ?? '0.001'),
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    account: mainWalletClient.account!,
    chain: viemChain,
  });
  await publicClient.waitForTransactionReceipt({ hash: ethTxHash });
  console.log(`Native funded: ${ethTxHash}`);

  // Fund with USDT
  const usdt = mainPushClient.moveable.token.USDT;
  const usdtAmount = PushChain.utils.helpers.parseUnits(
    opts?.usdtAmount ?? '0.005',
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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    account: mainWalletClient.account!,
    chain: viemChain,
  });
  await publicClient.waitForTransactionReceipt({ hash: usdtTxHash });
  console.log(`USDT funded: ${usdtTxHash}`);

  // Create PushChain client with fresh wallet
  const newWalletClient = createWalletClient({
    account: newAccount,
    chain: viemChain,
    transport: http(rpcUrl),
  });

  const progressEvents: { event: ProgressEvent; timestamp: number }[] = [];
  const startTime = Date.now();

  const universalSigner =
    await PushChain.utils.signer.toUniversalFromKeypair(newWalletClient, {
      chain: originChain,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
  const pushClient = await PushChain.initialize(universalSigner, {
    network: PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls: { [originChain]: [rpcUrl] },
    printTraces: opts?.printTraces,
    progressHook: (val: ProgressEvent) => {
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
    viemChain?: Chain;
    rpcUrl?: string;
    printTraces?: boolean;
  }
): Promise<FreshWalletResult> {
  const originChain = opts?.originChain ?? CHAIN.ETHEREUM_SEPOLIA;
  const rpcUrl = opts?.rpcUrl ?? CHAIN_INFO[originChain]?.defaultRPC[0] ?? SEPOLIA_RPC;

  const progressEvents: { event: ProgressEvent; timestamp: number }[] = [];
  const startTime = Date.now();

  if (!mainWalletClient.account) {
    throw new Error('WalletClient must have an account set');
  }

  const universalSigner =
    await PushChain.utils.signer.toUniversalFromKeypair(mainWalletClient, {
      chain: originChain,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
  const pushClient = await PushChain.initialize(universalSigner, {
    network: PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls: { [originChain]: [rpcUrl] },
    printTraces: opts?.printTraces,
    progressHook: (val: ProgressEvent) => {
      const now = Date.now();
      progressEvents.push({ event: val, timestamp: now });
      const elapsed = ((now - startTime) / 1000).toFixed(2);
      console.log(`[${elapsed}s] ${val.id}: ${val.title}`);
    },
  });

  console.log(`Main wallet UEA: ${pushClient.universal.account}`);
  return { pushClient, progressEvents, startTime };
}
