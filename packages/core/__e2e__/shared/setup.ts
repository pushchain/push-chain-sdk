import dotenv from 'dotenv';
import path from 'path';

// Single dotenv load — all test files import this instead of calling dotenv.config()
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const ENV = {
  EVM_PRIVATE_KEY: process.env['EVM_PRIVATE_KEY'] as `0x${string}` | undefined,
  PUSH_PRIVATE_KEY: process.env['PUSH_PRIVATE_KEY'] as `0x${string}` | undefined,
  SOLANA_PRIVATE_KEY: process.env['SOLANA_PRIVATE_KEY'] as string | undefined,
  EVM_RPC: process.env['EVM_RPC'] as string | undefined,
  SOLANA_RPC_URL: process.env['SOLANA_RPC_URL'] as string | undefined,
} as const;

/** Conditional skip helper — returns true if the env var is NOT set */
export function shouldSkip(key: keyof typeof ENV): boolean {
  return !ENV[key];
}
