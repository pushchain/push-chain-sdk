import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve(__dirname, '../../e2e-logs');

let logStream: fs.WriteStream | null = null;
let originalConsole: {
  log: typeof console.log;
  warn: typeof console.warn;
  error: typeof console.error;
} | null = null;

function getLogFilePath(): string {
  return (
    process.env['E2E_LOG_FILE'] ||
    path.join(
      LOG_DIR,
      `e2e-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
    )
  );
}

function formatArg(a: unknown): string {
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(
      a,
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2
    );
  } catch {
    return String(a);
  }
}

function makeInterceptor(
  level: string,
  original: (...args: unknown[]) => void
) {
  return (...args: unknown[]) => {
    // Tee: still print to terminal
    original(...args);
    // Write to file
    const timestamp = new Date().toISOString();
    const message = args.map(formatArg).join(' ');
    logStream?.write(`[${timestamp}] [${level}] ${message}\n`);
  };
}

export function initFileLogger(): void {
  if (logStream) return; // Idempotent

  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  const logFile = getLogFilePath();
  logStream = fs.createWriteStream(logFile, { flags: 'a' });

  originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.log = makeInterceptor('LOG', originalConsole.log) as typeof console.log;
  console.warn = makeInterceptor('WARN', originalConsole.warn) as typeof console.warn;
  console.error = makeInterceptor('ERROR', originalConsole.error) as typeof console.error;
}

export function closeFileLogger(): void {
  if (originalConsole) {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    originalConsole = null;
  }
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}
