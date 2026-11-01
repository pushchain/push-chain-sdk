// Compares the pinned build to live code using the block from probe-live.cjs.
const fs = require('node:fs');
const path = require('node:path');
const { createPublicClient, http, keccak256 } = require('viem');
const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'research/2026-10-20');
const workspace = fs.readFileSync(path.join(EVIDENCE, 'review-workspace.txt'), 'utf8').trim();
const live = JSON.parse(fs.readFileSync(path.join(EVIDENCE, 'live-deployment.json'), 'utf8'));
const names = { marketplace: 'UniversalMarketplace', kernel: 'AgenticCommerce', hook: 'RulesBindingHook', rules: 'UniversalMarketplaceRules', builder: 'JobSpecBuilder' };
function stripMetadata(code) {
  const bytes = (code.length - 2) / 2;
  const length = Number.parseInt(code.slice(-4), 16);
  if (length > 0 && length + 2 < bytes) return code.slice(0, -(length + 2) * 2);
  return code;
}
async function main() {
  const client = createPublicClient({ transport: http(live.rpc) });
  const results = [];
  for (const [key, name] of Object.entries(names)) {
    const folder = path.join(workspace, 'out', `${name}.sol`);
    const candidates = fs.readdirSync(folder).filter(file => file.startsWith(name + '.') && file.endsWith('.json'));
    const comparisons = [];
    for (const file of candidates) {
    const artifact = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
    const address = live.components[key].implementation || live.addresses[key];
    let expected = artifact.deployedBytecode.object;
    for (const refs of Object.values(artifact.deployedBytecode.linkReferences || {})) {
      for (const entries of Object.values(refs)) {
        for (const ref of entries) {
          const start = 2 + ref.start * 2;
          expected = expected.slice(0, start) + live.addresses.builder.slice(2) + expected.slice(start + ref.length * 2);
        }
      }
    }
    const actual = await client.getCode({ address, blockNumber: BigInt(live.blockNumber) });
    // Solidity's deployed library runtime substitutes its own address for PUSH20 0.
    let selfAddressNormalized = false;
    if (key === 'builder' && expected.startsWith('0x730000000000000000000000000000000000000000')) {
      expected = '0x73' + address.slice(2) + expected.slice(44);
      selfAddressNormalized = true;
    }
    const a = stripMetadata(actual).toLowerCase();
    const e = stripMetadata(expected).toLowerCase();
    comparisons.push({ artifact: file, component: key, address, optimizerRuns: artifact.metadata.settings.optimizer.runs, sourceBytes: (expected.length - 2) / 2, liveBytes: (actual.length - 2) / 2, exactMatch: actual.toLowerCase() === expected.toLowerCase(), executableMatchExcludingMetadata: a === e, builderLinkResolved: key === 'marketplace', librarySelfAddressNormalized: selfAddressNormalized, executableHash: keccak256(a), expectedExecutableHash: keccak256(e) });
    }
    const selected = comparisons.find(item => item.executableMatchExcludingMetadata) || comparisons[0];
    results.push({ ...selected, candidateProfiles: comparisons.map(({artifact, optimizerRuns, sourceBytes, executableMatchExcludingMetadata}) => ({artifact, optimizerRuns, sourceBytes, executableMatchExcludingMetadata})) });
  }
  fs.writeFileSync(path.join(EVIDENCE, 'runtime-comparison.json'), JSON.stringify({ blockNumber: live.blockNumber, sourceCommit: '443b4e2dd9ca5dd9ffc8efebdfcecd619dd66c47', results }, null, 2) + '\n');
  console.log(JSON.stringify(results.map(({ component, sourceBytes, liveBytes, exactMatch, executableMatchExcludingMetadata }) => ({ component, sourceBytes, liveBytes, exactMatch, executableMatchExcludingMetadata })), null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
