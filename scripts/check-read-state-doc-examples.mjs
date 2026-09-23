/**
 * Compare the SDK playground fixtures with the website Universal Read pages. No network or
 * transactions. Every fixture must match a `customPropGTagEvent=<slug>` playground exactly
 * (after the MDX indentation is removed).
 *
 *   node scripts/check-read-state-doc-examples.mjs            check
 *   node scripts/check-read-state-doc-examples.mjs --write    re-copy the fixtures from the docs
 *   node scripts/check-read-state-doc-examples.mjs <dir>      use another universal-reads folder
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const write = args.includes('--write');
const docsDir = args.find((a) => !a.startsWith('--'))
  ?? path.resolve(root, '../push-chain-website/docs/chain/03-build/04-universal-reads');
const fixturesDir = path.join(root, 'packages/core/__e2e__/docs-examples/13-read-state/fixtures');
const FIXTURES = ['universal_read_evm_balance', 'universal_read_batch', 'universal_read_resume'];

/** Playground code as it runs: the template literal's value, `// customProp…` markers kept, the code dedented. */
function normalize(literal) {
  assert.ok(!literal.includes('$' + '{'), 'Unexpected template interpolation');
  const lines = vm.runInNewContext('`' + literal + '`').trim().split('\n');
  const markers = [];
  while (lines.length && /^\/\/ customProp/.test(lines[0])) markers.push(lines.shift());
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return [...markers, ...lines.map((l) => l.slice(indent))].join('\n').trim() + '\n';
}

const playgrounds = new Map();
for (const file of fs.readdirSync(docsDir).filter((f) => f.endsWith('.mdx'))) {
  const source = fs.readFileSync(path.join(docsDir, file), 'utf8');
  for (const match of source.matchAll(/\{`([\s\S]*?)`\}/g)) {
    const slug = match[1].match(/customPropGTagEvent=(\S+)/)?.[1];
    if (slug) playgrounds.set(slug, { file, code: normalize(match[1]) });
  }
}

let drift = 0;
for (const slug of FIXTURES) {
  const doc = playgrounds.get(slug);
  assert.ok(doc, `No docs playground for fixture ${slug} in ${docsDir}`);
  const fixture = path.join(fixturesDir, slug + '.js');
  if (write) {
    fs.writeFileSync(fixture, doc.code);
    console.log('WROTE:', slug, '←', doc.file);
  } else if (!fs.existsSync(fixture) || fs.readFileSync(fixture, 'utf8') !== doc.code) {
    drift++;
    console.log('DRIFT:', slug, '←', doc.file);
  } else {
    console.log('MATCH:', slug, '←', doc.file);
  }
}
if (drift) {
  console.error(`${drift} fixture(s) differ from the docs; run with --write, then update playgrounds.spec.ts assertions.`);
  process.exit(1);
}
