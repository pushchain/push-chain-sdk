/**
 * Pure-unit coverage for detector-svm.ts's argument normalization.
 *
 * Full end-to-end decode (Anchor BorshEventCoder + logMessages walk) is
 * covered by the env-gated live stage in detector.live.spec.ts. Here we
 * only lock in the shape-translation contract between Anchor's snake_case,
 * BN-wrapped output and classify.ts's EVM-style camelCase expectations.
 */
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

import { __svmInternal } from '../detector-svm';

const { normalizeSvmEventArgs, extractTxTypeIndex, normalizeSolanaSignature, solanaSigToHex } = __svmInternal;

describe('detector-svm — argument normalization', () => {
  it('renames snake_case keys classify.ts reads via camelCase', () => {
    const raw = {
      sub_tx_id: new Uint8Array(32).fill(0xaa),
      universal_tx_id: new Uint8Array(32).fill(0xbb),
      push_account: new Uint8Array(20).fill(0xcc),
      target: new PublicKey(new Uint8Array(32).fill(0x01)),
      token: new PublicKey(new Uint8Array(32).fill(0x02)),
      amount: new BN('1000000'),
      payload: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    };
    const out = normalizeSvmEventArgs('UniversalTxFinalized', raw);

    // classify.ts reads these keys — they must be camelCase.
    expect(out['subTxId']).toBe('0x' + 'aa'.repeat(32));
    expect(out['universalTxId']).toBe('0x' + 'bb'.repeat(32));
    expect(out['pushAccount']).toBe('0x' + 'cc'.repeat(20));

    // Pubkeys → 0x-hex 32-byte strings.
    expect(out['target']).toBe('0x' + '01'.repeat(32));
    expect(out['token']).toBe('0x' + '02'.repeat(32));

    // BN → bigint.
    expect(out['amount']).toBe(BigInt(1_000_000));

    // UniversalTxFinalized aliases payload → data so classify.ts's
    // setPayload(a['data']) finds it.
    expect(out['data']).toBe(out['payload']);
    expect(typeof out['data']).toBe('string');
  });

  it('adds `to` alias for RevertUniversalTx.revertRecipient', () => {
    const raw = {
      sub_tx_id: new Uint8Array(32).fill(0x11),
      universal_tx_id: new Uint8Array(32).fill(0x22),
      revert_recipient: new PublicKey(new Uint8Array(32).fill(0x33)),
      token: new PublicKey(new Uint8Array(32).fill(0x44)),
      amount: new BN('42'),
    };
    const out = normalizeSvmEventArgs('RevertUniversalTx', raw);
    expect(out['revertRecipient']).toBe('0x' + '33'.repeat(32));
    // classify.ts's switch arm reads a['to'] for RevertUniversalTx.
    expect(out['to']).toBe(out['revertRecipient']);
  });

  it('surfaces UniversalTx fromCEA as a boolean and preserves tx_type enum as number', () => {
    const raw = {
      sender: new PublicKey(new Uint8Array(32).fill(0x55)),
      recipient: new Uint8Array(20).fill(0x66),
      token: new PublicKey(new Uint8Array(32).fill(0x77)),
      amount: new BN('7'),
      payload: new Uint8Array([]),
      revert_recipient: new PublicKey(new Uint8Array(32).fill(0x88)),
      tx_type: { fundsAndPayload: {} }, // anchor-decoded enum variant
      signature_data: new Uint8Array([]),
      from_cea: true,
    };
    const out = normalizeSvmEventArgs('UniversalTx', raw);
    expect(out['fromCEA']).toBe(true);
    // TX_TYPE_NAMES in classify.ts expects the numeric variant index.
    // FUNDS_AND_PAYLOAD is index 3.
    expect(out['txType']).toBe(3);
  });

  it('normalizeSolanaSignature round-trips 0x-hex ↔ base58 and leaves base58 untouched', () => {
    // Real Push→Solana devnet outbound signature (hex form from cosmos).
    const hex =
      '0xabf546efce2a468fc3ec8d01bf24f1e21a97d31199fa069f8581e2e78058905f3b13da047f1afde5f633047a8ebf269ccf2133695588bbb576b57c5cd8082107';
    const base58 =
      '4SQQnK6kCzpq9mYJccNKk2djj1cRa2wSKr9Xi4wqgqhZXJAo5N2sSTSY6rbpsbjFx4YNxdmxAEkofndqYWG7MGZC';
    expect(normalizeSolanaSignature(hex)).toBe(base58);
    expect(normalizeSolanaSignature(base58)).toBe(base58);
    expect(solanaSigToHex(base58).toLowerCase()).toBe(hex.toLowerCase());
  });

  it('extractTxTypeIndex resolves every declared variant and returns undefined for unknown ones', () => {
    expect(extractTxTypeIndex({ gas: {} })).toBe(0);
    expect(extractTxTypeIndex({ gasAndPayload: {} })).toBe(1);
    expect(extractTxTypeIndex({ funds: {} })).toBe(2);
    expect(extractTxTypeIndex({ fundsAndPayload: {} })).toBe(3);
    expect(extractTxTypeIndex({ rescueFunds: {} })).toBe(4);
    expect(extractTxTypeIndex({ somethingElse: {} })).toBeUndefined();
    expect(extractTxTypeIndex({})).toBeUndefined();
  });
});
