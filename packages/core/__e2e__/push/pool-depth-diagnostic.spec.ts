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

describe('Pool depth diagnostic — pETH/WPC Uniswap V3 (Push Testnet Donut)', () => {
  const skipE2E = !process.env['EVM_PRIVATE_KEY'];

  // Lightweight viem client — no Push Chain ID needed for read-only calls.
  const pushPublic = createPublicClient({
    transport: http(PUSH_RPC),
  });

  it('should snapshot pool state and probe forward + inverse depth', async () => {
    if (skipE2E) {
      console.warn('EVM_PRIVATE_KEY not set — skipping diagnostic');
      return;
    }

    // ──────────────────────────────────────────────────────────────────────
    // 1. Pool identity
    // ──────────────────────────────────────────────────────────────────────
    const pETH = getNativePRC20ForChain(CHAIN.ETHEREUM_SEPOLIA, PUSH_NETWORK.TESTNET_DONUT);
    const gatewayPc = getUniversalGatewayPCAddress();
    const universalCore = await pushPublic.readContract({
      address: gatewayPc,
      abi: UNIVERSAL_GATEWAY_PC,
      functionName: 'UNIVERSAL_CORE',
      args: [],
    }) as `0x${string}`;

    const [wpcAddress, factoryAddress, feeTier] = await Promise.all([
      pushPublic.readContract({
        address: universalCore,
        abi: UNIVERSAL_CORE_SWAP_HELPERS_ABI,
        functionName: 'WPC',
      }) as Promise<`0x${string}`>,
      pushPublic.readContract({
        address: universalCore,
        abi: UNIVERSAL_CORE_SWAP_HELPERS_ABI,
        functionName: 'uniswapV3Factory',
      }) as Promise<`0x${string}`>,
      pushPublic.readContract({
        address: universalCore,
        abi: UNIVERSAL_CORE_SWAP_HELPERS_ABI,
        functionName: 'defaultFeeTier',
        args: [pETH],
      }) as Promise<number>,
    ]);

    const poolAddress = await pushPublic.readContract({
      address: factoryAddress,
      abi: FACTORY_ABI,
      functionName: 'getPool',
      args: [wpcAddress, pETH, feeTier],
    }) as `0x${string}`;

    console.log('\n═══════════════════════════════════════════════════════════════════════');
    console.log(' POOL IDENTITY');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`  RPC:              ${PUSH_RPC}`);
    console.log(`  QuoterV2:         ${QUOTER_ADDRESS}`);
    console.log(`  Universal Core:   ${universalCore}`);
    console.log(`  Uniswap factory:  ${factoryAddress}`);
    console.log(`  WPC:              ${wpcAddress}`);
    console.log(`  pETH (PRC-20):    ${pETH}`);
    console.log(`  Default fee tier: ${feeTier} (${(feeTier / 10000).toFixed(2)}%)`);
    console.log(`  Pool address:     ${poolAddress}`);

    // ──────────────────────────────────────────────────────────────────────
    // 2. Pool state snapshot
    // ──────────────────────────────────────────────────────────────────────
    const blockNumber = await pushPublic.getBlockNumber();
    const block = await pushPublic.getBlock({ blockNumber });
    const slot0 = await pushPublic.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: 'slot0',
    }) as readonly [bigint, number, number, number, number, number, boolean];
    const liquidity = await pushPublic.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: 'liquidity',
    }) as bigint;

    console.log('\n═══════════════════════════════════════════════════════════════════════');
    console.log(' POOL STATE SNAPSHOT');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`  Block:            ${blockNumber}  (${new Date(Number(block.timestamp) * 1000).toISOString()})`);
    console.log(`  sqrtPriceX96:     ${slot0[0].toString()}`);
    console.log(`  tick:             ${slot0[1]}`);
    console.log(`  active liquidity: ${liquidity.toString()}`);

    // ──────────────────────────────────────────────────────────────────────
    // 3. ETH price (used to convert USD → pETH wei for forward probes)
    // ──────────────────────────────────────────────────────────────────────
    const ethPrice8dec = await new PriceFetch().getPrice(CHAIN.ETHEREUM_SEPOLIA);
    const ethPriceUsd = Number(ethPrice8dec) / 1e8;
    console.log(`  ETH price (oracle): $${ethPriceUsd.toFixed(2)}`);

    // ──────────────────────────────────────────────────────────────────────
    // 4. Forward depth probe — quoteExactInputSingle
    // ──────────────────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════════════════════');
    console.log(' FORWARD DEPTH (USD pETH input → PC output)');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`  ${pad('USD', 10)}${pad('pETH (wei)', 24)}${pad('pETH', 14)}${pad('PC out', 16)}${pad('$/PC', 14)}vs $1`);
    console.log('  ' + '─'.repeat(90));

    let baselineUsdPerPc: number | null = null;
    for (const usd of FORWARD_USD_PROBES) {
      const usd8 = BigInt(Math.round(usd * 1e8));
      const pETHWei = (usd8 * BigInt(1e18)) / ethPrice8dec + BigInt(1);
      let pcOutStr = 'reverted';
      let usdPerPcStr = '—';
      let slipStr = 'quote-fail';
      try {
        const result = await pushPublic.readContract({
          address: QUOTER_ADDRESS as `0x${string}`,
          abi: QUOTER_ABI,
          functionName: 'quoteExactInputSingle',
          args: [{
            tokenIn: pETH,
            tokenOut: wpcAddress,
            amountIn: pETHWei,
            fee: feeTier,
            sqrtPriceLimitX96: BigInt(0),
          }],
        }) as readonly [bigint, bigint, number, bigint];
        const pcOut = result[0];
        const pcOutF = Number(pcOut) / 1e18;
        pcOutStr = pcOutF.toFixed(6);
        if (pcOutF > 0) {
          const usdPerPc = usd / pcOutF;
          usdPerPcStr = `$${usdPerPc.toFixed(2)}`;
          if (baselineUsdPerPc === null) baselineUsdPerPc = usdPerPc;
          const ratio = usdPerPc / baselineUsdPerPc;
          const slipPct = (ratio - 1) * 100;
          slipStr = `${ratio.toFixed(2)}×  (${slipPct >= 0 ? '+' : ''}${slipPct.toFixed(0)}% slip)`;
        }
      } catch (err) {
        // quote reverted (pool can't fill at this size)
      }
      console.log(
        `  ${pad('$' + usd, 10)}${pad(pETHWei.toString(), 24)}${pad(formatEthFromWei(pETHWei), 14)}${pad(pcOutStr, 16)}${pad(usdPerPcStr, 14)}${slipStr}`
      );
    }

    // ──────────────────────────────────────────────────────────────────────
    // 5. Inverse depth probe — quoteExactOutputSingle
    // ──────────────────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════════════════════');
    console.log(' INVERSE DEPTH (target PC output → pETH input)');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`  ${pad('PC out', 12)}${pad('pETH in (wei)', 24)}${pad('pETH', 14)}${pad('USD', 14)}$/PC`);
    console.log('  ' + '─'.repeat(85));

    for (const pc of INVERSE_PC_PROBES) {
      const pcWei = BigInt(pc) * BigInt(1e18);
      let pETHInStr = 'reverted';
      let pETHFmt = '—';
      let usdStr = '—';
      let usdPerPcStr = '—';
      try {
        const result = await pushPublic.readContract({
          address: QUOTER_ADDRESS as `0x${string}`,
          abi: QUOTER_ABI,
          functionName: 'quoteExactOutputSingle',
          args: [{
            tokenIn: pETH,
            tokenOut: wpcAddress,
            amount: pcWei,
            fee: feeTier,
            sqrtPriceLimitX96: BigInt(0),
          }],
        }) as readonly [bigint, bigint, number, bigint];
        const pETHIn = result[0];
        pETHInStr = pETHIn.toString();
        pETHFmt = formatEthFromWei(pETHIn);
        const usd = (Number(pETHIn) / 1e18) * ethPriceUsd;
        usdStr = `$${usd.toFixed(2)}`;
        usdPerPcStr = `$${(usd / pc).toFixed(2)}`;
      } catch (err) {
        // pool can't deliver this much output
      }
      console.log(
        `  ${pad(pc + ' PC', 12)}${pad(pETHInStr, 24)}${pad(pETHFmt, 14)}${pad(usdStr, 14)}${usdPerPcStr}`
      );
    }

    // ──────────────────────────────────────────────────────────────────────
    // 6. SDK-cap implication + comparison with fixed accounting rate
    // ──────────────────────────────────────────────────────────────────────
    let pcAtCap = 0;
    {
      const usdAtCap = SDK_CAP_USD;
      const pETHWeiAtCap = (BigInt(usdAtCap * 1e8) * BigInt(1e18)) / ethPrice8dec + BigInt(1);
      try {
        const r = await pushPublic.readContract({
          address: QUOTER_ADDRESS as `0x${string}`,
          abi: QUOTER_ABI,
          functionName: 'quoteExactInputSingle',
          args: [{
            tokenIn: pETH,
            tokenOut: wpcAddress,
            amountIn: pETHWeiAtCap,
            fee: feeTier,
            sqrtPriceLimitX96: BigInt(0),
          }],
        }) as readonly [bigint, bigint, number, bigint];
        pcAtCap = Number(r[0]) / 1e18;
      } catch {
        pcAtCap = 0;
      }
    }
    const safePcAtCap = pcAtCap * 0.9;

    console.log('\n═══════════════════════════════════════════════════════════════════════');
    console.log(' SDK-CAP IMPLICATION');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`  SDK fee-lock cap:                $${SDK_CAP_USD} USD per cycle`);
    console.log(`  Pool-quoted PC at cap:           ${pcAtCap.toFixed(4)} PC`);
    console.log(`  After 10% slippage margin:       ${safePcAtCap.toFixed(4)} PC  ← max single-cycle bridge to a 0-balance UEA`);

    console.log('\n═══════════════════════════════════════════════════════════════════════');
    console.log(' FIXED-RATE vs POOL-RATE COMPARISON');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`  SDK fixed accounting rate:       1 PC = $${SDK_FIXED_USD_PER_PC.toFixed(2)} (constants/chain.ts pushToUsdc*)`);
    if (baselineUsdPerPc !== null) {
      console.log(`  Pool spot rate (smallest probe): 1 PC = $${baselineUsdPerPc.toFixed(2)}`);
      console.log(`  Divergence factor:               ${(baselineUsdPerPc / SDK_FIXED_USD_PER_PC).toFixed(1)}×`);
      console.log(`  ⇒ pre-sizing-fix the SDK requested ~${(baselineUsdPerPc / SDK_FIXED_USD_PER_PC).toFixed(0)}× too few USD per PC`);
    }
    console.log('═══════════════════════════════════════════════════════════════════════\n');
  }, 120_000);
});
