// Read-only ABI/envelope compatibility checks; no signer or transaction submission.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const v = require('viem');
const root = __dirname;
const policy = JSON.parse(fs.readFileSync(path.join(root, 'abis/policy.json'), 'utf8'));
const oldPolicy = JSON.parse(fs.readFileSync(path.join(root, '../validation-e704d5b/abi/UniversalRulesPolicy.json'), 'utf8'));
const probe = JSON.parse(fs.readFileSync(path.join(root, 'donut-probe.json'), 'utf8'));
const results = [];

async function main() {
  const header = v.parseAbiParameters('uint16,string,bytes');
  const oldEnvelope = v.encodeAbiParameters(v.parseAbiParameters('string,bytes'), ['eip155:42101', '0x']);
  assert.equal(BigInt(oldEnvelope.slice(0, 66)), 64n);
  const newEnvelope = v.encodeAbiParameters(header, [1, 'eip155:42101', '0x']);
  assert.deepEqual(v.decodeAbiParameters(header, newEnvelope), [1, 'eip155:42101', '0x']);
  results.push({check: 'Old SDK envelope starts with 64; v4 requires version 1. Native grants also need migration.', pass: true});

  const terms = v.parseAbiParameters('(uint48,address,(address,uint256,uint256)[],uint256,(address,bytes4,uint16,bool,uint256)[])');
  const value = [2000000000, probe.code.walletImplementation.address,
    [[probe.code.policy.address, 5n, v.maxUint256], [probe.code.factory.address, 0n, 0n]],
    1n, [[probe.code.walletImplementation.address, '0x12345678', 68, true, 0n]]];
  const encoded = v.encodeAbiParameters(terms, [value]);
  assert.deepEqual(v.decodeAbiParameters(terms, encoded)[0], value);
  results.push({check: 'Owner-guide UniversalTerms tuple round-trips two ordered caps; maxUint256 and zero remain distinct.', pass: true,
    note: 'Synthetic codec values only; the addresses used as dummy tokens/CEA/target are not a valid grant or chain-valid token fixture.'});

  const snapshot = v.createPublicClient({transport: v.http(probe.rpc)});
  const data = v.encodeFunctionData({abi: policy, functionName: 'getConfig', args: [v.zeroHash, probe.code.walletImplementation.address]});
  const raw = await snapshot.call({to: probe.code.policy.address, data, blockNumber: BigInt(probe.block)});
  const cfg = v.decodeFunctionResult({abi: policy, functionName: 'getConfig', data: raw.data});
  assert.equal(cfg.initialized, false);
  assert.deepEqual(cfg.assets, []);
  let oldDecoderRejected = false;
  try { v.decodeFunctionResult({abi: oldPolicy, functionName: 'getConfig', data: raw.data}); }
  catch { oldDecoderRejected = true; }
  assert.equal(oldDecoderRejected, true);
  results.push({check: 'Verified v4 ABI decodes a live empty getConfig; e704d5b ABI rejects the same result.', pass: true,
    block: probe.block, returndata: raw.data});

  const assertion = v.encodeFunctionData({abi: policy, functionName: 'assertSpent', args: [v.zeroHash, probe.code.walletImplementation.address, []]});
  const decoded = v.decodeFunctionData({abi: policy, data: assertion});
  assert.equal(decoded.functionName, 'assertSpent');
  assert.deepEqual(decoded.args[2], []);
  results.push({check: 'New array-form assertSpent encodes/decodes using explorer-verified ABI.', pass: true, selector: assertion.slice(0, 10)});

  fs.writeFileSync(path.join(root, 'wire-checks.json'), JSON.stringify({run_at: new Date().toISOString(), checks: results,
    limits: 'Envelope/ABI compatibility and synthetic wire round-trip only. No rule grant, spend-race execution, SDK full-suite rerun or live funded E2E.'}, null, 2) + '\n');
  console.log(JSON.stringify(results.map(({returndata, ...x}) => x), null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
