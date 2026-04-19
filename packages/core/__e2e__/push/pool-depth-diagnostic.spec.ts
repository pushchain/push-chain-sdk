import '@e2e/shared/setup';
/**
 * Diagnostic: pETH → WPC Uniswap V3 pool depth on Push Testnet Donut.
 *
 * Pure read-only RPC reads. No signed txs, no PC moved, no Sepolia gas spent.
 * Produces three tables that prove whether the pool — not the SDK cap — is
 * the bottleneck for large Sepolia → Push PC transfers:
 *
 *   1. Pool identity + state snapshot (block, sqrtPrice, tick, liquidity)
 *   2. Forward depth probe — given $X of pETH input, how much PC do we get?
 *   3. Inverse depth probe — to receive Y PC, how much pETH does the pool demand?
 *
 * Run: EVM_PRIVATE_KEY=0x... npx jest --config=jest.e2e.config.ts pool-depth-diagnostic
 * (EVM_PRIVATE_KEY is only used for the e2e bootstrap — no tx is signed.)
 */
import { createPublicClient, http } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { UNIVERSAL_GATEWAY_PC } from '../../src/lib/constants/abi';
import {
  getNativePRC20ForChain,
  getUniversalGatewayPCAddress,
} from '../../src/lib/orchestrator/internals/helpers';
import { PriceFetch } from '../../src/lib/price-fetch/price-fetch';

const PUSH_RPC = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0];
const QUOTER_ADDRESS = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].dex!.uniV3QuoterV2;

// SDK-side fixed accounting rate (constants/chain.ts:pushToUsdcNumerator/Denominator):
//   numerator: 1e7 (= $0.10 in 8-dec USDC), denominator: 1e18 (= 1 PC)
// → SDK assumes 1 PC = $0.10. Pool reality differs wildly.
const SDK_FIXED_USD_PER_PC = 0.10;
const SDK_CAP_USD = 1000;

