/** Compare SDK playground fixtures with the website MDX. No network or transactions. */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const page = process.argv[2] ?? path.resolve(root, '../push-chain-website/docs/chain/03-build/13a-Universal-Read.mdx');
const source = fs.readFileSync(page, 'utf8');
const matches = [...source.matchAll(/\{`([\s\S]*?)`\}/g)];
assert.equal(matches.length, 3, 'Expected three documented Universal Read playgrounds');
for (const match of matches) {
  assert.ok(!match[1].includes('$' + '{'), 'Unexpected template interpolation');
  const code = vm.runInNewContext('`' + match[1] + '`').trim();
  const slug = code.match(/customPropGTagEvent=(\S+)/)?.[1];
  assert.ok(/^universal_read_(registry|batch|resume)$/.test(slug), 'Unknown playground slug');
  const fixture = path.join(root, 'packages/core/__e2e__/docs-examples/13-read-state/fixtures', slug + '.js');
  assert.equal(fs.readFileSync(fixture, 'utf8').trim(), code, 'Website/SDK example drift: ' + slug);
  console.log('MATCH:', slug);
}
