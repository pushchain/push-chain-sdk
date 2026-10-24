/** Read-only protocol compatibility of the shipped testnet presets.
 * Build core first. No signer, environment keys, funding or transactions.
 * For every preset chain: the wrap target accepts native ETH (simulated with a
 * balance override), the Uniswap router wraps into that WETH and a WETH/USDC pool
 * quotes USDC for a dust swap, and the Aave pool lists that WETH as a reserve.
 * Usage: node packages/core/scripts/check-agw-preset-compatibility.js [report.json]
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
} = require('viem');
const built = path.resolve(__dirname, '../../../dist/packages/core/src');
const { PRESET_CATALOG } = require(path.join(
  built,
  'lib/agentic/presets/catalog'
));
const abi = parseAbi([
  'function deposit() payable',
  'function WETH9() view returns (address)',
  // QuoterV2 is non-view; declared view so eth_call returns the quote.
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) view returns (uint256,uint160,uint32,uint256)',
  'function getReservesList() view returns (address[])',
]);
const endpoints = {
  'eip155:11155111': 'https://ethereum-sepolia-rpc.publicnode.com',
  'eip155:84532': 'https://base-sepolia-rpc.publicnode.com',
  'eip155:421614': 'https://arbitrum-sepolia-rpc.publicnode.com',
};
const PROBE = '0x000000000000000000000000000000000000dEaD';
// Uniswap V3 QuoterV2 per testnet; the acceptance spec sends 1e12 wei.
const QUOTERS = {
  'eip155:11155111': '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3',
  'eip155:84532': '0xC5290058841028F1614F3A6F0F5816cAd0df5E27',
  'eip155:421614': '0x2779a0CC1c3e0E44D2542EC3e79e3864Ae93Ef0B',
};
const QUOTE_AMOUNT = BigInt(10) ** BigInt(12);
const callTo = (def, selector) =>
  def.allowedCalls.find((c) => c.selector.startsWith(selector));
async function main() {
  const report = { at: new Date().toISOString(), readOnly: true, cases: [] };
  for (const preset of PRESET_CATALOG)
    for (const def of preset.chains) {
      const result = { preset: preset.constant, chain: def.chainNamespace };
      report.cases.push(result);
      const endpoint = endpoints[def.chainNamespace];
      if (!endpoint) {
        result.error = 'no read-only endpoint configured';
        process.exitCode = 1;
        continue;
      }
      try {
        const rpc = createPublicClient({
          transport: http(endpoint, { timeout: 12000, retryCount: 1 }),
        });
        const block = await rpc.getBlockNumber();
        result.block = String(block);
        if (
          (await rpc.getChainId()) !== Number(def.chainNamespace.split(':')[1])
        )
          throw new Error('Destination chain mismatch');
        const read = (address, functionName, args = []) =>
          rpc.readContract({
            address,
            abi,
            functionName,
            args,
            blockNumber: block,
          });
        const weth = getAddress(callTo(def, 'deposit(').target);
        await rpc.call({
          account: PROBE,
          to: weth,
          data: encodeFunctionData({ abi, functionName: 'deposit' }),
          value: BigInt(1),
          blockNumber: block,
          stateOverride: [
            { address: PROBE, balance: BigInt(10) ** BigInt(18) },
          ],
        });
        result.wrapsNativeEth = true;
        if (preset.constant === 'DEXES') {
          const swap = callTo(def, 'exactInputSingle(');
          const router = getAddress(swap.target);
          const usdc = getAddress(
            def.allowedCalls.find(
              (c) =>
                c.selector === 'approve(address,uint256)' &&
                getAddress(c.target) !== weth
            ).target
          );
          result.routerWeth9 = getAddress(await read(router, 'WETH9'));
          if (result.routerWeth9 !== weth)
            throw new Error(`router wraps into ${result.routerWeth9}`);
          // Liquidity alone is not enough: thin, mispriced testnet pools can
          // return nothing. Quote a dust swap at every tier instead.
          result.quotes = [];
          for (const fee of [100, 500, 3000, 10000]) {
            try {
              const [out] = await read(
                QUOTERS[def.chainNamespace],
                'quoteExactInputSingle',
                [
                  {
                    tokenIn: weth,
                    tokenOut: usdc,
                    amountIn: QUOTE_AMOUNT,
                    fee,
                    sqrtPriceLimitX96: BigInt(0),
                  },
                ]
              );
              result.quotes.push({ fee, usdcOut: String(out) });
            } catch {
              // no pool at this tier
            }
          }
          if (!result.quotes.some((q) => BigInt(q.usdcOut) > BigInt(0)))
            throw new Error('no WETH/USDC tier returns USDC for a dust swap');
        }
        if (preset.constant === 'LENDING') {
          const pool = getAddress(callTo(def, 'supply(').target);
          const reserves = (await read(pool, 'getReservesList')).map((r) =>
            getAddress(r)
          );
          result.wethIsReserve = reserves.includes(weth);
          if (!result.wethIsReserve)
            throw new Error(`${weth} is not an Aave reserve`);
        }
        console.log(`${preset.constant} ${def.chainNamespace}: compatible`);
      } catch (error) {
        // An RPC failure is unknown, not incompatible; both fail the check.
        result.error = error.shortMessage || error.message;
        process.exitCode = 1;
        console.error(
          `${preset.constant} ${def.chainNamespace}: ${result.error}`
        );
      }
    }
  const output = process.argv[2] || '/tmp/agw-preset-compatibility.json';
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(
    `Read-only report: ${output}; ${
      report.cases.filter((c) => !c.error).length
    }/${report.cases.length} compatible.`
  );
}
main().catch((error) => {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});
