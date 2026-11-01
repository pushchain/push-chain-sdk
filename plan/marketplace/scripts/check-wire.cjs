// Research vectors only: contrasts deployed marketplace wire with the evaluator comment's source.
const fs = require('node:fs');
const path = require('node:path');
const { parseAbiParameters, encodeAbiParameters, decodeAbiParameters, keccak256 } = require('viem');
const oldType = parseAbiParameters('((string,string,uint16,address,bytes4,bytes,bytes,uint8[])[],(uint8,uint8,uint8,int256)[],(uint8,uint8[],uint8[],uint8)[],uint8,bytes32,uint64,uint64)');
const newType = parseAbiParameters('(uint64,uint64,(string,string,uint16,address,bytes4,bytes,bytes,uint8[],uint8)[],(uint8[],uint8[],uint8,uint8,int256)[],(uint8,uint8,uint8[],uint8)[],uint8,bytes32)');
const templateType = parseAbiParameters('((string,string,uint16,address,bytes4,bytes,(uint8,uint8,uint8)[],bytes,uint8[])[],(uint8,uint8,uint8,uint8,int256)[],(uint8,uint8[],uint8[],uint8)[],uint8,(int256,int256)[])');
const zeroHash = '0x' + '00'.repeat(32);
const read = ['eip155','11155111',12,'0x1111111111111111111111111111111111111111','0x70a08231','0x'+'00'.repeat(32),'0x080001010100',[0]];
const old = [[read],[[0,1,3,499_000_000n]],[[0,[0],[],0]],0,zeroHash,1_800_000_000n,1_800_007_200n];
// New evaluator NONE=1 and CHECK=0, ALL=1. These are different ordinal mappings.
const modern = [1_800_000_000n,1_800_007_200n,[[...read,0]],[[[0],[],1,3,499_000_000n]],[[0,0,[],0]],1,zeroHash];
const oldBytes = encodeAbiParameters(oldType,[old]);
const newBytes = encodeAbiParameters(newType,[modern]);
const template = [[[...read.slice(0,6),[],...read.slice(6)]],[[0,1,3,0,499_000_000n]],[[0,[0],[],0]],0,[]];
const templateBytes = encodeAbiParameters(templateType,[template]);
function attempt(bytes, schema) {
  try {
    const decoded = decodeAbiParameters(schema, bytes);
    return { decoded: true, canonicalRoundtrip: encodeAbiParameters(schema, decoded).toLowerCase() === bytes.toLowerCase() };
  } catch (error) { return { decoded: false, error: error.shortMessage || error.message }; }
}
const report = {
  marketplaceSource: '443b4e2dd9ca5dd9ffc8efebdfcecd619dd66c47',
  evaluatorSource: '8059817591cca16c59f1cc154f475f51e1736a67',
  schemaChanges: ['JobSpec top-level field order', 'Read.at appended', 'Check.read replaced by left/right arrays', 'Logic checks[] replaced by CHECK leaf structure', 'AllowedMutability.NONE ordinal 0 -> 1; BOTH 3 -> 0', 'Logic ALL ordinal 0 -> 1; ANY 1 -> 2; AT_LEAST 2 -> 3', 'MAX_READS 16 -> 32'],
  oldRoundtrip: attempt(oldBytes,oldType), newRoundtrip: attempt(newBytes,newType),
  oldDecodedAsNew: attempt(oldBytes,newType), newDecodedAsOld: attempt(newBytes,oldType),
  deployedJobDecodedAsTemplate: attempt(oldBytes,templateType), templateDecodedAsDeployedJob: attempt(templateBytes,oldType),
  old: { bytes: oldBytes, hash: keccak256(oldBytes) }, modern: { bytes: newBytes, hash: keccak256(newBytes) },
  template: { bytes: templateBytes, hash: keccak256(templateBytes) },
  scope: 'Controlled nonempty ABI vectors, not a proof that every malformed/cross-profile payload is rejected. No evaluator deployment or settlement is tested.'
};
const out = path.resolve(__dirname,'../research/2026-10-20/wire-comparison.json');
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).filter(([key])=>!['old','modern','template'].includes(key))),null,2));
if (!report.oldRoundtrip.canonicalRoundtrip || !report.newRoundtrip.canonicalRoundtrip) process.exitCode=1;
