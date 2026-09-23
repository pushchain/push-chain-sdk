/**
 * PDA derivation for `read(programId, { idl, functionName, args })`.
 *
 * The seed layout comes from the IDL, never from a guessed encoding: Anchor
 * records each PDA's seeds on the instruction accounts that use it. `args` fill
 * the non-constant seeds in order, encoded as the IDL declares them.
 */
import type { Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { toSvmHexAddress } from '../orchestrator/svm-idl/normalize-address';
import { InvalidReadQueryError } from './errors';
import { idlNameKey } from './svm-account';

type IdlInstruction = Idl['instructions'][number];
type IdlSeed =
  | { kind: 'const'; value: number[] }
  | { kind: 'arg'; path: string }
  | { kind: 'account'; path: string; account?: string };
interface IdlPda { seeds: IdlSeed[]; program?: IdlSeed }

interface SeedTemplate { pda: IdlPda; instruction: IdlInstruction }

/** Every instruction account named like `name` that carries PDA seeds. */
function findSeedTemplates(idl: Idl, name: string): SeedTemplate[] {
  const key = idlNameKey(name);
  const out: SeedTemplate[] = [];
  const visit = (instruction: IdlInstruction, accounts: readonly unknown[]) => {
    for (const a of accounts as { name: string; pda?: IdlPda; accounts?: unknown[] }[]) {
      if (a.accounts) visit(instruction, a.accounts); // composite account groups
      else if (a.pda && idlNameKey(a.name) === key) out.push({ pda: a.pda, instruction });
    }
  };
  for (const ix of idl.instructions ?? []) visit(ix, ix.accounts);
  return out;
}

function toPublicKey(value: unknown, what: string): PublicKey {
  if (value instanceof PublicKey) return value;
  try {
    return new PublicKey(Buffer.from(toSvmHexAddress(value).slice(2), 'hex'));
  } catch (e) {
    throw new InvalidReadQueryError(`${what} must be a Solana pubkey (base58, 0x 32-byte hex, or PublicKey): ${(e as Error).message}`);
  }
}

const INT_WIDTH: Record<string, [bytes: number, signed: boolean]> = {
  u8: [1, false], i8: [1, true], u16: [2, false], i16: [2, true], u32: [4, false], i32: [4, true],
  u64: [8, false], i64: [8, true], u128: [16, false], i128: [16, true],
};

function encodeInt(value: unknown, type: string, what: string): Buffer {
  const [bytes, signed] = INT_WIDTH[type];
  let n: bigint;
  try {
    n = typeof value === 'bigint' ? value : BigInt(value as string | number);
  } catch {
    throw new InvalidReadQueryError(`${what} must be an integer for ${type}`);
  }
  const bits = BigInt(bytes * 8);
  const min = signed ? -(1n << (bits - 1n)) : 0n;
  const max = signed ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n;
  if (n < min || n > max) throw new InvalidReadQueryError(`${what} out of ${type} range: ${n}`);
  let u = n < 0n ? (1n << bits) + n : n;
  const out = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) { out[i] = Number(u & 0xffn); u >>= 8n; }
  return out;
}

function encodeSeed(value: unknown, type: unknown, what: string): Buffer {
  if (type === 'pubkey') return toPublicKey(value, what).toBuffer();
  if (typeof type === 'string' && type in INT_WIDTH) return encodeInt(value, type, what);
  if (type === 'bool') {
    if (typeof value !== 'boolean') throw new InvalidReadQueryError(`${what} must be a boolean`);
    return Buffer.from([value ? 1 : 0]);
  }
  if (type === 'string') {
    if (typeof value !== 'string') throw new InvalidReadQueryError(`${what} must be a string`);
    return Buffer.from(value, 'utf8');
  }
  const isBytes = type === 'bytes' || (typeof type === 'object' && type !== null && 'array' in type && (type as { array: unknown[] }).array[0] === 'u8');
  if (isBytes) {
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (typeof value === 'string' && /^0x([0-9a-fA-F]{2})*$/.test(value)) return Buffer.from(value.slice(2), 'hex');
    throw new InvalidReadQueryError(`${what} must be bytes (Uint8Array or 0x-hex)`);
  }
  throw new InvalidReadQueryError(`${what}: seed type ${JSON.stringify(type)} is not supported`);
}

function argType(ix: IdlInstruction, path: string): unknown {
  if (path.includes('.')) throw new InvalidReadQueryError(`seed arg path ${path} reads a struct field; only top-level instruction args are supported`);
  const arg = ix.args.find(a => a.name === path) ?? ix.args.find(a => idlNameKey(a.name) === idlNameKey(path));
  if (!arg) throw new InvalidReadQueryError(`seed arg ${path} is not an argument of ${ix.name}`);
  return arg.type;
}

function describeSeeds(t: SeedTemplate): string {
  return t.pda.seeds.map(s => (s.kind === 'const' ? `"${Buffer.from(s.value).toString('utf8')}"` : `${s.kind}:${s.path}`)).join(', ');
}

/** Same seeds, same order: two instructions describing one PDA agree. */
function sameLayout(a: SeedTemplate, b: SeedTemplate): boolean {
  return JSON.stringify([a.pda.seeds, a.pda.program]) === JSON.stringify([b.pda.seeds, b.pda.program]);
}

/** Derive the PDA of account layout `functionName` from its IDL seed template and positional `args`. */
export function deriveIdlPda(idl: Idl, functionName: string, args: readonly unknown[] = []): PublicKey {
  const templates = findSeedTemplates(idl, functionName);
  if (templates.length === 0) {
    throw new InvalidReadQueryError(`the IDL has no PDA seeds for ${functionName}; pass the account address as the subject instead of the program id`);
  }
  const [template] = templates;
  if (templates.some(t => !sameLayout(t, template))) {
    throw new InvalidReadQueryError(`the IDL describes ${functionName} with different seeds in different instructions; pass the account address as the subject`);
  }
  const dynamic = template.pda.seeds.filter(s => s.kind !== 'const');
  if (args.length !== dynamic.length) {
    throw new InvalidReadQueryError(`${functionName} is derived from seeds [${describeSeeds(template)}]: expected ${dynamic.length} args, got ${args.length}`);
  }
  let i = 0;
  const seeds = template.pda.seeds.map((seed) => {
    if (seed.kind === 'const') return Buffer.from(seed.value);
    const what = `args[${i}] (${seed.kind}:${seed.path})`;
    const value = args[i++];
    if (seed.kind === 'account') {
      if (seed.path.includes('.')) throw new InvalidReadQueryError(`seed ${seed.path} reads another account's field; pass the account address as the subject`);
      return encodeSeed(value, 'pubkey', what);
    }
    return encodeSeed(value, argType(template.instruction, seed.path), what);
  });
  let programId = new PublicKey(idl.address);
  const program = template.pda.program;
  if (program) {
    if (program.kind !== 'const') throw new InvalidReadQueryError(`${functionName} is derived under a non-constant program; pass the account address as the subject`);
    programId = new PublicKey(Buffer.from(program.value));
  }
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

/** Whether `subject` is the IDL's program id (base58 or 0x-hex). */
export function isProgramSubject(idl: Idl, subject: string): boolean {
  try {
    return toSvmHexAddress(subject) === toSvmHexAddress(idl.address);
  } catch {
    return false;
  }
}
