import fs from 'fs';
import path from 'path';
import semver from 'semver';

console.log(process.argv);
const [, , scope, bump] = process.argv;

if (!scope || !bump) {
  console.error(`❌ Usage: ts-node releasePackage.ts <scope> <bump>`);
  console.error(`   e.g. ts-node releasePackage.ts core minor`);
  process.exit(1);
}

const scopeToPackage = {
  core: '@pushchain/core',
  'ui-kit': '@pushchain/ui-kit',
} as const;

const scopeToFolder = {
  core: 'packages/core',
  'ui-kit': 'packages/ui-kit',
} as const;

type Scope = keyof typeof scopeToPackage;

const typedScope = scope as Scope;

if (!(scope in scopeToPackage)) {
  console.error(`❌ Unknown scope: ${scope}`);
  process.exit(1);
}

const pkgDir = scopeToFolder[typedScope];
const pkgPath = path.join(pkgDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

const currentVersion = pkg.version;
const newVersion = semver.inc(currentVersion, bump as semver.ReleaseType);

if (!newVersion) {
  console.error(`❌ Invalid bump type: ${bump}`);
  process.exit(1);
}

pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`📦 Updated ${pkg.name} to ${newVersion}`);

const changesetContent = `---
"${scopeToPackage[typedScope]}": ${bump}
---

Release ${newVersion}
`;

if (!fs.existsSync('.changeset')) fs.mkdirSync('.changeset');

const filename = `.changeset/${scope}-${newVersion}.md`;
fs.writeFileSync(filename, changesetContent);
console.log(`📝 Created changeset file: ${filename}`);
