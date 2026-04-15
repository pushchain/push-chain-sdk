import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { CHAIN } from '../../constants/enums';
import { registerIdl, clearRegistry } from './registry';
import { resolveSvmCall } from './resolve';
import { encodeAnchorIxData } from './ix-encoder';
import testCounterIdl from './__fixtures__/test_counter.idl.json';

const SVM_GATEWAY = new PublicKey('CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS');
const TEST_PROGRAM =
  '0x7673075a980bfd5d6b1dffe99c31f63e8938519cc1c2af009dda5e568a94460d' as const;
const TEST_SOL_TARGET =
  '0x6a44bb5ea802a001386a5b39708523e1a3e1bafc8164ffcb94d1f5afa4849c69' as const;
const SOL_ZERO =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const;
const SENDER_UEA = '0x1234567890abcdef1234567890abcdef12345678' as const;

function legacyCeaPdaHex(senderUea: `0x${string}`): `0x${string}` {
  const senderBytes = Buffer.from(senderUea.slice(2), 'hex');
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('push_identity'), senderBytes],
    SVM_GATEWAY
  );
  return ('0x' + Buffer.from(pda.toBytes()).toString('hex')) as `0x${string}`;
}

function legacyReceiveSolAccounts(ceaPdaHex: `0x${string}`) {
  const COUNTER_PDA =
    '0x4f12fe6816ae7e33ebf7db0b154ec3b09e3bf1a7690481e8e9477d5a278ad3af' as const;
  return [
    { pubkey: COUNTER_PDA, isWritable: true },
    { pubkey: TEST_SOL_TARGET, isWritable: true },
    { pubkey: ceaPdaHex, isWritable: true },
    { pubkey: SOL_ZERO, isWritable: false },
  ];
}

function legacyReceiveSolIxData(amount: bigint): Uint8Array {
  const discriminator = new Uint8Array([121, 244, 250, 3, 8, 229, 225, 1]);
  const amountBuf = new Uint8Array(8);
  new DataView(amountBuf.buffer).setBigUint64(0, amount, true);
  return new Uint8Array([...discriminator, ...amountBuf]);
}

describe('resolveSvmCall — byte-for-byte parity against legacy svmExecute', () => {
  beforeEach(() => clearRegistry());

  it('produces the same triple as hand-rolled buildReceiveSol* helpers (amount=0)', () => {
    registerIdl(TEST_PROGRAM, testCounterIdl);
    const amount = BigInt(0);
    const data = encodeAnchorIxData(testCounterIdl as any, 'receive_sol', [amount]);

    const resolved = resolveSvmCall({
      programAddress: TEST_PROGRAM,
      data,
      senderUea: SENDER_UEA,
      targetChain: CHAIN.SOLANA_DEVNET,
    });

    const expectedCea = legacyCeaPdaHex(SENDER_UEA);
    const expectedAccounts = legacyReceiveSolAccounts(expectedCea);
    const expectedIx = legacyReceiveSolIxData(amount);

    expect(resolved.targetProgram).toBe(TEST_PROGRAM);
    expect(resolved.accounts).toEqual(expectedAccounts);
    expect(Array.from(resolved.ixData)).toEqual(Array.from(expectedIx));
  });

  it('preserves parity for non-zero amount', () => {
    registerIdl(TEST_PROGRAM, testCounterIdl);
    const amount = BigInt(42);
    const data = encodeAnchorIxData(testCounterIdl as any, 'receive_sol', [amount]);

    const resolved = resolveSvmCall({
      programAddress: TEST_PROGRAM,
      data,
      senderUea: SENDER_UEA,
      targetChain: CHAIN.SOLANA_DEVNET,
    });

    expect(Array.from(resolved.ixData)).toEqual(
      Array.from(legacyReceiveSolIxData(amount))
    );
    expect(resolved.accounts).toEqual(
      legacyReceiveSolAccounts(legacyCeaPdaHex(SENDER_UEA))
    );
  });

  it('throws when no IDL is registered', () => {
    const data = encodeAnchorIxData(testCounterIdl as any, 'receive_sol', [BigInt(0)]);
    expect(() =>
      resolveSvmCall({
        programAddress: TEST_PROGRAM,
        data,
        senderUea: SENDER_UEA,
        targetChain: CHAIN.SOLANA_DEVNET,
      })
    ).toThrow(/no IDL registered/);
  });

  it('throws when discriminator does not match any instruction', () => {
    registerIdl(TEST_PROGRAM, testCounterIdl);
    const bogus = new Uint8Array(16).fill(0xaa);
    expect(() =>
      resolveSvmCall({
        programAddress: TEST_PROGRAM,
        data: bogus,
        senderUea: SENDER_UEA,
        targetChain: CHAIN.SOLANA_DEVNET,
      })
    ).toThrow(/no instruction in IDL/);
  });
});
