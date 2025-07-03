import fs from 'fs';
import path from 'path';
import semver from 'semver';
import { execSync } from 'child_process';

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

if (!(typedScope in scopeToPackage)) {
  console.error(`❌ Unknown scope: ${scope}`);
  process.exit(1);
}

// --- 1. Read & bump version ---
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

// --- 2. Collect commit messages for this scope ---
function getCommitsForScope(scope: string): string[] {
  const previousTag = execSync(
    `git describe --tags --match '${scope}@*' --abbrev=0`,
    {
      encoding: 'utf-8',
    }
  ).trim();

  const log = execSync(`git log --pretty=format:%s ${previousTag}..HEAD`, {
    encoding: 'utf-8',
  });

  return log
    .split('\n')
    .map((line) => line.trim())
    .filter((msg) => new RegExp(`^\\w+\\(${scope}\\):`).test(msg))
    .map((msg) => {
      const match = msg.match(/^(\w+)\([^)]+\):\s*(.+)$/);
      if (!match) return null;
      const [, type, subject] = match;
      return `- ${type}: ${subject}`;
    })
    .filter((v): v is string => !!v);
}

const scopedCommits = getCommitsForScope(scope);
if (scopedCommits.length === 0) {
  console.log('⚠️ No commits found for this scope. Skipping changelog update.');
  process.exit(0);
}

// --- 3. Prepend to single file: .changeset/core.md ---
const dateStr = new Date().toISOString().split('T')[0];
const header = `${scopeToPackage[typedScope]}@${newVersion} (${dateStr})`;
const body = scopedCommits.join('\n');
const fullEntry = `${header}\n\n${body}\n\n---\n\n`;

if (!fs.existsSync('.changeset')) fs.mkdirSync('.changeset');

const changelogPath = path.join('.changeset', `${scope}.md`);
let previousContent = '';
if (fs.existsSync(changelogPath)) {
  previousContent = fs.readFileSync(changelogPath, 'utf-8');
}

fs.writeFileSync(changelogPath, fullEntry + previousContent);
console.log(`📝 Prepended release to .changeset/${scope}.md`);