const QUOTER_ABI = [
  {
    type: 'function' as const,
    name: 'quoteExactInputSingle',
    inputs: [
      {
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'view' as const,
  },
  {
    type: 'function' as const,
    name: 'quoteExactOutputSingle',
    inputs: [
      {
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'view' as const,
  },
] as const;

const UNIVERSAL_CORE_SWAP_HELPERS_ABI = [
  { type: 'function' as const, name: 'WPC', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' as const },
  { type: 'function' as const, name: 'uniswapV3Factory', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' as const },
  { type: 'function' as const, name: 'defaultFeeTier', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint24' }], stateMutability: 'view' as const },
] as const;

const FACTORY_ABI = [
  {
    type: 'function' as const,
    name: 'getPool',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
    stateMutability: 'view' as const,
  },
] as const;

const POOL_ABI = [
  {
    type: 'function' as const,
    name: 'slot0',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view' as const,
  },
  {
    type: 'function' as const,
    name: 'liquidity',
    inputs: [],
    outputs: [{ name: '', type: 'uint128' }],
    stateMutability: 'view' as const,
  },
] as const;

const FORWARD_USD_PROBES = [1, 10, 50, 100, 250, 500, 1000, 2000, 5000];
const INVERSE_PC_PROBES = [1, 5, 10, 25, 50, 100, 250, 500];

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function formatPcFromWei(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(6);
}

function formatEthFromWei(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(6);
}

type PoolProbeArgs = {
  label: string;
  prc20Address: `0x${string}`;
  prc20Symbol: string;
  prc20Decimals: number;       // pETH=18, pSOL=9
  nativeAssetSymbol: string;   // 'ETH', 'SOL'
  nativeAssetPriceUsd: number; // for converting pETH/pSOL wei → USD
  nativeAssetPrice8dec: bigint;
};

const skipE2E = !process.env['EVM_PRIVATE_KEY'];
const pushPublic = createPublicClient({ transport: http(PUSH_RPC) });

type PoolSummary = {
  label: string;
  prc20Symbol: string;
  poolAddress: `0x${string}`;
  spotUsdPerPc: number | null;
  pcAtCap: number;
  safePcAtCap: number;
  firstRevertAtPc: number | null;
};

async function probePool(args: PoolProbeArgs, wpcAddress: `0x${string}`, factoryAddress: `0x${string}`, feeTier: number, summary: PoolSummary[]) {
  // Resolve concrete pool address
  const poolAddress = await pushPublic.readContract({
    address: factoryAddress,
    abi: FACTORY_ABI,
    functionName: 'getPool',
    args: [wpcAddress, args.prc20Address, feeTier],
  }) as `0x${string}`;

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log(` POOL IDENTITY — ${args.label}`);
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  ${args.prc20Symbol} (PRC-20):  ${args.prc20Address}`);
  console.log(`  WPC:              ${wpcAddress}`);
  console.log(`  Default fee tier: ${feeTier} (${(feeTier / 10000).toFixed(2)}%)`);
  console.log(`  Pool address:     ${poolAddress}`);
  if (poolAddress === '0x0000000000000000000000000000000000000000') {
    console.log('  ⚠️  Pool not deployed — skipping depth probes');
    summary.push({
      label: args.label, prc20Symbol: args.prc20Symbol, poolAddress,
      spotUsdPerPc: null, pcAtCap: 0, safePcAtCap: 0, firstRevertAtPc: null,
    });
    return;
  }

  // Pool state
  const blockNumber = await pushPublic.getBlockNumber();
  const block = await pushPublic.getBlock({ blockNumber });
  const slot0 = await pushPublic.readContract({
    address: poolAddress, abi: POOL_ABI, functionName: 'slot0',
  }) as readonly [bigint, number, number, number, number, number, boolean];
  const liquidity = await pushPublic.readContract({
    address: poolAddress, abi: POOL_ABI, functionName: 'liquidity',
  }) as bigint;

  console.log(`\n  POOL STATE`);
  console.log(`  Block:            ${blockNumber}  (${new Date(Number(block.timestamp) * 1000).toISOString()})`);
  console.log(`  sqrtPriceX96:     ${slot0[0].toString()}`);
  console.log(`  tick:             ${slot0[1]}`);
  console.log(`  active liquidity: ${liquidity.toString()}`);
  console.log(`  ${args.nativeAssetSymbol} price (oracle): $${args.nativeAssetPriceUsd.toFixed(2)}`);

  if (slot0[0] === BigInt(0)) {
    console.log('  ⚠️  Pool not initialized (sqrtPriceX96 == 0) — skipping depth probes');
    return;
  }

  // Forward depth probe
  console.log(`\n  FORWARD DEPTH (USD ${args.prc20Symbol} input → PC output)`);
  console.log(`  ${pad('USD', 10)}${pad(`${args.prc20Symbol} (wei)`, 24)}${pad(args.prc20Symbol, 14)}${pad('PC out', 16)}${pad('$/PC', 14)}vs $1`);
  console.log('  ' + '─'.repeat(95));

  let oneNativeUnit = BigInt(1);
  for (let i = 0; i < args.prc20Decimals; i++) oneNativeUnit *= BigInt(10);
  let baselineUsdPerPc: number | null = null;
  for (const usd of FORWARD_USD_PROBES) {
    const usd8 = BigInt(Math.round(usd * 1e8));
    const nativeWei = (usd8 * oneNativeUnit) / args.nativeAssetPrice8dec + BigInt(1);
    let pcOutStr = 'reverted';
    let usdPerPcStr = '—';
    let slipStr = 'quote-fail';
    try {
      const result = await pushPublic.readContract({
        address: QUOTER_ADDRESS as `0x${string}`,
        abi: QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [{
          tokenIn: args.prc20Address,
          tokenOut: wpcAddress,
          amountIn: nativeWei,
          fee: feeTier,
          sqrtPriceLimitX96: BigInt(0),
        }],
      }) as readonly [bigint, bigint, number, bigint];
      const pcOutF = Number(result[0]) / 1e18;
      pcOutStr = pcOutF.toFixed(6);
      if (pcOutF > 0) {
        const usdPerPc = usd / pcOutF;
        usdPerPcStr = `$${usdPerPc.toFixed(2)}`;
        if (baselineUsdPerPc === null) baselineUsdPerPc = usdPerPc;
        const ratio = usdPerPc / baselineUsdPerPc;
        const slipPct = (ratio - 1) * 100;
        slipStr = `${ratio.toFixed(2)}×  (${slipPct >= 0 ? '+' : ''}${slipPct.toFixed(0)}% slip)`;
      }
    } catch {
      // quote reverted
    }
    const nativeFmt = (Number(nativeWei) / Number(oneNativeUnit)).toFixed(6);
    console.log(
      `  ${pad('$' + usd, 10)}${pad(nativeWei.toString(), 24)}${pad(nativeFmt, 14)}${pad(pcOutStr, 16)}${pad(usdPerPcStr, 14)}${slipStr}`
    );
  }

  // Inverse depth probe
  console.log(`\n  INVERSE DEPTH (target PC output → ${args.prc20Symbol} input)`);
  console.log(`  ${pad('PC out', 12)}${pad(`${args.prc20Symbol} in (wei)`, 24)}${pad(args.prc20Symbol, 14)}${pad('USD', 14)}$/PC`);
  console.log('  ' + '─'.repeat(85));

  let firstRevertAtPc: number | null = null;
  for (const pc of INVERSE_PC_PROBES) {
    const pcWei = BigInt(pc) * BigInt(1e18);
    let inStr = 'reverted';
    let inFmt = '—';
    let usdStr = '—';
    let usdPerPcStr = '—';
    let reverted = true;
    try {
      const result = await pushPublic.readContract({
        address: QUOTER_ADDRESS as `0x${string}`,
        abi: QUOTER_ABI,
        functionName: 'quoteExactOutputSingle',
        args: [{
          tokenIn: args.prc20Address,
          tokenOut: wpcAddress,
          amount: pcWei,
          fee: feeTier,
          sqrtPriceLimitX96: BigInt(0),
        }],
      }) as readonly [bigint, bigint, number, bigint];
      const nativeIn = result[0];
      inStr = nativeIn.toString();
      inFmt = (Number(nativeIn) / Number(oneNativeUnit)).toFixed(6);
      const usd = (Number(nativeIn) / Number(oneNativeUnit)) * args.nativeAssetPriceUsd;
      usdStr = `$${usd.toFixed(2)}`;
      usdPerPcStr = `$${(usd / pc).toFixed(2)}`;
      reverted = false;
    } catch {
      // pool can't deliver this output
    }
    if (reverted && firstRevertAtPc === null) firstRevertAtPc = pc;
    console.log(
      `  ${pad(pc + ' PC', 12)}${pad(inStr, 24)}${pad(inFmt, 14)}${pad(usdStr, 14)}${usdPerPcStr}`
    );
  }

  // SDK-cap implication
  let pcAtCap = 0;
  {
    const pETHAtCap = (BigInt(SDK_CAP_USD * 1e8) * oneNativeUnit) / args.nativeAssetPrice8dec + BigInt(1);
    try {
      const r = await pushPublic.readContract({
        address: QUOTER_ADDRESS as `0x${string}`,
        abi: QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [{
          tokenIn: args.prc20Address,
          tokenOut: wpcAddress,
          amountIn: pETHAtCap,
          fee: feeTier,
          sqrtPriceLimitX96: BigInt(0),
        }],
      }) as readonly [bigint, bigint, number, bigint];
      pcAtCap = Number(r[0]) / 1e18;
    } catch {
      pcAtCap = 0;
    }
  }

  console.log(`\n  SDK-CAP IMPLICATION (${args.label})`);
  console.log(`  SDK fee-lock cap:           $${SDK_CAP_USD} USD/cycle`);
  console.log(`  Pool-quoted PC at cap:      ${pcAtCap.toFixed(4)} PC`);
  console.log(`  After 10% slippage margin:  ${(pcAtCap * 0.9).toFixed(4)} PC  ← max single-cycle bridge`);
  if (baselineUsdPerPc !== null) {
    console.log(`  Pool spot $/PC (smallest):  $${baselineUsdPerPc.toFixed(2)}`);
    console.log(`  vs SDK fixed $0.10/PC:      ${(baselineUsdPerPc / SDK_FIXED_USD_PER_PC).toFixed(1)}× higher`);
  }

  summary.push({
    label: args.label,
    prc20Symbol: args.prc20Symbol,
    poolAddress,
    spotUsdPerPc: baselineUsdPerPc,
    pcAtCap,
    safePcAtCap: pcAtCap * 0.9,
    firstRevertAtPc,
  });
}

describe('Pool depth diagnostic — pETH/WPC + pSOL/WPC Uniswap V3 (Push Testnet Donut)', () => {
  it('should snapshot pool state and probe forward + inverse depth for both bridge tokens', async () => {
    if (skipE2E) {
      console.warn('EVM_PRIVATE_KEY not set — skipping diagnostic');
      return;
    }

    // Common pool config: WPC, factory, fee tier (assume same default tier across PRC-20s)
    const gatewayPc = getUniversalGatewayPCAddress();
    const universalCore = await pushPublic.readContract({
      address: gatewayPc,
      abi: UNIVERSAL_GATEWAY_PC,
      functionName: 'UNIVERSAL_CORE',
      args: [],
    }) as `0x${string}`;

    const pETH = getNativePRC20ForChain(CHAIN.ETHEREUM_SEPOLIA, PUSH_NETWORK.TESTNET_DONUT);
    const pSOL = getNativePRC20ForChain(CHAIN.SOLANA_DEVNET, PUSH_NETWORK.TESTNET_DONUT);
    const pBNB = getNativePRC20ForChain(CHAIN.BNB_TESTNET, PUSH_NETWORK.TESTNET_DONUT);

    const [wpcAddress, factoryAddress, pETHFeeTier, pSOLFeeTier, pBNBFeeTier] = await Promise.all([
      pushPublic.readContract({
        address: universalCore, abi: UNIVERSAL_CORE_SWAP_HELPERS_ABI, functionName: 'WPC',
      }) as Promise<`0x${string}`>,
      pushPublic.readContract({
        address: universalCore, abi: UNIVERSAL_CORE_SWAP_HELPERS_ABI, functionName: 'uniswapV3Factory',
      }) as Promise<`0x${string}`>,
      pushPublic.readContract({
        address: universalCore, abi: UNIVERSAL_CORE_SWAP_HELPERS_ABI, functionName: 'defaultFeeTier', args: [pETH],
      }) as Promise<number>,
      pushPublic.readContract({
        address: universalCore, abi: UNIVERSAL_CORE_SWAP_HELPERS_ABI, functionName: 'defaultFeeTier', args: [pSOL],
      }) as Promise<number>,
      (pushPublic.readContract({
        address: universalCore, abi: UNIVERSAL_CORE_SWAP_HELPERS_ABI, functionName: 'defaultFeeTier', args: [pBNB],
      }) as Promise<number>).catch(() => 0),
    ]);

    console.log('\n═══════════════════════════════════════════════════════════════════════');
    console.log(' SHARED CONTEXT');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`  RPC:              ${PUSH_RPC}`);
    console.log(`  QuoterV2:         ${QUOTER_ADDRESS}`);
    console.log(`  Universal Core:   ${universalCore}`);
    console.log(`  Uniswap factory:  ${factoryAddress}`);

    // Native asset prices (pETH ≈ ETH, pSOL ≈ SOL via the locker oracle on each origin chain)
    const ethPrice8 = await new PriceFetch().getPrice(CHAIN.ETHEREUM_SEPOLIA);
    let solPrice8 = BigInt(0);
    try {
      solPrice8 = await new PriceFetch().getPrice(CHAIN.SOLANA_DEVNET);
    } catch (err) {
      console.warn(`  Could not fetch SOL price from Solana devnet locker — using fallback. (${err instanceof Error ? err.message : String(err)})`);
    }
    if (solPrice8 === BigInt(0)) {
      solPrice8 = BigInt(150 * 1e8);
      console.log('  SOL price (fallback): $150.00');
    }
    // BNB price oracle isn't fetched via PriceFetch (no locker on BNB testnet
    // in CHAIN_INFO). Use a static recent ref so the $/PC math is meaningful.
    const bnbPriceUsd = 600;
    const bnbPrice8 = BigInt(bnbPriceUsd * 1e8);

    const summary: PoolSummary[] = [];

    await probePool({
      label: 'pETH / WPC (Sepolia bridge)',
      prc20Address: pETH, prc20Symbol: 'pETH', prc20Decimals: 18,
      nativeAssetSymbol: 'ETH',
      nativeAssetPriceUsd: Number(ethPrice8) / 1e8,
      nativeAssetPrice8dec: ethPrice8,
    }, wpcAddress, factoryAddress, pETHFeeTier, summary);

    await probePool({
      label: 'pSOL / WPC (Solana bridge)',
      prc20Address: pSOL, prc20Symbol: 'pSOL', prc20Decimals: 9,
      nativeAssetSymbol: 'SOL',
      nativeAssetPriceUsd: Number(solPrice8) / 1e8,
      nativeAssetPrice8dec: solPrice8,
    }, wpcAddress, factoryAddress, pSOLFeeTier, summary);

    if (pBNBFeeTier > 0) {
      await probePool({
        label: 'pBNB / WPC (BNB bridge)',
        prc20Address: pBNB, prc20Symbol: 'pBNB', prc20Decimals: 18,
        nativeAssetSymbol: 'BNB',
        nativeAssetPriceUsd: bnbPriceUsd,
        nativeAssetPrice8dec: bnbPrice8,
      }, wpcAddress, factoryAddress, pBNBFeeTier, summary);
    } else {
      console.log('\n  ⚠️  No defaultFeeTier configured for pBNB on UniversalCore — skipping pBNB pool.');
    }

    // ──────────────────────────────────────────────────────────────────────
    // CROSS-POOL COMPARISON TABLE
    // ──────────────────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════════════════════');
    console.log(' CROSS-POOL SUMMARY (vs SDK fixed rate $0.10/PC)');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`  ${pad('Pool', 14)}${pad('Spot $/PC', 14)}${pad('vs $0.10 fixed', 18)}${pad('Safe PC @ $1k cap', 22)}First revert at`);
    console.log('  ' + '─'.repeat(95));
    for (const s of summary) {
      const ratioStr = s.spotUsdPerPc !== null
        ? `${(s.spotUsdPerPc / SDK_FIXED_USD_PER_PC).toFixed(1)}× off`
        : 'n/a';
      const spotStr = s.spotUsdPerPc !== null ? `$${s.spotUsdPerPc.toFixed(4)}` : 'n/a';
      const revertStr = s.firstRevertAtPc !== null ? `${s.firstRevertAtPc} PC` : 'no revert in probe range';
      console.log(
        `  ${pad(s.prc20Symbol, 14)}${pad(spotStr, 14)}${pad(ratioStr, 18)}${pad(s.safePcAtCap.toFixed(2), 22)}${revertStr}`
      );
    }
    console.log('═══════════════════════════════════════════════════════════════════════\n');
  }, 180_000);
});
