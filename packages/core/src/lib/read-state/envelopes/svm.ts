import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { bytesToHex, decodeAbiParameters, encodeAbiParameters, type Hex } from 'viem';
import { READ_NAMESPACE } from '../../constants/read-state';
import { InvalidReadQueryError } from '../errors';
import type { EncodedReadQuery, ReadResultShape, SvmReadQuery } from '../read-state.types';

/** `universalClient/externalchains/svm/read_envelope.go` — solanaQueryType. */
export const SVM_QUERY_TYPE = {
  LAMPORT_BALANCE: 0,
  SPL_TOKEN_ACCOUNT: 1,
  RAW_ACCOUNT_DATA: 2,
} as const;

/** Single tuple, like EVM. Payload is empty for every v1 type. */
const SVM_ENVELOPE_ABI = [
  {
    type: 'tuple',
    components: [
      { name: 'queryType', type: 'uint8' },
      { name: 'slotRef', type: 'tuple', components: [{ name: 'minSlot', type: 'uint64' }] },
      { name: 'payload', type: 'bytes' },
    ],
  },
] as const;

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

const UINT64_MAX = (1n << 64n) - 1n;

/**
 * The raw 32-byte pubkey the validator requires in `ReadSpec.account.owner`
 * (`svm/read_executor.go:29-32` hard-rejects any other length).
 */
export function svmOwnerBytes(account: string | Uint8Array): Hex {
  let bytes: Uint8Array;
  if (typeof account === 'string') {
    try {
      bytes = bs58.decode(account);
    } catch {
      throw new InvalidReadQueryError(`account is not a base58 Solana pubkey: ${account}`);
    }
  } else {
    bytes = account;
  }
  if (bytes.length !== 32) {
    throw new InvalidReadQueryError(`Solana account must be 32 bytes, got ${bytes.length}`);
  }
  return bytesToHex(bytes);
}

/** Deterministic, offline. Same derivation as @solana/spl-token getAssociatedTokenAddressSync. */
export function deriveAssociatedTokenAddress(
  owner: string | PublicKey,
  mint: string | PublicKey,
  tokenProgramId: PublicKey = TOKEN_PROGRAM_ID,
): PublicKey {
  const o = typeof owner === 'string' ? new PublicKey(owner) : owner;
  const m = typeof mint === 'string' ? new PublicKey(mint) : mint;
  const [ata] = PublicKey.findProgramAddressSync(
    [o.toBuffer(), tokenProgramId.toBuffer(), m.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

/**
 * Encode a `solana` read query. `minSlot` is a staleness FLOOR at finalized
 * commitment, not a pin — Solana cannot read at an exact past slot. The validator
 * uses `max(envelope.minSlot, ReadSpec.blockNumber)`.
 */
export function encodeSvmQueryEnvelope(query: SvmReadQuery, options: { minSlot?: bigint } = {}): EncodedReadQuery {
  const minSlot = options.minSlot ?? 0n;
  if (minSlot < 0n || minSlot > UINT64_MAX) throw new InvalidReadQueryError(`minSlot out of uint64 range: ${minSlot}`);

  let queryType: number;
  let resultShape: ReadResultShape;
  switch (query.type) {
    case 'lamportBalance':
      queryType = SVM_QUERY_TYPE.LAMPORT_BALANCE;
      resultShape = { kind: 'uint256' };
      break;
    case 'splTokenAccount':
      queryType = SVM_QUERY_TYPE.SPL_TOKEN_ACCOUNT;
      resultShape = { kind: 'uint256' };
      break;
    case 'rawAccountData':
      queryType = SVM_QUERY_TYPE.RAW_ACCOUNT_DATA;
      resultShape = { kind: 'raw' };
      break;
    default:
      throw new InvalidReadQueryError(`unknown SVM query type: ${(query as { type: string }).type}`);
  }

  const ownerBytes = svmOwnerBytes(query.account);
  const encoded = encodeAbiParameters(SVM_ENVELOPE_ABI, [{ queryType, slotRef: { minSlot }, payload: '0x' }]);

  return {
    namespace: READ_NAMESPACE.SVM,
    queryType,
    encoded,
    blockRef: minSlot,
    resultShape,
    ownerBytes,
    warnings: [],
  };
}

export function decodeSvmQueryEnvelope(encoded: Hex): { queryType: number; minSlot: bigint; payload: Hex } {
  const [env] = decodeAbiParameters(SVM_ENVELOPE_ABI, encoded);
  return { queryType: env.queryType, minSlot: env.slotRef.minSlot, payload: env.payload };
}
