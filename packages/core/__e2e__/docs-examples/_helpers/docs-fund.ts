/**
 * docs-fund — Funding helpers for the docs-examples e2e suite.
 *
 * Each docs example shows a `:::prompt:::` line that lists the exact assets and amounts
 * the user must send to a fresh wallet before the example runs. In e2e we replace the
 * prompt with an automatic transfer from a master wallet (loaded from `.env`) using the
 * same amounts. This file centralises those funding flows so each spec stays a faithful
 * 1:1 mirror of its docs example.
 *
 * One helper per "fund profile" found in the docs:
 *   • fundSepoliaUoa      — Sepolia UOA only (Route 1 examples)
 *   • fundSepoliaUoaUsdt  — Sepolia UOA + USDT (Route 1 funds-bridge examples)
 *   • fundUeaPC           — pre-fund the UEA on Push Chain with native PC
 *   • fundUeaPETH         — pre-fund the UEA on Push Chain with pETH (Route 2 native funds)
 *   • fundBnbCea          — pre-fund the CEA on BNB Testnet (Route 3)
 *   • fundPushChainUoa    — Push Chain UOA (06 ethers/viem basic, 07 push-direct)
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  parseUnits,
  encodeFunctionData,
  defineChain,
  type Hex,
  type WalletClient,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia, bscTestnet } from 'viem/chains';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { CHAIN } from '../../../src/lib/constants/enums';

const SEPOLIA_RPC = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];
const PUSH_RPC = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0];
const BNB_RPC = CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0];

export const PUSH_CHAIN_DEF = defineChain({
  id: Number(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId),
  name: 'Push Testnet',
  nativeCurrency: { name: 'PC', symbol: 'PC', decimals: 18 },
  rpcUrls: { default: { http: [PUSH_RPC] } },
});

const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// ---------------------------------------------------------------------------
// Sepolia
// ---------------------------------------------------------------------------

export interface SepoliaContext {
  master: ReturnType<typeof privateKeyToAccount>;
  walletClient: WalletClient;
  publicClient: PublicClient;
}

export function makeSepoliaContext(masterKey: Hex): SepoliaContext {
  const master = privateKeyToAccount(masterKey);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });
  const walletClient = createWalletClient({ account: master, chain: sepolia, transport: http(SEPOLIA_RPC) });
  return { master, walletClient, publicClient };
}

/** Fund a fresh Sepolia address with `ethAmount` ETH from the master. */
export async function fundSepoliaUoa(
  ctx: SepoliaContext,
  to: `0x${string}`,
  ethAmount: string
): Promise<void> {
  const need = parseEther(ethAmount);
  const have = await ctx.publicClient.getBalance({ address: ctx.master.address });
  if (have < need) {
    throw new Error(
      `[fund] master Sepolia wallet (${ctx.master.address}) has ${have.toString()} wei, needs ${need.toString()} wei (${ethAmount} ETH) — top up and re-run.`
    );
  }
  const hash = await ctx.walletClient.sendTransaction({
    account: ctx.master,
    chain: sepolia,
    to,
    value: need,
  });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`[fund] ${ethAmount} ETH transfer to ${to} reverted (tx: ${hash})`);
  }
  console.log(`[fund] ${ethAmount} ETH → ${to} on Sepolia (${hash})`);
}

/**
 * Fund a fresh Sepolia address with `ethAmount` ETH AND `usdtAmount` USDT from the master.
 * Used by every Route 1 funds-bridge example. Throws if the master is short on either.
 */
export async function fundSepoliaUoaUsdt(
  ctx: SepoliaContext,
  to: `0x${string}`,
  ethAmount: string,
  usdtAmount: string,
  usdt: { address: string; decimals: number }
): Promise<void> {
  await fundSepoliaUoa(ctx, to, ethAmount);

  const needUsdt = parseUnits(usdtAmount, usdt.decimals);
  const haveUsdt = (await ctx.publicClient.readContract({
    address: usdt.address as `0x${string}`,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [ctx.master.address],
  })) as bigint;
  if (haveUsdt < needUsdt) {
    throw new Error(
      `[fund] master Sepolia wallet (${ctx.master.address}) has ${haveUsdt.toString()} units of USDT, needs ${needUsdt.toString()} (${usdtAmount} USDT) — ` +
      `mint USDT at ${usdt.address} on Sepolia and re-run.`
    );
  }
  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [to, needUsdt],
  });
  const hash = await ctx.walletClient.sendTransaction({
    account: ctx.master,
    chain: sepolia,
    to: usdt.address as `0x${string}`,
    data,
  });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`[fund] ${usdtAmount} USDT transfer to ${to} reverted (tx: ${hash})`);
  }
  console.log(`[fund] ${usdtAmount} USDT → ${to} on Sepolia (${hash})`);
}

