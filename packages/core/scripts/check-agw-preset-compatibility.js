/** Read-only protocol compatibility of the exact routed testnet tokens.
 * Build core first. No signer, environment keys, funding or transactions.
 * Usage: node packages/core/scripts/check-agw-preset-compatibility.js [report.json]
 */
const fs = require('node:fs');
const path = require('node:path');
const { createPublicClient, http, parseAbi, zeroAddress } = require('viem');
const built = path.resolve(__dirname, '../../../dist/packages/core/src');
const { PushChain } = require(built);
const { MOVEABLE_TOKENS } = require(path.join(built, 'lib/constants/tokens'));
const { exactAgenticRoutes, resolveAgenticPrc20 } = require(path.join(
  built,
  'lib/agentic/token-routes'
));
const { PRESET_CATALOG } = require(path.join(
  built,
  'lib/agentic/presets/catalog'
));
const DONUT = PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT;
const abi = parseAbi([
  'function factory() view returns (address)',
  'function getPool(address,address,uint24) view returns (address)',
  'function liquidity() view returns (uint128)',
  'function getReservesList() view returns (address[])',
  'function underlying() view returns (address)',
  'function underlyingToken() view returns (address)',
  'function SOURCE_CHAIN_NAMESPACE() view returns (string)',
  'function SOURCE_TOKEN_ADDRESS() view returns (string)',
]);
const endpoints = {
  'eip155:11155111': 'https://ethereum-sepolia-rpc.publicnode.com',
  'eip155:84532': 'https://base-sepolia-rpc.publicnode.com',
  'eip155:421614': 'https://arbitrum-sepolia-rpc.publicnode.com',
  'eip155:97': 'https://bsc-testnet-rpc.publicnode.com',
};
async function main() {
  const report = { at: new Date().toISOString(), readOnly: true, chains: [] };
  const push = createPublicClient({
    transport: http('https://evm.donut.rpc.push.org/', {
      timeout: 15000,
      retryCount: 1,
    }),
  });
  report.pushBlock = String(await push.getBlockNumber());
  if ((await push.getChainId()) !== 42101) throw new Error('Expected Donut');
  for (const [chain, endpoint] of Object.entries(endpoints)) {
    const entry = { chain, candidates: [], protocols: [], presets: [] };
    report.chains.push(entry);
    const rpc = createPublicClient({
      transport: http(endpoint, { timeout: 12000, retryCount: 1 }),
    });
    try {
      const block = await rpc.getBlockNumber();
      entry.block = String(block);
      if ((await rpc.getChainId()) !== Number(chain.split(':')[1]))
        throw new Error('Destination chain mismatch');
      const read = (address, functionName, args = []) =>
        rpc.readContract({
          address,
          abi,
          functionName,
          args,
          blockNumber: block,
        });
      // Registry tokens plus exact node routes the symbol registry cannot hold.
      const sources = new Map();
      for (const token of MOVEABLE_TOKENS[chain] || [])
        if (token.mechanism !== 'native')
          sources.set(token.address.toLowerCase(), token);
      for (const route of exactAgenticRoutes(chain, DONUT))
        sources.set(route.source.toLowerCase(), {
          address: route.source,
          symbol: route.symbol,
        });
      for (const token of sources.values()) {
        let mapped;
        try {
          mapped = resolveAgenticPrc20(
            { chain, address: token.address },
            DONUT
          );
        } catch (e) {
          entry.candidates.push({
            token: token.address,
            symbol: token.symbol,
            unavailable: e.shortMessage || e.message,
          });
          continue;
        }
        try {
          const [sourceChain, source] = await Promise.all([
            push.readContract({
              address: mapped.address,
              abi,
              functionName: 'SOURCE_CHAIN_NAMESPACE',
              blockNumber: BigInt(report.pushBlock),
            }),
            push
              .readContract({
                address: mapped.address,
                abi,
                functionName: 'SOURCE_TOKEN_ADDRESS',
                blockNumber: BigInt(report.pushBlock),
              })
              .catch(() =>
                push.readContract({
                  address: mapped.address,
                  abi: parseAbi([
                    'function SOURCE_TOKEN_ADDRESS() view returns (address)',
                  ]),
                  functionName: 'SOURCE_TOKEN_ADDRESS',
                  blockNumber: BigInt(report.pushBlock),
                })
              ),
          ]);
          entry.candidates.push({
            token: token.address,
            symbol: token.symbol,
            prc20: mapped.address,
            identityVerified:
              sourceChain === chain &&
              source.toLowerCase() === token.address.toLowerCase(),
          });
        } catch (e) {
          // An RPC failure is unknown, not unsupported.
          entry.candidates.push({
            token: token.address,
            symbol: token.symbol,
            prc20: mapped.address,
            readError: e.shortMessage || e.message,
          });
        }
      }
      const routed = entry.candidates.filter((c) => c.identityVerified);
      for (const preset of PRESET_CATALOG) {
        const def = preset.chains.find((c) => c.chainNamespace === chain);
        if (!def) continue;
        const generated = PushChain.utils.agentic.presets.get(preset.constant, {
          chainNamespace: chain,
          agent: '0x0000000000000000000000000000000000005678',
        });
        entry.presets.push({
          category: preset.constant,
          readiness: generated.readiness,
          assets: generated.rules[0].assets,
        });
        if (def.swapRouters)
          for (const router of def.swapRouters) {
            const result = {
              app: router.app,
              kind: 'dex',
              router: router.address,
              pairs: [],
            };
            entry.protocols.push(result);
            try {
              result.factory = await read(router.address, 'factory');
              // The preset's own pair: one routed side is enough to trade into the other.
              const pair = generated.rules[0].assets.map((a) =>
                typeof a.token === 'string' ? a.token : a.token.address
              );
              if (pair.length === 2) {
                result.defaultPair = {
                  tokens: pair,
                  routed: pair.map((t) =>
                    routed.some(
                      (c) => c.token.toLowerCase() === t.toLowerCase()
                    )
                  ),
                  pools: [],
                };
                for (const fee of [100, 500, 2500, 3000, 10000]) {
                  try {
                    const pool = await read(result.factory, 'getPool', [
                      ...pair,
                      fee,
                    ]);
                    if (pool === zeroAddress) continue;
                    result.defaultPair.pools.push({
                      fee,
                      pool,
                      liquidity: String(await read(pool, 'liquidity')),
                    });
                  } catch (e) {
                    result.defaultPair.pools.push({
                      fee,
                      error: e.shortMessage || e.message,
                    });
                  }
                }
              }
              for (let i = 0; i < routed.length; i++)
                for (let j = i + 1; j < routed.length; j++) {
                  const pair = {
                    tokens: [routed[i].token, routed[j].token],
                    pools: [],
                  };
                  result.pairs.push(pair);
                  for (const fee of [100, 500, 2500, 3000, 10000]) {
                    try {
                      const pool = await read(result.factory, 'getPool', [
                        ...pair.tokens,
                        fee,
                      ]);
                      if (pool === zeroAddress) continue;
                      pair.pools.push({
                        fee,
                        pool,
                        liquidity: String(await read(pool, 'liquidity')),
                      });
                    } catch (e) {
                      pair.pools.push({
                        fee,
                        error: e.shortMessage || e.message,
                      });
                    }
                  }
                }
            } catch (e) {
              result.error = e.shortMessage || e.message;
            }
          }
        const aave = def.allowedCalls.find((c) => c.app === 'Aave V3');
        if (aave) {
          const result = { app: 'Aave V3', kind: 'lending', pool: aave.target };
          entry.protocols.push(result);
          try {
            result.reserves = await read(aave.target, 'getReservesList');
            result.routedReserves = routed.filter((c) =>
              result.reserves.some(
                (a) => a.toLowerCase() === c.token.toLowerCase()
              )
            );
          } catch (e) {
            result.error = e.shortMessage || e.message;
          }
        }
        const markets = [
          ...new Map(
            def.allowedCalls
              .filter((c) => c.budget?.kind === 'fixed-token')
              .map((c) => [c.target, c])
          ).values(),
        ];
        for (const market of markets) {
          const result = {
            app: market.app,
            kind: 'market',
            market: market.target,
          };
          entry.protocols.push(result);
          try {
            result.underlying = await read(market.target, 'underlying');
            result.routed = routed.some(
              (c) => c.token.toLowerCase() === result.underlying.toLowerCase()
            );
          } catch (e) {
            result.error = e.shortMessage || e.message;
          }
        }
        if (preset.constant === 'STAKING') {
          const strategy = '0x424246eF71b01ee33aA33aC590fd9a0855F5eFbc';
          const result = { app: 'EigenLayer', kind: 'strategy', strategy };
          entry.protocols.push(result);
          try {
            result.underlying = await read(strategy, 'underlyingToken');
            result.routed = routed.some(
              (c) => c.token.toLowerCase() === result.underlying.toLowerCase()
            );
          } catch (e) {
            result.error = e.shortMessage || e.message;
          }
        }
      }
    } catch (e) {
      entry.error = e.shortMessage || e.message;
    }
  }
  const output = process.argv[2];
  if (output)
    fs.writeFileSync(
      output,
      JSON.stringify(
        report,
        (_k, v) => (typeof v === 'bigint' ? String(v) : v),
        2
      )
    );
  for (const c of report.chains)
    console.log(
      JSON.stringify(
        {
          chain: c.chain,
          block: c.block,
          error: c.error,
          routed: c.candidates
            .filter((x) => x.identityVerified)
            .map((x) => x.symbol),
          protocols: c.protocols,
        },
        null,
        2
      )
    );
  if (
    report.chains.some(
      (c) =>
        c.error ||
        c.candidates.some((x) => x.readError) ||
        c.protocols.some(
          (p) =>
            p.error ||
            p.pairs?.some((x) => x.pools.some((y) => y.error)) ||
            p.defaultPair?.pools.some((y) => y.error)
        )
    )
  )
    process.exitCode = 1;
}
main().catch((e) => {
  console.error(e.shortMessage || e.message);
  process.exitCode = 1;
});
