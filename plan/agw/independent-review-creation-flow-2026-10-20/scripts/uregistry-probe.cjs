// Read-only abci_query of the node's uregistry token configs (canonical route registry).
const fs = require('node:fs');
const RPC = 'https://donut.rpc.push.org:443';
function varint(buf, i) { let x = 0n, s = 0n; for (;;) { const b = buf[i++]; x |= BigInt(b & 0x7f) << s; if (!(b & 0x80)) break; s += 7n; } return [x, i]; }
function fields(buf) {
  const out = []; let i = 0;
  while (i < buf.length) {
    let key; [key, i] = varint(buf, i);
    const no = Number(key >> 3n), wt = Number(key & 7n);
    if (wt === 0) { let v; [v, i] = varint(buf, i); out.push([no, v]); }
    else if (wt === 2) { let l; [l, i] = varint(buf, i); out.push([no, buf.subarray(i, i + Number(l))]); i += Number(l); }
    else if (wt === 5) { out.push([no, buf.subarray(i, i + 4)]); i += 4; }
    else if (wt === 1) { out.push([no, buf.subarray(i, i + 8)]); i += 8; }
    else throw new Error('wire type ' + wt);
  }
  return out;
}
const str = (b) => Buffer.from(b).toString('utf8');
function tokenConfig(buf) {
  const t = {};
  for (const [no, v] of fields(buf)) {
    if (no === 1) t.chain = str(v); else if (no === 2) t.address = str(v); else if (no === 3) t.name = str(v);
    else if (no === 4) t.symbol = str(v); else if (no === 5) t.decimals = Number(v); else if (no === 6) t.enabled = v === 1n;
    else if (no === 7) t.liquidityCap = str(v); else if (no === 8) t.tokenType = Number(v);
    else if (no === 9) { t.native = {}; for (const [n2, v2] of fields(v)) { if (n2 === 1) t.native.denom = str(v2); if (n2 === 2) t.native.contractAddress = str(v2); } }
  }
  return t;
}
async function abci(path, dataHex) {
  const url = `${RPC}/abci_query?path=%22${encodeURIComponent(path)}%22&data=0x${dataHex}`;
  const r = await (await fetch(url)).json();
  if (!r.result || r.result.response.code) throw new Error(JSON.stringify(r).slice(0, 400));
  return { height: r.result.response.height, value: Buffer.from(r.result.response.value || '', 'base64') };
}
async function main() {
  const out = { at: new Date().toISOString(), rpc: RPC, readOnly: true };
  const info = await (await fetch(`${RPC}/abci_info`)).json();
  out.node = info.result.response;
  // pagination { limit: 1000 }
  const req = Buffer.from([0x0a, 0x03, 0x18, 0xe8, 0x07]);
  const r = await abci('/uregistry.v1.Query/AllTokenConfigs', req.toString('hex'));
  out.height = r.height;
  out.tokenConfigs = fields(r.value).filter(([no]) => no === 1).map(([, v]) => tokenConfig(v));
  const rc = await abci('/uregistry.v1.Query/AllChainConfigs', req.toString('hex'));
  out.chainConfigCount = fields(rc.value).filter(([no]) => no === 1).length;
  out.chainConfigsRaw = fields(rc.value).filter(([no]) => no === 1).map(([, v]) => fields(v).filter(([n]) => n === 1).map(([, s]) => str(s))[0]);
  fs.writeFileSync(process.argv[2], JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  console.log('ok height', out.height, 'tokens', out.tokenConfigs.length);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
