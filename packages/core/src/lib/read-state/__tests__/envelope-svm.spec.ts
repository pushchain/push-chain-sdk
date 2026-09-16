import { PublicKey } from '@solana/web3.js';
import { decodeAbiParameters, sliceHex } from 'viem';
import vectorsFile from './fixtures/envelope-vectors.json';
import {
  SVM_QUERY_TYPE,
  TOKEN_PROGRAM_ID,
  decodeSvmQueryEnvelope,
  deriveAssociatedTokenAddress,
  encodeSvmQueryEnvelope,
  svmOwnerBytes,
} from '../envelopes/svm';
import { InvalidReadQueryError } from '../errors';

const vectors = vectorsFile.vectors.filter((v) => v.namespace === 'solana');
const ACCOUNT = '3nK8X1re4zLNrgz9Y3xKS4g2fKPJ6M3N9BhNuFfkjwAb';
const ACCOUNT_HEX = '0x2953026d328218b107268efe60f7d98635af1ff535a91731f75ca7cf8a859044';

const GO_SHAPE = [
  {
    type: 'tuple',
    components: [
      { name: 'queryType', type: 'uint8' },
      { name: 'slotRef', type: 'tuple', components: [{ name: 'minSlot', type: 'uint64' }] },
      { name: 'payload', type: 'bytes' },
    ],
  },
] as const;

describe('SVM query envelope', () => {
  it.each(vectors)('golden vector: $name', (v) => {
    const out = encodeSvmQueryEnvelope(v.query as never, { minSlot: BigInt(v.minSlot as string) });
    expect(out.encoded).toBe(v.expectedHex);
    expect(out.ownerBytes).toBe(v.ownerHex ?? ACCOUNT_HEX);
    expect(out.blockRef).toBe(BigInt(v.minSlot as string));
    const [env] = decodeAbiParameters(GO_SHAPE, out.encoded);
    expect(env.payload).toBe('0x');
  });

  it('is a single tuple with a 0x20 head offset and an empty payload', () => {
    const out = encodeSvmQueryEnvelope({ type: 'lamportBalance', account: ACCOUNT });
    expect(sliceHex(out.encoded, 0, 32)).toBe('0x0000000000000000000000000000000000000000000000000000000000000020');
    const d = decodeSvmQueryEnvelope(out.encoded);
    expect(d).toEqual({ queryType: SVM_QUERY_TYPE.LAMPORT_BALANCE, minSlot: 0n, payload: '0x' });
  });

  it('owner bytes: base58 → exactly 32 bytes; raw bytes accepted; anything else rejected', () => {
    expect(svmOwnerBytes(ACCOUNT)).toBe(ACCOUNT_HEX);
    expect(svmOwnerBytes(new PublicKey(ACCOUNT).toBytes())).toBe(ACCOUNT_HEX);
    expect(() => svmOwnerBytes(new Uint8Array(20))).toThrow(InvalidReadQueryError);
    expect(() => svmOwnerBytes('0x000000000000000000000000000000000000dEaD')).toThrow(InvalidReadQueryError);
    expect(() => svmOwnerBytes('not-base58-!!')).toThrow(InvalidReadQueryError);
  });

  it('result shapes: balances are uint256, raw account data is raw', () => {
    expect(encodeSvmQueryEnvelope({ type: 'lamportBalance', account: ACCOUNT }).resultShape).toEqual({ kind: 'uint256' });
    expect(encodeSvmQueryEnvelope({ type: 'splTokenAccount', account: ACCOUNT }).resultShape).toEqual({ kind: 'uint256' });
    expect(encodeSvmQueryEnvelope({ type: 'rawAccountData', account: ACCOUNT }).resultShape).toEqual({ kind: 'raw' });
  });

  it('derives the associated token address deterministically (matches spl-token)', () => {
    // USDC devnet mint; expected ATA computed independently with @solana/spl-token.
    const owner = new PublicKey(ACCOUNT);
    const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
    const ata = deriveAssociatedTokenAddress(owner, mint);
    const [expected] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
    );
    expect(ata.equals(expected)).toBe(true);
    expect(deriveAssociatedTokenAddress(ACCOUNT, mint.toBase58()).equals(expected)).toBe(true);
  });

  it('rejects an out-of-range minSlot', () => {
    expect(() => encodeSvmQueryEnvelope({ type: 'lamportBalance', account: ACCOUNT }, { minSlot: 1n << 64n })).toThrow(
      InvalidReadQueryError,
    );
  });
});
