import { BorshAccountsCoder, type Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { CHAIN_INFO } from '../constants/chain';
import type { CHAIN } from '../constants/enums';
import { InvalidReadQueryError } from './errors';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from './envelopes/svm';

export function accountCoder(idl: Idl, accountName: string): BorshAccountsCoder {
  try {
    if (!idl || !accountName || !idl.accounts?.some(a => a.name === accountName)) {
      throw new Error('accountName must identify an account in the IDL');
    }
    new PublicKey(idl.address);
    const discriminator = idl.accounts!.find(a => a.name === accountName)!.discriminator;
    if (!Array.isArray(discriminator) || discriminator.length === 0 || discriminator.some(b => !Number.isInteger(b) || b < 0 || b > 255)) {
      throw new Error('account discriminator must be a non-empty byte array');
    }
    return new BorshAccountsCoder(idl);
  } catch (error) {
    throw new InvalidReadQueryError(`invalid Solana account IDL: ${(error as Error).message}`);
  }
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
