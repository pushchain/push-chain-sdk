/** One unfunded verification entry point. No .env loading, live E2E or publishing. */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const dir = path.join(root, '.agw-validation');
fs.mkdirSync(dir, { recursive: true });
function run(name, file, args, options = {}) {
  process.stdout.write(`AGW validation: ${name}\n`);
  const result = spawnSync(file, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  const out = String(result.stdout || '') + String(result.stderr || '');
  fs.writeFileSync(path.join(dir, `${name}.log`), out);
  if (result.error || result.status !== 0) {
    throw new Error(
      `AGW validation failed: ${name}; see .agw-validation/${name}.log`
    );
  }
  return out;
}
const node = process.execPath;
run('units', node, [
  'node_modules/jest/bin/jest.js',
  '--config',
  'packages/core/jest.config.ts',
  '--runInBand',
  '--testPathPattern=agentic|outbound-(confirmation-gate|svm-confirmation)|svm-idl|evm-client.batch-gas',
]);
for (const kind of ['lib', 'spec', 'agw-local'])
  run(`types-${kind}`, node, [
    'node_modules/typescript/bin/tsc',
    '-p',
    `packages/core/tsconfig.${kind}.json`,
    '--noEmit',
  ]);
run('docs', node, ['packages/core/scripts/check-agw-docs.js']);
const env = {
  ...process.env,
  OUT: process.env.AGW_LOCAL_DIR || path.join(dir, 'contracts'),
};
run(
  'prepare-contracts',
  'bash',
  ['packages/core/scripts/agw-local/prepare.sh'],
  { env }
);
run(
  'local-contracts',
  node,
  [
    'node_modules/jest/bin/jest.js',
    '--config',
    'packages/core/jest.agw-local.config.ts',
    '--runInBand',
  ],
  { env: { ...env, AGW_LOCAL_DIR: env.OUT } }
);
run(
  'build',
  node,
  ['node_modules/nx/bin/nx.js', 'run', 'core:build', '--skip-nx-cache'],
  { env: { ...process.env, NX_DAEMON: 'false' } }
);
run('package', node, ['packages/core/scripts/check-agw-package.js']);
run('public-api', node, [
  'packages/core/scripts/check-agw-api.js',
  '--output',
  path.join(dir, 'api-comparison.json'),
]);
process.stdout.write('AGW unfunded validation completed.\n');
