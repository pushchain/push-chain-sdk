/** Typecheck public AGW guide blocks; never evaluate examples or load keys. */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '../../..');
const guide = path.join(root, 'packages/core/AGW.md');
const blocks = [
  ...fs.readFileSync(guide, 'utf8').matchAll(/```ts\n([\s\S]*?)```/g),
].map((m) => m[1]);
if (!blocks.length) throw new Error('No AGW TypeScript examples found');
const cache = path.join(root, 'node_modules/.cache');
fs.mkdirSync(cache, { recursive: true });
const dir = fs.mkdtempSync(path.join(cache, 'agw-docs-'));
try {
  const source = path.join(dir, 'examples.ts');
  fs.writeFileSync(source, blocks.join('\n\n'));
  const configPath = path.join(root, 'packages/core/tsconfig.lib.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, '\n')
    );
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(configPath)
  );
  const program = ts.createProgram([source], {
    ...parsed.options,
    noEmit: true,
  });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) {
    process.stderr.write(
      ts.formatDiagnostics(diagnostics, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n',
      })
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `AGW guide: ${blocks.length} TypeScript blocks typechecked against public exports; no examples executed.\n`
    );
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
