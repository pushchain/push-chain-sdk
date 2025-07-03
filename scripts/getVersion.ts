import fs from 'fs';
import path from 'path';

const [, , scope] = process.argv;

if (!scope) {
  console.error('❌ Usage: ts-node scripts/getVersion.ts <scope>');
  process.exit(1);
}

const pkgPath = path.join('packages', scope, 'package.json');

if (!fs.existsSync(pkgPath)) {
  console.error(`❌ Cannot find package.json for scope: ${scope}`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
console.log(pkg.version);
