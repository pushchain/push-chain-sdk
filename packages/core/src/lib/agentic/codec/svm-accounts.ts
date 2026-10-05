import { PublicKey } from '@solana/web3.js';
import {
  bytesToHex,
  getAddress,
  hexToBytes,
  type Address,
  type Hex,
} from 'viem';
import { exactHex, SVM_LIMITS, svmInvalid } from './svm-terms';
import type { AssetCapWire } from './universal-terms';

const SPL_TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ASSOCIATED_TOKEN = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
);

export function svmKey(value: string): Hex {
  try {
    if (value.startsWith('0x')) {
      exactHex(value, 32, 'pubkey');
      return bytesToHex(new PublicKey(hexToBytes(value)).toBytes());
    }
    return bytesToHex(new PublicKey(value).toBytes());
  } catch {
    throw svmInvalid('invalid Solana public key');
  }
}
function key(value: string) {
  return new PublicKey(hexToBytes(svmKey(value)));
}

/** Gateway is supplied by the selected cluster registry, never a global hard-coded program. */
export function deriveAgwSvmCea(
  wallet: Address,
  gatewayProgram: string
): { address: Hex; bump: number } {
  if (key(gatewayProgram).equals(PublicKey.default))
    throw svmInvalid('gateway program cannot be zero');
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('push_identity'), Buffer.from(hexToBytes(getAddress(wallet)))],
    key(gatewayProgram)
  );
  return { address: bytesToHex(pda.toBytes()), bump };
}
export interface SvmTokenAccountInput {
  mint: string;
  tokenProgram?: string;
}
export type ResolvedSvmAsset =
  | { kind: 'native'; cap: AssetCapWire }
  | { kind: 'spl'; cap: AssetCapWire; mint: string; tokenProgram?: string };

/** Every resolved SPL cap contributes an ATA; caller cannot omit a listed mint. */
export function resolveAgwSvmRuleContext(
  wallet: Address,
  gatewayProgram: string,
  assets: readonly ResolvedSvmAsset[],
  outputs: readonly SvmTokenAccountInput[] = []
) {
  if (!assets.length || assets.length > SVM_LIMITS.assets)
    throw svmInvalid('resolved assets must contain 1..8 entries');
  const tokens = assets.flatMap((a) =>
    a.kind === 'spl' ? [{ mint: a.mint, tokenProgram: a.tokenProgram }] : []
  );
  return {
    ...deriveAgwSvmValueAccounts(wallet, gatewayProgram, tokens, outputs),
    assets: assets.map((a) => a.cap),
  };
}
export function deriveAgwSvmAta(
  owner: string,
  token: SvmTokenAccountInput
): Hex {
  const mint = key(token.mint),
    program = token.tokenProgram ? key(token.tokenProgram) : SPL_TOKEN;
  if (mint.equals(PublicKey.default))
    throw svmInvalid('native SOL uses the CEA, not an ATA');
  if (!program.equals(SPL_TOKEN) && !program.equals(TOKEN_2022))
    throw svmInvalid('unsupported token program');
  const [ata] = PublicKey.findProgramAddressSync(
    [key(owner).toBuffer(), program.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN
  );
  return bytesToHex(ata.toBytes());
}
/** Includes every listed mint and swap-output mint. Native SOL is already covered by the CEA. */
export function deriveAgwSvmValueAccounts(
  wallet: Address,
  gatewayProgram: string,
  tokens: readonly SvmTokenAccountInput[],
  outputs: readonly SvmTokenAccountInput[] = []
): { expectedCEA: Hex; gatewayProgram: Hex; ceaAccounts: Hex[] } {
  const expectedCEA = deriveAgwSvmCea(wallet, gatewayProgram).address;
  const ceaAccounts = [
    ...new Set([
      expectedCEA,
      ...[...tokens, ...outputs].map((t) => deriveAgwSvmAta(expectedCEA, t)),
    ]),
  ];
  if (ceaAccounts.length > SVM_LIMITS.ceaAccounts)
    throw svmInvalid('derived CEA value-account set exceeds 16');
  return { expectedCEA, gatewayProgram: svmKey(gatewayProgram), ceaAccounts };
}
