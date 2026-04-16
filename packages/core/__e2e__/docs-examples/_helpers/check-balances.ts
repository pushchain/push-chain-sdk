#!/usr/bin/env ts-node
/**
 * Dev script — prints master-wallet balances across every chain/asset the
 * docs-examples e2e suite consumes, and compares each against the aggregate
 * amount all 25 tests collectively need.
 *
 * Usage (from packages/core):
 *   npx ts-node --transpile-only __e2e__/docs-examples/_helpers/check-balances.ts
 *
 * Exits 0 when every asset is funded, 1 otherwise (so it can gate a CI pre-check).
 *
 * Required env vars (reads from packages/core/.env):
 *   EVM_PRIVATE_KEY      — Sepolia + BNB Testnet master (same hex, both EVM)
 *   PUSH_PRIVATE_KEY     — Push Chain master
 *   SOLANA_PRIVATE_KEY   — Solana Devnet master (base58)
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import {
  createPublicClient,
  http,
  formatEther,
  formatUnits,
  parseEther,
  parseUnits,
  getAddress,
  type Hex,
} from 'viem';
import { sepolia, bscTestnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { PushChain } from '../../../src';

// ---------------------------------------------------------------------------
// Required totals — aggregated from every `await fundX(...)` call across the
// 5 spec files. Update these if the per-spec amounts change.
// ---------------------------------------------------------------------------
// Per-test funding aggregated:
//   Sepolia ETH:   4×0.005 (06+07 routes) + 6×0.005 (route1) + 5×0.005 (route2 UOA) + 5×0.005 (route3 UOA) + 5×0.005 (08 UOA+CEA) = ~0.11
//   Sepolia USDC:  5 (route1 pay_gas_erc20 — ~3 USDC real gas + buffer)
//   Push PC:       2 (06) + 1 (route1) + 3 (route2 funds) + 4×5 (08 cascades) = 26
const NEEDS = {
  sepoliaEth: '0.11',
  sepoliaUsdt: '0.24',
  sepoliaUsdc: '5',
  bnb: '0.10',
  bnbUsdt: '0.04',
  pushPC: '26',
  pushPETH: '0.004',
  pushPUSDTBnb: '0.04',
  solanaSOL: '0.02',
};

const pETH_PUSH = getAddress('0x2971824Db68229D087931155C2b8bB820B275809');

const ERC20_BAL_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

async function retry<T>(fn: () => Promise<T>, attempts = 4, delayMs = 600): Promise<T> {
  let err: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw err;
}

function pad(s: string, w: number, align: 'l' | 'r' | 'c' = 'l'): string {
  const fill = w - s.length;
  if (fill <= 0) return s;
  if (align === 'r') return ' '.repeat(fill) + s;
  if (align === 'c') {
    const l = Math.floor(fill / 2);
    return ' '.repeat(l) + s + ' '.repeat(fill - l);
  }
  return s + ' '.repeat(fill);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var ${name} — set it in packages/core/.env`);
    process.exit(1);
  }
  return v;
}

(async () => {
  const evmKey = requireEnv('EVM_PRIVATE_KEY') as Hex;
  const pushKey = requireEnv('PUSH_PRIVATE_KEY') as Hex;
  const solKey = requireEnv('SOLANA_PRIVATE_KEY');

  const evmAcc = privateKeyToAccount(evmKey);
  const pushAcc = privateKeyToAccount(pushKey);
  const solKp = Keypair.fromSecretKey(bs58.decode(solKey));

  const usdtSepolia = getAddress(
    PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDT.address
  );
  const usdcSepolia = getAddress(
    PushChain.CONSTANTS.PAYABLE.TOKEN.ETHEREUM_SEPOLIA.USDC.address
  );
  const usdtBnb = getAddress(
    PushChain.CONSTANTS.MOVEABLE.TOKEN.BNB_TESTNET.USDT.address
  );
  const pUsdtBnbPush = getAddress(
    PushChain.utils.tokens.getPRC20Address(
      PushChain.CONSTANTS.MOVEABLE.TOKEN.BNB_TESTNET.USDT
    )
  );

  const sep = createPublicClient({ chain: sepolia, transport: http('https://1rpc.io/sepolia') });
  const bnb = createPublicClient({ chain: bscTestnet, transport: http('https://bsc-testnet-rpc.publicnode.com') });
  const push = createPublicClient({ transport: http('https://evm.donut.rpc.push.org/') });
  const solConn = new Connection('https://api.devnet.solana.com', 'confirmed');

  const read = <T>(p: Promise<T>) => retry(() => p);

  const [
    sepEth,
    sepUsdt,
    sepUsdc,
    bnbBal,
    bnbUsdt,
    pushPC,
    pushPETH,
    pushPUSDT,
    solBal,
  ] = await Promise.all([
    read(sep.getBalance({ address: evmAcc.address })),
    read(
      sep.readContract({
        address: usdtSepolia,
        abi: ERC20_BAL_ABI,
        functionName: 'balanceOf',
        args: [evmAcc.address],
      })
    ) as Promise<bigint>,
    read(
      sep.readContract({
        address: usdcSepolia,
        abi: ERC20_BAL_ABI,
        functionName: 'balanceOf',
        args: [evmAcc.address],
      })
    ) as Promise<bigint>,
    read(bnb.getBalance({ address: evmAcc.address })),
    read(
      bnb.readContract({
        address: usdtBnb,
        abi: ERC20_BAL_ABI,
        functionName: 'balanceOf',
        args: [evmAcc.address],
      })
    ) as Promise<bigint>,
    read(push.getBalance({ address: pushAcc.address })),
    read(
      push.readContract({
        address: pETH_PUSH,
        abi: ERC20_BAL_ABI,
        functionName: 'balanceOf',
        args: [pushAcc.address],
      })
    ) as Promise<bigint>,
    read(
      push.readContract({
        address: pUsdtBnbPush,
        abi: ERC20_BAL_ABI,
        functionName: 'balanceOf',
        args: [pushAcc.address],
      })
    ) as Promise<bigint>,
    retry(() => solConn.getBalance(solKp.publicKey), 5, 800),
  ]);

  const f18 = (v: bigint) => Number(formatEther(v)).toFixed(4);
  const f18p = (v: bigint) => Number(formatEther(v)).toFixed(6);
  const f6 = (v: bigint) => Number(formatUnits(v, 6)).toFixed(4);

  const rows = [
    { chain: 'Sepolia',       asset: 'ETH',        need: NEEDS.sepoliaEth,   have: f18(sepEth),   ok: sepEth   >= parseEther(NEEDS.sepoliaEth) },
    { chain: 'Sepolia',       asset: 'USDT',       need: NEEDS.sepoliaUsdt,  have: f6(sepUsdt),   ok: sepUsdt  >= parseUnits(NEEDS.sepoliaUsdt, 6) },
    { chain: 'Sepolia',       asset: 'USDC',       need: NEEDS.sepoliaUsdc,  have: f6(sepUsdc),   ok: sepUsdc  >= parseUnits(NEEDS.sepoliaUsdc, 6) },
    { chain: 'BNB Testnet',   asset: 'BNB',        need: NEEDS.bnb,          have: f18(bnbBal),   ok: bnbBal   >= parseEther(NEEDS.bnb) },
    { chain: 'BNB Testnet',   asset: 'USDT',       need: NEEDS.bnbUsdt,      have: f6(bnbUsdt),   ok: bnbUsdt  >= parseUnits(NEEDS.bnbUsdt, 6) },
    { chain: 'Push Chain',    asset: 'PC',         need: NEEDS.pushPC,       have: f18(pushPC),   ok: pushPC   >= parseEther(NEEDS.pushPC) },
    { chain: 'Push Chain',    asset: 'pETH',       need: NEEDS.pushPETH,     have: f18p(pushPETH), ok: pushPETH >= parseEther(NEEDS.pushPETH) },
    { chain: 'Push Chain',    asset: 'pUSDT(BNB)', need: NEEDS.pushPUSDTBnb, have: f6(pushPUSDT), ok: pushPUSDT >= parseUnits(NEEDS.pushPUSDTBnb, 6) },
    { chain: 'Solana Devnet', asset: 'SOL',        need: NEEDS.solanaSOL,    have: (solBal / LAMPORTS_PER_SOL).toFixed(4), ok: solBal >= Math.round(Number(NEEDS.solanaSOL) * LAMPORTS_PER_SOL) },
  ];

  const w = { chain: 5, asset: 5, need: 4, have: 4, status: 6 };
  for (const r of rows) {
    w.chain = Math.max(w.chain, r.chain.length);
    w.asset = Math.max(w.asset, r.asset.length);
    w.need = Math.max(w.need, r.need.length);
    w.have = Math.max(w.have, r.have.length);
  }
  const line = (l: string, m: string, r: string) =>
    l +
    '─'.repeat(w.chain + 2) + m +
    '─'.repeat(w.asset + 2) + m +
    '─'.repeat(w.need + 2) + m +
    '─'.repeat(w.have + 2) + m +
    '─'.repeat(w.status + 2) + r;

  console.log();
  console.log('Master wallets:');
  console.log('  EVM    (Sepolia + BNB)   ' + evmAcc.address);
  console.log('  Push   Chain             ' + pushAcc.address);
  console.log('  Solana Devnet            ' + solKp.publicKey.toBase58());
  console.log();
  console.log(line('┌', '┬', '┐'));
  console.log(
    '│ ' + pad('Chain', w.chain, 'c') +
    ' │ ' + pad('Asset', w.asset, 'c') +
    ' │ ' + pad('Need', w.need, 'c') +
    ' │ ' + pad('Have', w.have, 'c') +
    ' │ ' + pad('Status', w.status, 'c') + ' │'
  );
  console.log(line('├', '┼', '┤'));
  rows.forEach((r, i) => {
    console.log(
      '│ ' + pad(r.chain, w.chain) +
      ' │ ' + pad(r.asset, w.asset) +
      ' │ ' + pad(r.need, w.need, 'r') +
      ' │ ' + pad(r.have, w.have, 'r') +
      ' │ ' + pad(r.ok ? '✓' : '✗', w.status, 'c') + ' │'
    );
    if (i < rows.length - 1) console.log(line('├', '┼', '┤'));
  });
  console.log(line('└', '┴', '┘'));
  console.log();

  const missing = rows.filter((r) => !r.ok);
  if (missing.length === 0) {
    console.log('All 25 docs-examples tests have their required master funding. Ready to run.');
    process.exit(0);
  }
  console.log(`${missing.length}/${rows.length} assets short — top up before running:`);
  for (const r of missing) {
    console.log(`  • ${r.chain} ${r.asset}: need ${r.need}, have ${r.have}`);
  }
  process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
