const mockDecode = jest.fn();

jest.mock('@coral-xyz/anchor', () => {
  const actual = jest.requireActual('@coral-xyz/anchor');
  return {
    ...actual,
    BorshEventCoder: jest.fn().mockImplementation(() => ({
      decode: mockDecode,
    })),
  };
});

import { PublicKey, type Connection } from '@solana/web3.js';
import { bytesToHex } from 'viem';

import { CHAIN } from '../../constants/enums';
import { bs58 } from '../../internal/bs58';
import { deriveChildUniversalTxId } from '../child-inbounds';
import { detectUniversalTxSvm } from '../detector-svm';

const SOLANA_SIG_BASE58 =
  'KQkJoXd3xFtauANM1pSASWLc5oeF13Jmd5wpnrx6JRH6JtePFdmXkSd618YjpgRNs5CAAHRrdEHfXnab7AcEQsc';

const UNIVERSAL_TX_DISCRIMINATOR = Buffer.from('6c9ad829b5ea1d7c', 'hex');
const UNIVERSAL_TX_EVENT_BASE64 = Buffer.concat([
  UNIVERSAL_TX_DISCRIMINATOR,
  Buffer.alloc(16),
]).toString('base64');

function universalTxEventData() {
  return {
    sender: new PublicKey(new Uint8Array(32).fill(0x11)),
    recipient: new Uint8Array(20).fill(0x22),
    token: PublicKey.default,
    amount: BigInt(1),
    payload: new Uint8Array([]),
    revert_recipient: new PublicKey(new Uint8Array(32).fill(0x33)),
    tx_type: { gasAndPayload: {} },
    signature_data: new Uint8Array([]),
    from_cea: true,
  };
}

describe('detectUniversalTxSvm log index handling', () => {
  beforeEach(() => {
    mockDecode.mockReset();
    mockDecode.mockReturnValue({
      name: 'UniversalTx',
      data: universalTxEventData(),
    });
  });

  it('uses the Solana logMessages index, not the matched-event ordinal', async () => {
    const connection = {
      getTransaction: jest.fn(async () => ({
        meta: {
          err: null,
          logMessages: [
            'Program log: start',
            'Program data: AAAAAAAAAA==',
            `Program data: ${UNIVERSAL_TX_EVENT_BASE64}`,
            'Program log: done',
          ],
        },
      })),
    } as unknown as Connection;

    const out = await detectUniversalTxSvm(
      SOLANA_SIG_BASE58,
      CHAIN.SOLANA_DEVNET,
      { connection }
    );

    const hexSig = bytesToHex(bs58.decode(SOLANA_SIG_BASE58));
    const expectedId = deriveChildUniversalTxId(
      CHAIN.SOLANA_DEVNET,
      hexSig,
      2
    );

    expect(out.kind).toBe('INBOUND_FROM_CEA');
    expect(out.matchingLogs).toHaveLength(1);
    expect(out.matchingLogs[0].logIndex).toBe(2);
    expect(out.decoded.universalTxId).toBe(expectedId);
    expect(
      out.notes.some((n) => n.includes(`${CHAIN.SOLANA_DEVNET}:<hexSig>:2`))
    ).toBe(true);
  });
});