// ---------------------------------------------------------------------------
// Push Chain
// ---------------------------------------------------------------------------

export interface PushContext {
  master: ReturnType<typeof privateKeyToAccount>;
  walletClient: WalletClient;
  publicClient: PublicClient;
}

export function makePushContext(masterKey: Hex): PushContext {
  const master = privateKeyToAccount(masterKey);
  const publicClient = createPublicClient({ chain: PUSH_CHAIN_DEF, transport: http(PUSH_RPC) });
  const walletClient = createWalletClient({ account: master, chain: PUSH_CHAIN_DEF, transport: http(PUSH_RPC) });
  return { master, walletClient, publicClient };
}

/** Send native PC to an address on Push Chain (typically the fresh UEA, pre-deploy). */
export async function fundUeaPC(
  ctx: PushContext,
  uea: `0x${string}`,
  pcAmount: string
): Promise<void> {
  const need = parseEther(pcAmount);
  const have = await ctx.publicClient.getBalance({ address: ctx.master.address });
  if (have < need) {
    throw new Error(
      `[fund] master Push wallet (${ctx.master.address}) has ${have.toString()} wei, needs ${need.toString()} wei (${pcAmount} PC) — top up and re-run.`
    );
  }
  const hash = await ctx.walletClient.sendTransaction({
    account: ctx.master,
    chain: PUSH_CHAIN_DEF,
    to: uea,
    value: need,
  });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`[fund] ${pcAmount} PC transfer to ${uea} reverted (tx: ${hash})`);
  }
  console.log(`[fund] ${pcAmount} PC → ${uea} on Push Chain (${hash})`);
}

/**
 * Transfer a PRC-20 (e.g. pETH, pUSDT(BNB)) from the master to the fresh UEA.
 * Throws if the master's balance is below the required amount — the test should fail
 * hard with a clear "top up the master" message rather than silently skipping.
 */
export async function fundUeaPRC20(
  ctx: PushContext,
  uea: `0x${string}`,
  prc20: `0x${string}`,
  amount: string,
  decimals: number,
  label: string
): Promise<void> {
  const need = parseUnits(amount, decimals);
  const have = (await ctx.publicClient.readContract({
    address: prc20,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [ctx.master.address],
  })) as bigint;
  if (have < need) {
    throw new Error(
      `[fund] master Push wallet (${ctx.master.address}) has ${have.toString()} units of ${label}, needs ${need.toString()} — ` +
      `top up the master with at least ${amount} ${label} at PRC-20 ${prc20} on Push Chain and re-run.`
    );
  }
  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [uea, need],
  });
  const hash = await ctx.walletClient.sendTransaction({
    account: ctx.master,
    chain: PUSH_CHAIN_DEF,
    to: prc20,
    data,
  });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`[fund] ${amount} ${label} transfer to ${uea} reverted (tx: ${hash})`);
  }
  console.log(`[fund] ${amount} ${label} → ${uea} on Push Chain (${hash})`);
}

// ---------------------------------------------------------------------------
// BNB Testnet (Route 3 CEA funding)
// ---------------------------------------------------------------------------

export interface BnbContext {
  master: ReturnType<typeof privateKeyToAccount>;
  walletClient: WalletClient;
  publicClient: PublicClient;
}

export function makeBnbContext(masterKey: Hex): BnbContext {
  const master = privateKeyToAccount(masterKey);
  const publicClient = createPublicClient({ chain: bscTestnet, transport: http(BNB_RPC) });
  const walletClient = createWalletClient({ account: master, chain: bscTestnet, transport: http(BNB_RPC) });
  return { master, walletClient, publicClient };
}

/** Send native BNB to a CEA on BNB Testnet (covers $10 fee-lock + gas). */
export async function fundBnbCea(
  ctx: BnbContext,
  cea: `0x${string}`,
  bnbAmount: string
): Promise<void> {
  const need = parseEther(bnbAmount);
  const have = await ctx.publicClient.getBalance({ address: ctx.master.address });
  if (have < need) {
    throw new Error(
      `[fund] master BNB Testnet wallet (${ctx.master.address}) has ${have.toString()} wei, needs ${need.toString()} wei (${bnbAmount} BNB) — top up and re-run.`
    );
  }
  const hash = await ctx.walletClient.sendTransaction({
    account: ctx.master,
    chain: bscTestnet,
    to: cea,
    value: need,
  });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`[fund] ${bnbAmount} BNB transfer to ${cea} reverted (tx: ${hash})`);
  }
  console.log(`[fund] ${bnbAmount} BNB → ${cea} on BNB Testnet (${hash})`);
}

