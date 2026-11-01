/** Bounded, opt-in test runner. Never prints/copies environment credentials. */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '../../../..');
const env = { ...process.env, ...dotenv.parse(fs.readFileSync(path.join(root, 'packages/core/.env'))) };
const secrets = [...new Set(Object.entries(env)
  .filter(([name, value]) => /KEY|SECRET|TOKEN|PASSWORD/.test(name) && value && value.length >= 6)
  .flatMap(([, value]) => [value, ...(value.startsWith('0x') ? [value.slice(2)] : [])]))]
  .sort((a, b) => b.length - a.length);
const redact = (text) => secrets.reduce((result, secret) => result.split(secret).join('[REDACTED]'), text);
const group = process.argv[2] ?? 'agw-svm-wire';
const name = process.argv[3] ?? `${group}.log`;
if (!['agw-svm-wire', 'agw-extended'].includes(group)) throw new Error('Unsupported funded AGW test group');
if (!/^[a-z0-9-]+\.log$/.test(name)) throw new Error('Use a simple log filename');
const child = spawn(process.execPath, ['../../node_modules/ts-node/dist/bin.js', '--transpile-only',
  '__e2e__/ci/run.ts', '--group', group], {
  cwd: path.join(root, 'packages/core'), env, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (data) => { log += data.toString(); });
child.stderr.on('data', (data) => { log += data.toString(); });
child.on('error', (error) => console.error(redact(error.message)));
child.on('exit', (code) => {
  const clean = redact(log);
  fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'logs', name), clean);
  console.log(clean.slice(-12000));
  console.log(`Sanitized wire test log saved; exit=${code}`);
  process.exitCode = code || 0;
});
console.log('Starting bounded live wire suite; output is buffered and redacted.');
