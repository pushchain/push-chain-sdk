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
  const literals = new Map(),
    ambiguous = new Set();
  for (const source of program
    .getSourceFiles()
    .filter((f) => f.fileName.includes('/packages/core/src/'))) {
    for (let symbol of checker.getSymbolsInScope(
      source,
      ts.SymbolFlags.Value
    )) {
      const name = symbol.name;
      if (symbol.flags & ts.SymbolFlags.Alias)
        symbol = checker.getAliasedSymbol(symbol);
      const type = checker.getTypeOfSymbolAtLocation(symbol, source);
      if (type.flags & ts.TypeFlags.EnumLiteral) continue;
      const literal = type.isStringLiteral()
        ? JSON.stringify(type.value)
        : type.isNumberLiteral()
        ? String(type.value)
        : undefined;
      if (literal === undefined) continue;
      if (literals.has(name) && literals.get(name) !== literal)
        ambiguous.add(name);
      else literals.set(name, literal);
    }
  }
  const printer = ts.createPrinter({ removeComments: true });
  const modules = new Map(
    program
      .getSourceFiles()
      .filter((f) => f.fileName.includes('/packages/core/src/'))
      .map((f) => [
        'sdk/src/' +
          f.fileName
            .split('/src/')
            .pop()
            .replace(/\.d\.ts$|\.tsx?$/, ''),
        f,
      ])
  );
  function reference(match, kind, module, name) {
    const source =
      modules.get(module) ||
      program.getSourceFile(module + '.d.ts') ||
      program.getSourceFile(module + '.ts');
    if (!source) return match;
    const moduleSymbol = checker.getSymbolAtLocation(source);
    let symbol = [
      ...(moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []),
      ...checker.getSymbolsInScope(
        source,
        ts.SymbolFlags.Type | ts.SymbolFlags.Value | ts.SymbolFlags.Namespace
      ),
    ].find((s) => s.name === name);
    if (!symbol) return match;
    if (symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    const decl = symbol.declarations?.[0];
    if (!decl) return match;
    if (!kind && symbol.flags & ts.SymbolFlags.TypeAlias) {
      const type = checker.getDeclaredTypeOfSymbol(symbol);
      if (
        type.flags &
        (ts.TypeFlags.StringLike |
          ts.TypeFlags.NumberLike |
          ts.TypeFlags.BooleanLike |
          ts.TypeFlags.BigIntLike |
          ts.TypeFlags.TemplateLiteral |
          ts.TypeFlags.Null |
          ts.TypeFlags.Undefined)
      )
        return normal(
          checker.typeToString(
            type,
            file,
            ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias
          )
        );
    }
    if (kind === 'typeof ') {
      const type = checker.getTypeOfSymbolAtLocation(symbol, decl);
      const calls = type.getCallSignatures();
      if (calls.length === 1)
        return normal(
          checker.signatureToString(
            calls[0],
            file,
            ts.TypeFormatFlags.NoTruncation |
              ts.TypeFormatFlags.WriteArrowStyleSignature
          )
        );
    }
    const location = decl.getSourceFile().fileName;
    if (!location.includes('/packages/core/src/')) return match;
    return `${kind || ''}import("sdk/src/${location
      .split('/src/')
      .pop()
      .replace(/\.d\.ts$|\.tsx?$/, '')}").${symbol.name}`;
  }
  function canonicalType(text) {
    for (let pass = 0; pass < 4; pass++)
      text = text.replace(
        /(typeof )?import\("([^"]+)"\)\.([A-Za-z_][\w]*)/g,
        reference
      );
    text = text.replace(
      /typeof import\("[^"]+"\)\.([A-Za-z_][\w]*)/g,
      (match, name) =>
        ambiguous.has(name) ? match : literals.get(name) || match
    );
    const parsed = ts.createSourceFile(
      'surface.ts',
      `type Surface = ${text};`,
      ts.ScriptTarget.Latest,
      true
    );
    const result = ts.transform(parsed, [
      (context) => {
        const visit = (node) => {
          node = ts.visitEachChild(node, visit, context);
          if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
            const types = [...node.types].sort((a, b) =>
              printer
                .printNode(ts.EmitHint.Unspecified, a, parsed)
                .localeCompare(
                  printer.printNode(ts.EmitHint.Unspecified, b, parsed)
                )
            );
            return ts.isUnionTypeNode(node)
              ? ts.factory.createUnionTypeNode(types)
              : ts.factory.createIntersectionTypeNode(types);
          }
          if (
            ts.isTypeLiteralNode(node) &&
            node.members.every(
              (m) => ts.isPropertySignature(m) || ts.isMethodSignature(m)
            )
          ) {
            return ts.factory.createTypeLiteralNode(
              [...node.members].sort((a, b) =>
                printer
                  .printNode(ts.EmitHint.Unspecified, a.name, parsed)
                  .localeCompare(
                    printer.printNode(ts.EmitHint.Unspecified, b.name, parsed)
                  )
              )
            );
          }
          return node;
        };
        return (source) => ts.visitNode(source, visit);
      },
    ]);
    try {
      return printer.printNode(
        ts.EmitHint.Unspecified,
        result.transformed[0].statements[0].type,
        parsed
      );
    } finally {
      result.dispose();
    }
  }
  const normal = (s) =>
    s.replace(
      /import\("([^"]+)"\)/g,
      (_, p) =>
        `import("${
          p.includes('/src/') ? 'sdk/src/' + p.split('/src/').pop() : p
        }")`
    );
  const text = (t, node) =>
    canonicalType(
      normal(
        checker.typeToString(
          t,
          node,
          ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias
        )
      )
    );
  function properties(t) {
    return Object.fromEntries(
      checker
        .getPropertiesOfType(t)
        .filter((p) => {
          const d = p.valueDeclaration || p.declarations?.[0];
          if (
            d &&
            /\/typescript\/lib\/lib\.[^/]+\.d\.ts$/.test(
              d.getSourceFile().fileName
            )
          )
            return false;
          return (
            !d ||
            !(
              ts.getCombinedModifierFlags(d) &
              (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)
            )
          );
        })
        .map((p) => [
          p.name.replace(/(__@[^@]+)@\d+$/, '$1'),
          {
            optional: Boolean(p.flags & ts.SymbolFlags.Optional),
            readonly: Boolean(
              ts.getCheckFlags(p) & ts.CheckFlags.Readonly ||
                p.declarations?.some(
                  (d) =>
                    ts.getCombinedModifierFlags(d) & ts.ModifierFlags.Readonly
                )
            ),
            type: text(checker.getTypeOfSymbolAtLocation(p, file), file),
          },
        ])
        .sort(([a], [b]) => a.localeCompare(b))
    );
  }
  const result = {
    exports: exports.map((s) => s.name).sort(),
    agw: {},
    publicSurface: {},
  };
  for (let s of exports) {
    const name = s.name;
    if (s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
    const t =
      s.flags &
      (ts.SymbolFlags.Interface |
        ts.SymbolFlags.TypeAlias |
        ts.SymbolFlags.Class)
        ? checker.getDeclaredTypeOfSymbol(s)
        : checker.getTypeOfSymbolAtLocation(s, file);
    result.publicSurface[name] = {
      type: text(t, file),
      members: properties(t),
    };
  }
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
  const instanceType = checker.getDeclaredTypeOfSymbol(push);
  result.pushChainStatic = properties(staticType);
  delete result.pushChainStatic.prototype;
  result.pushChainInstance = properties(instanceType);
  const universal = instanceType.getProperty('universal');
  result.transactionMethods = properties(
    checker.getTypeOfSymbolAtLocation(universal, file)
  );
  const utils = staticType.getProperty('utils');
  const utilsType = checker.getTypeOfSymbolAtLocation(utils, file);
  result.utilityMethods = properties(utilsType);
  delete result.utilityMethods.prototype;
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
  result.constants = properties(cType);
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
  const publicTypeChanges = Object.keys(current.publicSurface).filter(
    (name) =>
      JSON.stringify(old.publicSurface[name]) !==
      JSON.stringify(current.publicSurface[name])
  );
  const transactionMethodChanges = Object.keys(
    current.transactionMethods
  ).filter(
    (name) =>
      JSON.stringify(old.transactionMethods[name]) !==
      JSON.stringify(current.transactionMethods[name])
  );
  const instanceMethodChanges = Object.keys(current.pushChainInstance).filter(
    (name) =>
      JSON.stringify(old.pushChainInstance[name]) !==
      JSON.stringify(current.pushChainInstance[name])
  );
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
    publicTypeChanges,
    transactionMethodChanges,
    instanceMethodChanges,
    agwConstantsChanged:
      JSON.stringify(old.agwConstants) !== JSON.stringify(current.agwConstants),
    before: old,
    after: current,
    scope:
      'All root exports and declared public members, PushChain static/instance members, universal transaction methods, utility groups, readonly/optional markers and constants. Behavior/default/deployment changes need the written session review.',
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
      publicTypeChanges,
      transactionMethodChanges,
      instanceMethodChanges,
      initializeSignatureChanged: report.initializeSignatureChanged,
      agwConstantsChanged: report.agwConstantsChanged,
    }) + '\n'
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
