import { initFileLogger, closeFileLogger } from './logger';

initFileLogger();

process.on('beforeExit', () => closeFileLogger());
