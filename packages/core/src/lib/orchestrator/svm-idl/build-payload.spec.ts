import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { CHAIN } from '../../constants/enums';
import { registerIdl, clearRegistry } from './registry';
import { buildSvmPayloadFromParams } from './build-payload';
import { encodeSvmExecutePayload } from '../payload-builders';
import testCounterIdl from './__fixtures__/test_counter.idl.json';

const TEST_PROGRAM =
  '0x7673075a980bfd5d6b1dffe99c31f63e8938519cc1c2af009dda5e568a94460d' as const;
const TEST_SOL_TARGET =
  '0x6a44bb5ea802a001386a5b39708523e1a3e1bafc8164ffcb94d1f5afa4849c69' as const;
const COUNTER_PDA =
  '0x4f12fe6816ae7e33ebf7db0b154ec3b09e3bf1a7690481e8e9477d5a278ad3af' as const;
const SOL_ZERO =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const;
const SENDER_UEA = '0x1234567890abcdef1234567890abcdef12345678' as const;
const SVM_GATEWAY = new PublicKey('CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS');

function legacyCeaPdaHex(senderUea: `0x${string}`): `0x${string}` {
  const senderBytes = Buffer.from(senderUea.slice(2), 'hex');
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('push_identity'), senderBytes],
    SVM_GATEWAY
  );
  return ('0x' + Buffer.from(pda.toBytes()).toString('hex')) as `0x${string}`;
}

function legacyReceiveSolIxData(amount: bigint): Uint8Array {
  const discriminator = new Uint8Array([121, 244, 250, 3, 8, 229, 225, 1]);
  const amountBuf = new Uint8Array(8);
  new DataView(amountBuf.buffer).setBigUint64(0, amount, true);
  return new Uint8Array([...discriminator, ...amountBuf]);
}

function legacySvmPayloadForReceiveSol(
  amount: bigint,
  ceaPdaHex: `0x${string}`
): `0x${string}` {
  return encodeSvmExecutePayload({
    targetProgram: TEST_PROGRAM,
    accounts: [
      { pubkey: COUNTER_PDA, isWritable: true },
      { pubkey: TEST_SOL_TARGET, isWritable: true },
      { pubkey: ceaPdaHex, isWritable: true },
      { pubkey: SOL_ZERO, isWritable: false },
    ],
    ixData: legacyReceiveSolIxData(amount),
    instructionId: 2,
  });
}

describe('buildSvmPayloadFromParams — prepareTransaction parity', () => {
  beforeEach(() => clearRegistry());

  it('produces byte-identical svmPayload vs legacy svmExecute for amount=0', () => {
    registerIdl(testCounterIdl);
    const amount = BigInt(0);
    const calldata =
      ('0x' + Buffer.from(legacyReceiveSolIxData(amount)).toString('hex')) as `0x${string}`;

    const { svmPayload, targetBytes, hasExecute } = buildSvmPayloadFromParams({
      data: calldata,
      to: { address: TEST_PROGRAM, chain: CHAIN.SOLANA_DEVNET },
      senderUea: SENDER_UEA,
    });

    expect(hasExecute).toBe(true);
    expect(targetBytes).toBe(TEST_PROGRAM);
    expect(svmPayload).toBe(
      legacySvmPayloadForReceiveSol(amount, legacyCeaPdaHex(SENDER_UEA))
    );
  });

  it('produces byte-identical svmPayload for non-zero amount', () => {
    registerIdl(testCounterIdl);
    const amount = BigInt(5_000_000);
    const calldata =
      ('0x' + Buffer.from(legacyReceiveSolIxData(amount)).toString('hex')) as `0x${string}`;

    const { svmPayload } = buildSvmPayloadFromParams({
      data: calldata,
      to: { address: TEST_PROGRAM, chain: CHAIN.SOLANA_DEVNET },
      senderUea: SENDER_UEA,
    });

    expect(svmPayload).toBe(
      legacySvmPayloadForReceiveSol(amount, legacyCeaPdaHex(SENDER_UEA))
    );
  });

  it('returns empty payload + to.address targetBytes for withdraw-only (no data)', () => {
    const { svmPayload, targetBytes, hasExecute } = buildSvmPayloadFromParams({
      data: undefined,
      to: { address: TEST_SOL_TARGET, chain: CHAIN.SOLANA_DEVNET },
      senderUea: SENDER_UEA,
    });

    expect(hasExecute).toBe(false);
    expect(svmPayload).toBe('0x');
    expect(targetBytes).toBe(TEST_SOL_TARGET);
  });

  it('returns empty payload when data is the empty-hex sentinel "0x"', () => {
    const { svmPayload, hasExecute } = buildSvmPayloadFromParams({
      data: '0x',
      to: { address: TEST_SOL_TARGET, chain: CHAIN.SOLANA_DEVNET },
      senderUea: SENDER_UEA,
    });
    expect(hasExecute).toBe(false);
    expect(svmPayload).toBe('0x');
  });

  it('throws at submit time if IDL was never registered for the program', () => {
    const amount = BigInt(0);
    const calldata =
      ('0x' + Buffer.from(legacyReceiveSolIxData(amount)).toString('hex')) as `0x${string}`;
    expect(() =>
      buildSvmPayloadFromParams({
        data: calldata,
        to: { address: TEST_PROGRAM, chain: CHAIN.SOLANA_DEVNET },
        senderUea: SENDER_UEA,
      })
    ).toThrow(/no IDL found/);
  });
});
