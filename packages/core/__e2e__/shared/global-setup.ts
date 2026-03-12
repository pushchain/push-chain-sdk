import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve(__dirname, '../../e2e-logs');

export default function globalSetup(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  const logFile = path.join(
    LOG_DIR,
    `e2e-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
  );

  // Set env var so workers + reporter share the same log file
  process.env['E2E_LOG_FILE'] = logFile;

  fs.writeFileSync(
    logFile,
    `E2E Log started at ${new Date().toISOString()}\n\n`
  );
}