/** Fund a BNB CEA with both native BNB and ERC-20 USDT (Route 3 funds variants). */
export async function fundBnbCeaUsdt(
  ctx: BnbContext,
  cea: `0x${string}`,
  bnbAmount: string,
  usdtAmount: string,
  usdt: { address: string; decimals: number }
): Promise<void> {
  await fundBnbCea(ctx, cea, bnbAmount);

  const needUsdt = parseUnits(usdtAmount, usdt.decimals);
  const haveUsdt = (await ctx.publicClient.readContract({
    address: usdt.address as `0x${string}`,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [ctx.master.address],
  })) as bigint;
  if (haveUsdt < needUsdt) {
    throw new Error(
      `[fund] master BNB Testnet wallet (${ctx.master.address}) has ${haveUsdt.toString()} units of USDT, needs ${needUsdt.toString()} (${usdtAmount} USDT) — ` +
      `top up USDT at ${usdt.address} on BNB Testnet and re-run.`
    );
  }
  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [cea, needUsdt],
  });
  const hash = await ctx.walletClient.sendTransaction({
    account: ctx.master,
    chain: bscTestnet,
    to: usdt.address as `0x${string}`,
    data,
  });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`[fund] ${usdtAmount} USDT transfer to ${cea} reverted (tx: ${hash})`);
  }
  console.log(`[fund] ${usdtAmount} USDT → ${cea} on BNB Testnet (${hash})`);
}

/**
 * Derive a CEA address on BNB Testnet for a given Push Chain UEA via the
 * CEAFactory contract. Returns the on-chain CEA address (zero-address if not deployed yet).
 */
export async function deriveBnbCea(
  ctx: BnbContext,
  pushAddress: `0x${string}`
): Promise<`0x${string}`> {
  const CEA_FACTORY = '0xe2182dae2dc11cBF6AA6c8B1a7f9c8315A6B0719' as `0x${string}`;
  const result = (await ctx.publicClient.readContract({
    address: CEA_FACTORY,
    abi: [
      {
        name: 'getCEAForPushAccount',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'a', type: 'address' }],
        outputs: [
          { name: 'cea', type: 'address' },
          { name: 'deployed', type: 'bool' },
        ],
      },
    ] as const,
    functionName: 'getCEAForPushAccount',
    args: [pushAddress],
  })) as readonly [`0x${string}`, boolean];
  return result[0];
}

// ---------------------------------------------------------------------------
// Solana Devnet (UOA on SVM)
// ---------------------------------------------------------------------------

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

export interface SolanaContext {
  master: Keypair;
  connection: Connection;
}

const SOLANA_DEVNET_RPC = 'https://api.devnet.solana.com';

/** Build a Solana devnet master context from a base58-encoded private key. */
export function makeSolanaContext(masterKeyBase58: string): SolanaContext {
  const secret = bs58.decode(masterKeyBase58);
  const master = Keypair.fromSecretKey(secret);
  const connection = new Connection(SOLANA_DEVNET_RPC, 'confirmed');
  return { master, connection };
}

/** Transfer SOL from the master keypair to a fresh devnet address. */
export async function fundSolanaUoa(
  ctx: SolanaContext,
  toBase58: string,
  solAmount: string
): Promise<void> {
  const lamports = Math.round(Number(solAmount) * LAMPORTS_PER_SOL);
  const have = await ctx.connection.getBalance(ctx.master.publicKey);
  if (have < lamports) {
    throw new Error(
      `[fund] master Solana Devnet wallet (${ctx.master.publicKey.toBase58()}) has ${have} lamports, needs ${lamports} (${solAmount} SOL) — ` +
      `airdrop from https://faucet.solana.com and re-run.`
    );
  }
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: ctx.master.publicKey,
      toPubkey: new PublicKey(toBase58),
      lamports,
    })
  );
  const sig = await sendAndConfirmTransaction(ctx.connection, tx, [ctx.master]);
  console.log(`[fund] ${solAmount} SOL → ${toBase58} on Solana Devnet (${sig})`);
}
