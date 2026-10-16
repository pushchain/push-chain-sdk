/** Local runtime matrix only. Never dispatch GitHub CI, fund E2Es or publish. */
const fs = require('node:fs'),
  path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const argument = (name) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};
const binaries = [
  { major: 20, node: argument('--node20') || process.execPath },
  { major: 24, node: argument('--node24') },
];
if (!binaries[1].node)
  throw new Error(
    'Provide --node24 <Node 24 binary>; --node20 defaults to the current executable.'
  );
const output = path.resolve(
  argument('--output') || path.join(root, '.agw-runtime-validation')
);
fs.mkdirSync(output, { recursive: true });
const results = [];
function command(dir, node, args, env, name) {
  const result = spawnSync(node, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024,
  });
  fs.writeFileSync(
    path.join(dir, name + '.log'),
    String(result.stdout || '') + String(result.stderr || '')
  );
  if (result.error || result.status !== 0)
    throw new Error(`Node ${node} failed ${name}; see ${dir}/${name}.log`);
  return result.stdout;
}
for (const runtime of binaries) {
  const dir = path.join(output, 'node' + runtime.major);
  fs.mkdirSync(dir, { recursive: true });
  const env = {
    ...process.env,
    PATH: path.dirname(runtime.node) + path.delimiter + process.env.PATH,
  };
  const version = command(
    dir,
    runtime.node,
    [
      '-p',
      'JSON.stringify({version:process.version,major:Number(process.versions.node.split(".")[0]),platform:process.platform,arch:process.arch})',
    ],
    env,
    'version'
  );
  const actual = JSON.parse(version);
  if (actual.major !== runtime.major)
    throw new Error(`Expected Node ${runtime.major}, got ${actual.version}`);
  process.stdout.write(`AGW runtime matrix: ${actual.version}\n`);
  command(
    dir,
    runtime.node,
    [
      'node_modules/jest/bin/jest.js',
      '--config',
      'packages/core/jest.config.ts',
      '--runInBand',
    ],
    env,
    'full-unit'
  );
  command(
    dir,
    runtime.node,
    ['packages/core/scripts/agw-verify.js'],
    env,
    'verification'
  );
  for (const file of fs.readdirSync(path.join(root, '.agw-validation'))) {
    const source = path.join(root, '.agw-validation', file);
    if (fs.statSync(source).isFile())
      fs.copyFileSync(source, path.join(dir, file));
  }
  results.push({ ...actual, passed: true });
}
fs.writeFileSync(
  path.join(output, 'results.json'),
  JSON.stringify(
    { results, hostedCi: false, published: false, fundedE2Es: false },
    null,
    2
  ) + '\n'
);
process.stdout.write('Both runtime matrix entries passed.\n');
