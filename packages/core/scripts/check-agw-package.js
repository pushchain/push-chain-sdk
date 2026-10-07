/** Consume built JS/declarations, not tsconfig's source alias. No wallet operations. */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const built = path.join(root, 'dist/packages/core');
async function main() {
  const entry = path.join(built, 'src/index.js');
  const cjs = require(entry),
    esm = await import(pathToFileURL(entry).href);
  assert.equal(typeof cjs.PushChain.initialize, 'function');
  assert.equal(esm.PushChain, cjs.PushChain);
  assert.equal(
    cjs.PushChain.CONSTANTS.AGENTIC.TESTNET_DONUT.ENVELOPE_VERSION,
    1
  );
  assert.equal(typeof cjs.AgenticError, 'function');
  const [pack] = JSON.parse(
    execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: built,
      encoding: 'utf8',
    })
  );
  assert(pack.files.some((f) => f.path === 'AGW.md'));
  assert(!pack.files.some((f) => /(^|\/)\.env($|\.)/.test(f.path)));
  const guide = fs.readFileSync(path.join(built, 'AGW.md'), 'utf8');
  const source = [...guide.matchAll(/```ts\n([\s\S]*?)```/g)]
    .map((m) => m[1])
    .join('\n\n');
  const tmp = fs.mkdtempSync(
    path.join(root, 'node_modules/.cache/agw-consumer-')
  );
  try {
    const file = path.join(tmp, 'consumer.ts');
    fs.writeFileSync(file, source);
    const config = ts.readConfigFile(
      path.join(root, 'packages/core/tsconfig.lib.json'),
      ts.sys.readFile
    );
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      path.join(root, 'packages/core')
    );
    const options = {
      ...parsed.options,
      noEmit: true,
      paths: { '@pushchain/core': [path.join(built, 'src/index.d.ts')] },
    };
    const diagnostics = ts.getPreEmitDiagnostics(
      ts.createProgram([file], options)
    );
    if (diagnostics.length)
      throw new Error(
        ts.formatDiagnostics(diagnostics, {
          getCanonicalFileName: (f) => f,
          getCurrentDirectory: () => root,
          getNewLine: () => '\n',
        })
      );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.stdout.write(
    'AGW package: CJS/ESM imports, compiled declaration examples and npm contents pass. No examples executed/published.\n'
  );
}
main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
