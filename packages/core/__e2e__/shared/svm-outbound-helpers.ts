/**
 * Shared helpers and constants for SVM outbound E2E tests.
 *
 * Extracted from svm-outbound.spec.ts to eliminate duplication across
 * the split SVM outbound test files (uoa-to-cea, cea-to-uea, eoa-to-cea, cea-to-eoa).
 */
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { MOVEABLE_TOKEN_CONSTANTS } from '../../src/lib/constants/tokens';
import { PushChain } from '../../src';
import testCounterIdl from '../../src/lib/orchestrator/svm-idl/__fixtures__/test_counter.idl.json';

// ---------------------------------------------------------------------------
// SVM Constants
// ---------------------------------------------------------------------------

/** 32-byte Solana address (Gateway vault PDA on devnet — known existing account) */
export const TEST_SOL_TARGET =
  '0x6a44bb5ea802a001386a5b39708523e1a3e1bafc8164ffcb94d1f5afa4849c69' as `0x${string}`;

/** Zero address for Solana (32 bytes of zeros) */
export const SOL_ZERO_ADDRESS =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;

/** test_counter program deployed on Solana Devnet (8yNqjrMnFiFbVTVQcKij8tNWWTMdFkrDf9abCGgc2sgx) */
export const TEST_PROGRAM =
  '0x7673075a980bfd5d6b1dffe99c31f63e8938519cc1c2af009dda5e568a94460d' as `0x${string}`;

/** Counter PDA (seeds: ["counter"], program: TEST_PROGRAM) = 6Kg1NF5RRytjGwR6USttBLEYJrqwm65xtJzdPbbFwJKg */
export const COUNTER_PDA =
  '0x4f12fe6816ae7e33ebf7db0b154ec3b09e3bf1a7690481e8e9477d5a278ad3af' as `0x${string}`;

/** SVM Gateway program on devnet (for CEA PDA derivation) */
export const SVM_GATEWAY_PROGRAM = new PublicKey('CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS');

/** Solana Devnet USDT token — must use this (not Ethereum USDT) so getPRC20Address maps to USDT_SOL */
export const SOL_USDT_TOKEN = MOVEABLE_TOKEN_CONSTANTS.SOLANA_DEVNET.USDT;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives CEA PDA from an EVM address (UEA or EOA) for the SVM gateway program.
 * Seeds: ["push_identity", sender_evm_address_20_bytes], Program: SVM Gateway
 */
export function deriveCeaPda(evmAddress: `0x${string}`): {
  ceaPda: PublicKey;
  ceaPdaHex: `0x${string}`;
} {
  const senderBytes = Buffer.from(evmAddress.slice(2), 'hex'); // 20 bytes
  const [ceaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('push_identity'), senderBytes],
    SVM_GATEWAY_PROGRAM
  );
  const ceaPdaHex = ('0x' + Buffer.from(ceaPda.toBytes()).toString('hex')) as `0x${string}`;
  return { ceaPda, ceaPdaHex };
}

/**
 * Builds the standard accounts array for receive_sol CPI on the test_counter program.
 */
export function buildReceiveSolAccounts(ceaPdaHex: `0x${string}`) {
  return [
    { pubkey: COUNTER_PDA, isWritable: true },       // counter PDA
    { pubkey: TEST_SOL_TARGET, isWritable: true },    // recipient
    { pubkey: ceaPdaHex, isWritable: true },           // cea_authority (actual CEA PDA)
    { pubkey: SOL_ZERO_ADDRESS, isWritable: false },   // system_program (0x00...00)
  ];
}

/**
 * Builds receive_sol instruction data for the test_counter program.
 * Discriminator: [121, 244, 250, 3, 8, 229, 225, 1]
 * Args: amount (u64 LE)
 */
export function buildReceiveSolIxData(amount: bigint): Uint8Array {
  const discriminator = new Uint8Array([121, 244, 250, 3, 8, 229, 225, 1]);
  const amountBuf = new Uint8Array(8);
  new DataView(amountBuf.buffer).setBigUint64(0, amount, true); // LE
  return new Uint8Array([...discriminator, ...amountBuf]);
}

/** receive_sol instruction data as 0x-hex, ready to pass as `data` to prepareTransaction. */
export function buildReceiveSolCalldata(amount: bigint): `0x${string}` {
  return ('0x' +
    Buffer.from(buildReceiveSolIxData(amount)).toString('hex')) as `0x${string}`;
}

/** Convert a Uint8Array to a 0x-hex `data` string. */
export function toHexData(bytes: Uint8Array): `0x${string}` {
  return ('0x' + Buffer.from(bytes).toString('hex')) as `0x${string}`;
}

// Register the test_counter IDL so prepareTransaction can resolve accounts
// for any `data` calldata targeting TEST_PROGRAM. Importing this helper file
// anywhere in the e2e suite auto-registers it.
PushChain.utils.svm.registerIdl(TEST_PROGRAM, testCounterIdl);
