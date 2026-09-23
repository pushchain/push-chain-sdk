import { BorshAccountsCoder, type Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { CHAIN_INFO } from '../constants/chain';
import type { CHAIN } from '../constants/enums';
import { Buffer } from 'buffer';
import { InvalidReadQueryError, ReadDecodeError } from './errors';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from './envelopes/svm';

/** snake_case, camelCase and PascalCase spellings of one name share a key. */
export function idlNameKey(name: string): string {
  return name.replace(/_/g, '').toLowerCase();
}

type IdlAccountDef = NonNullable<Idl['accounts']>[number];

/** Structural checks the coder does not make, so a bad IDL fails at prepare time. */
export function validateIdl(idl: Idl): void {
  try {
    if (!idl || typeof idl !== 'object') throw new Error('idl must be an Anchor IDL object');
    new PublicKey(idl.address);
    if (!idl.accounts?.length) throw new Error('the IDL declares no accounts');
    for (const a of idl.accounts) {
      const d = a.discriminator;
      if (!Array.isArray(d) || d.length === 0 || d.some(b => !Number.isInteger(b) || b < 0 || b > 255)) {
        throw new Error(`account ${a.name}: discriminator must be a non-empty byte array`);
      }
    }
    new BorshAccountsCoder(idl);
  } catch (error) {
    throw new InvalidReadQueryError(`invalid Solana account IDL: ${(error as Error).message}`);
  }
}

/** The IDL's own spelling of an account layout name given in any case style. */
export function resolveAccountName(idl: Idl, name: string): string {
  const accounts = idl.accounts ?? [];
  const exact = accounts.find(a => a.name === name);
  if (exact) return exact.name;
  const key = idlNameKey(name);
  const matches = accounts.filter(a => idlNameKey(a.name) === key);
  if (matches.length === 1) return matches[0].name;
  const known = accounts.map(a => a.name).join(', ') || 'none';
  throw new InvalidReadQueryError(
    matches.length > 1 ? `functionName ${name} is ambiguous in the IDL (${matches.map(a => a.name).join(', ')})` : `functionName ${name} is not an account in the IDL (accounts: ${known})`,
  );
}

function hasDiscriminator(a: IdlAccountDef, data: Uint8Array): boolean {
  return data.length >= a.discriminator.length && a.discriminator.every((b, i) => data[i] === b);
}

/**
 * Decode account bytes with the IDL. With `accountName`, the data's discriminator
 * must match that layout; without it, the layout is the one whose discriminator
 * prefixes the data.
 */
export function decodeIdlAccount(idl: Idl, data: Uint8Array, accountName?: string): { accountName: string; value: unknown } {
  const accounts = idl.accounts ?? [];
  let def: IdlAccountDef | undefined;
  if (accountName !== undefined) {
    def = accounts.find(a => a.name === resolveAccountName(idl, accountName));
    if (def && !hasDiscriminator(def, data)) {
      throw new ReadDecodeError(`account data discriminator does not match ${def.name}`);
    }
  } else {
    const found = accounts.filter(a => hasDiscriminator(a, data));
    // Longest match wins if one discriminator prefixes another.
    def = found.sort((x, y) => y.discriminator.length - x.discriminator.length)[0];
    if (!def) {
      const head = Buffer.from(data.subarray(0, 8)).toString('hex');
      throw new ReadDecodeError(`no IDL account discriminator matches the account data (0x${head})`);
    }
  }
  if (!def) throw new ReadDecodeError('account not found in the IDL');
  return { accountName: def.name, value: new BorshAccountsCoder(idl).decode(def.name, Buffer.from(data)) };
}

/** Inspect the mint owner; the chain alone cannot distinguish SPL Token and Token-2022. */
export async function detectTokenProgram(mint: string, chain: CHAIN, rpcUrls?: string[]): Promise<PublicKey> {
  const address = new PublicKey(mint);
  const urls = rpcUrls ?? CHAIN_INFO[chain]?.defaultRPC;
  if (!urls?.length) throw new InvalidReadQueryError(`no Solana RPC configured for ${chain}`);
  let lastError: unknown;
  for (const url of urls) {
    let info;
    try {
      info = await new Connection(url, 'finalized').getAccountInfo(address, 'finalized');
    } catch (error) { lastError = error; continue; }
    if (!info) throw new InvalidReadQueryError(`token mint does not exist: ${mint}`);
    if (!info.owner.equals(TOKEN_PROGRAM_ID) && !info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      throw new InvalidReadQueryError('mint is not owned by SPL Token or Token-2022');
    }
    // Mint base layout: 82 bytes, initialized flag at byte 45. Token-2022
    // extensions pad to 165 bytes and carry AccountType.Mint (1) at byte 165.
    if (info.executable || info.data.length < 82 || info.data[45] !== 1 ||
      (info.owner.equals(TOKEN_PROGRAM_ID) && info.data.length !== 82) ||
      (info.owner.equals(TOKEN_2022_PROGRAM_ID) && info.data.length !== 82 &&
        (info.data.length < 166 || info.data[165] !== 1))) {
      throw new InvalidReadQueryError('token address is not an initialized mint');
    }
    return info.owner;
  }
  throw lastError;
}
