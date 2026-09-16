/** Offline compatibility gate. Pins are reviewed contract/node snapshots, not live-chain checks. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const core = path.join(root, 'packages/core');
const tests = [
  'abi-selectors', 'read-events', 'ucallback-codec',
  'envelope-evm', 'envelope-svm', 'envelope-web2',
  'public-surface', 'read-types', 'registry',
].map(name => path.join(core, 'src/lib/read-state/__tests__', `${name}.spec.ts`));
const result = spawnSync(process.execPath, [
  path.join(root, 'node_modules/jest/bin/jest.js'),
  '--config', path.join(core, 'jest.config.ts'), '--runInBand', '--runTestsByPath', ...tests,
], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
