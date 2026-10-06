/** Public export/type comparison. Report changes; do not approve pending API choices. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const baseline = 'b1597b91a25dbf7f691f589b4e1e154add604315';
const config = ts.readConfigFile(
  path.join(root, 'packages/core/tsconfig.lib.json'),
  ts.sys.readFile
);
const options = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  path.join(root, 'packages/core')
).options;
const selected = [
  'AgenticNamespace',
  'AgenticWallet',
  'AgenticError',
  'AgenticRevertError',
  'AGENTIC_ERROR_CODE',
  'NativeRule',
  'ArgPin',
  'AmountLimit',
  'AssetCap',
  'AllowedCall',
  'UniversalRule',
  'RulesRecord',
  'CreateOptions',
  'CreateResult',
  'AgenticTxMetadata',
];
function snapshot(entry) {
  const program = ts.createProgram([entry], { ...options, noEmit: true });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length)
    throw new Error(
      ts.formatDiagnostics(diagnostics, {
        getCanonicalFileName: (f) => f,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n',
      })
    );
  const checker = program.getTypeChecker(),
    file = program.getSourceFile(entry);
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(file));
  const normal = (s) =>
    s.replace(
      /import\("([^"]+)"\)/g,
      (_, p) =>
        `import("${
          p.includes('/src/') ? 'sdk/src/' + p.split('/src/').pop() : p
        }")`
    );
  const text = (t, node) =>
    normal(checker.typeToString(t, node, ts.TypeFormatFlags.NoTruncation));
  function properties(t) {
    return Object.fromEntries(
      checker
        .getPropertiesOfType(t)
        .filter((p) => {
          const d = p.valueDeclaration || p.declarations?.[0];
          return (
            !d ||
            !(
              ts.getCombinedModifierFlags(d) &
              (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)
            )
          );
        })
        .map((p) => [
          p.name,
          {
            optional: Boolean(p.flags & ts.SymbolFlags.Optional),
            type: text(checker.getTypeOfSymbolAtLocation(p, file), file),
          },
        ])
        .sort(([a], [b]) => a.localeCompare(b))
    );
  }
  const result = { exports: exports.map((s) => s.name).sort(), agw: {} };
  for (const name of selected) {
    let s = exports.find((s) => s.name === name);
    if (!s) continue;
    if (s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
    const t =
      s.flags &
      (ts.SymbolFlags.Interface |
        ts.SymbolFlags.TypeAlias |
        ts.SymbolFlags.Class)
        ? checker.getDeclaredTypeOfSymbol(s)
        : checker.getTypeOfSymbolAtLocation(s, file);
    result.agw[name] = { type: text(t, file), members: properties(t) };
  }
  let push = exports.find((s) => s.name === 'PushChain');
  if (push.flags & ts.SymbolFlags.Alias) push = checker.getAliasedSymbol(push);
  const staticType = checker.getTypeOfSymbolAtLocation(push, file);
  const init = staticType.getProperty('initialize');
  result.initialize = text(checker.getTypeOfSymbolAtLocation(init, file), file);
  const constants = staticType.getProperty('CONSTANTS');
  const cType = checker.getTypeOfSymbolAtLocation(constants, file),
    agw = cType.getProperty('AGENTIC');
  const aType = checker.getTypeOfSymbolAtLocation(agw, file);
  const donut = aType.getProperty('TESTNET_DONUT');
  result.agwConstants = properties(
    checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(donut, file))
  );
  return result;
}
const current = snapshot(path.join(root, 'packages/core/src/index.ts'));
const built = snapshot(path.join(root, 'dist/packages/core/src/index.d.ts'));
assert.deepEqual(
  built,
  current,
  'compiled public API differs from source public API'
);
try {
  execFileSync('git', ['cat-file', '-e', `${baseline}^{commit}`], {
    cwd: root,
    stdio: 'ignore',
  });
} catch {
  execFileSync(
    'git',
    [
      'fetch',
      '--depth=1',
      'https://github.com/pushchain/push-chain-sdk.git',
      baseline,
    ],
    { cwd: root, stdio: 'ignore' }
  );
}
const temp = fs.mkdtempSync(path.join(root, 'node_modules/.cache/agw-api-'));
try {
  const archive = execFileSync(
    'git',
    ['archive', baseline, 'packages/core/src'],
    { cwd: root, maxBuffer: 30 * 1024 * 1024 }
  );
  execFileSync('tar', ['-x', '-C', temp], { input: archive });
  const old = snapshot(path.join(temp, 'packages/core/src/index.ts'));
  const changes = [];
  for (const name of selected)
    if (JSON.stringify(old.agw[name]) !== JSON.stringify(current.agw[name]))
      changes.push(name);
  const report = {
    baseline,
    head: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    compiledMatchesSource: true,
    initializeSignatureChanged: old.initialize !== current.initialize,
    addedExports: current.exports.filter((s) => !old.exports.includes(s)),
    removedExports: old.exports.filter((s) => !current.exports.includes(s)),
    changedAgwTypes: changes,
    agwConstantsChanged:
      JSON.stringify(old.agwConstants) !== JSON.stringify(current.agwConstants),
    before: old,
    after: current,
    scope:
      'Root exports, AGW types, initialize and agentic constants. Behavioral/default/deployment changes need the written session review.',
  };
  const at = process.argv.indexOf('--output');
  if (at >= 0)
    fs.writeFileSync(
      path.resolve(process.argv[at + 1]),
      JSON.stringify(report, null, 2) + '\n'
    );
  process.stdout.write(
    JSON.stringify({
      compiledMatchesSource: true,
      addedExports: report.addedExports,
      removedExports: report.removedExports,
      changedAgwTypes: changes,
      initializeSignatureChanged: report.initializeSignatureChanged,
      agwConstantsChanged: report.agwConstantsChanged,
    }) + '\n'
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
