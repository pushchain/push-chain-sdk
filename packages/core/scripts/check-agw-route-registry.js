/** Read-only drift check between the SDK's token routes and the Push node's
 * token registry (uregistry, read through Tendermint abci_query). No keys.
 * - mismatch: the SDK maps a source token to a different PRC20 than the node.
 * - sdkOnly:  the SDK maps a PRC20 the node does not list as enabled.
 * - nodeOnly: an enabled node route the SDK does not resolve (informational).
 * Exit 1 on any mismatch or sdkOnly entry.
 * Build core, then: node packages/core/scripts/check-agw-route-registry.js [report.json]
 */
const fs = require('node:fs');
const path = require('node:path');
const { getAddress } = require('viem');
const built = path.resolve(__dirname, '../../../dist/packages/core/src');
const { PushChain } = require(built);
const { SYNTHETIC_PUSH_ERC20 } = require(path.join(
  built,
  'lib/constants/chain'
));
const { MOVEABLE_TOKENS } = require(path.join(built, 'lib/constants/tokens'));
const { getPRC20Address } = require(path.join(
  built,
  'lib/universal/prc20-address'
));
const { getNativePRC20ForChain } = require(path.join(
  built,
  'lib/orchestrator/internals/helpers'
));
const { exactAgenticRoutes, resolveAgenticPrc20 } = require(path.join(
  built,
  'lib/agentic/token-routes'
));
const { PRESET_CATALOG } = require(path.join(
  built,
  'lib/agentic/presets/catalog'
));
const RPC = 'https://donut.rpc.push.org:443';
const DONUT = PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT;
const NATIVE = new Set([
  '0x0000000000000000000000000000000000000000',
  '11111111111111111111111111111111',
]);

function varint(buf, i) {
  let x = BigInt(0),
    s = BigInt(0);
  for (;;) {
    const b = buf[i++];
    x |= BigInt(b & 0x7f) << s;
    if (!(b & 0x80)) return [x, i];
    s += BigInt(7);
  }
}
function fields(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    let key;
    [key, i] = varint(buf, i);
    const no = Number(key >> BigInt(3)),
      wt = Number(key & BigInt(7));
    if (wt === 0) {
      let v;
      [v, i] = varint(buf, i);
      out.push([no, v]);
    } else if (wt === 2) {
      let l;
      [l, i] = varint(buf, i);
      out.push([no, buf.subarray(i, i + Number(l))]);
      i += Number(l);
    } else if (wt === 5) i += 4;
    else if (wt === 1) i += 8;
    else throw new Error(`unsupported protobuf wire type ${wt}`);
  }
  return out;
}
const text = (b) => Buffer.from(b).toString('utf8');
function tokenConfig(buf) {
  const t = {};
  for (const [no, v] of fields(buf)) {
    if (no === 1) t.chain = text(v);
    else if (no === 2) t.address = text(v);
    else if (no === 4) t.symbol = text(v);
    else if (no === 5) t.decimals = Number(v);
    else if (no === 6) t.enabled = v === BigInt(1);
    else if (no === 9)
      for (const [n2, v2] of fields(v)) if (n2 === 2) t.prc20 = text(v2);
  }
  return t;
}
async function nodeTokenConfigs() {
  const info = await (await fetch(`${RPC}/abci_info`)).json();
  // QueryAllTokenConfigsRequest { pagination: { limit: 1000 } }
  const data = '0a0318e807';
  const r = await (
    await fetch(
      `${RPC}/abci_query?path=%22/uregistry.v1.Query/AllTokenConfigs%22&data=0x${data}`
    )
  ).json();
  const res = r.result && r.result.response;
  if (!res || res.code)
    throw new Error(`abci_query failed: ${JSON.stringify(r)}`);
  return {
    node: info.result.response.version,
    height: res.height,
    configs: fields(Buffer.from(res.value || '', 'base64'))
      .filter(([no]) => no === 1)
      .map(([, v]) => tokenConfig(v)),
  };
}
function sdkResolve(chain, address) {
  if (NATIVE.has(address))
    return getAddress(getNativePRC20ForChain(chain, DONUT));
  if (chain.startsWith('solana:')) {
    const token = (MOVEABLE_TOKENS[chain] || []).find(
      (t) => t.address === address
    );
    if (!token) throw new Error('not in SDK registry');
    return getAddress(getPRC20Address(token, { network: DONUT }).address);
  }
  return resolveAgenticPrc20({ chain, address }, DONUT).address;
}
async function main() {
  const { node, height, configs } = await nodeTokenConfigs();
  const report = {
    at: new Date().toISOString(),
    readOnly: true,
    rpc: RPC,
    node,
    height,
    matched: [],
    mismatch: [],
    nodeOnly: [],
    sdkOnly: [],
    presetTokens: [],
  };
  const enabled = configs.filter((c) => c.enabled && c.prc20);
  const nodePrc20s = new Set(enabled.map((c) => getAddress(c.prc20)));
  for (const c of enabled) {
    const entry = {
      chain: c.chain,
      address: c.address,
      symbol: c.symbol,
      decimals: c.decimals,
      nodePrc20: getAddress(c.prc20),
    };
    try {
      const sdkPrc20 = sdkResolve(c.chain, c.address);
      (sdkPrc20 === entry.nodePrc20 ? report.matched : report.mismatch).push({
        ...entry,
        sdkPrc20,
      });
    } catch (e) {
      report.nodeOnly.push({ ...entry, sdk: e.message });
    }
  }
  const sdkPrc20s = new Map();
  for (const [key, address] of Object.entries(SYNTHETIC_PUSH_ERC20[DONUT]))
    sdkPrc20s.set(getAddress(address), key);
  for (const chain of new Set(enabled.map((c) => c.chain)))
    for (const route of exactAgenticRoutes(chain, DONUT))
      sdkPrc20s.set(getAddress(route.prc20), `exact:${chain}:${route.source}`);
  for (const [prc20, key] of sdkPrc20s)
    if (!nodePrc20s.has(prc20)) report.sdkOnly.push({ key, prc20 });
  for (const preset of PRESET_CATALOG)
    for (const chain of preset.chains) {
      if (!enabled.some((c) => c.chain === chain.chainNamespace)) continue;
      for (const token of chain.defaultTokens || []) {
        const route = enabled.find(
          (c) =>
            c.chain === chain.chainNamespace &&
            c.address.toLowerCase() === token.toLowerCase()
        );
        report.presetTokens.push({
          preset: preset.constant,
          chain: chain.chainNamespace,
          token,
          nodePrc20: route ? getAddress(route.prc20) : null,
        });
      }
    }
  const json = JSON.stringify(
    report,
    (_k, v) => (typeof v === 'bigint' ? String(v) : v),
    2
  );
  if (process.argv[2]) fs.writeFileSync(process.argv[2], json);
  console.log(json);
  if (report.mismatch.length || report.sdkOnly.length) process.exitCode = 1;
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
