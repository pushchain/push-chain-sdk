/**
 * Unit tests for the Stage 2 child-inbound resolver. Verifies the
 * sha256(caip:hash:logIndex) formula matches the chain's GetInboundUniversalTxKey
 * (see push-chain/x/uexecutor/types/keys.go:49-53) and that the PushClient
 * stitch is correct.
 */
import {
  deriveChildUniversalTxId,
  derivePcUniversalTxId,
  resolveChildInboundsFromLogs,
} from '../child-inbounds';
import type { PushClient } from '../../push-client/push-client';
import type { MatchingLog } from '../types';

// Real IDs captured from the live probe (see memory 1098 + 1112).
const SEPOLIA_CAIP = 'eip155:11155111';
const SEPOLIA_HASH =
  '0x9c40ac52cf6d88602c7e8f0a36d08ec06774450c8e30d2739ee81b5ebd0dee79';
const SEPOLIA_LOG_INDEX = 249;
const EXPECTED_CHILD_UTX_HEX =
  '0x031dd1d75de2d4fd989752eb05c27b6a77aa40d038323cd9da3c7b51fb209819';

const PUSH_CAIP = 'eip155:42101';
const PUSH_HASH =
  '0x80fc70302f8eaac02649b18fe5a09b1580d0f6190b420d3a1058c39ecbf53443';
const EXPECTED_PC_UTX_HEX =
  '0x495155514b5ee81db0f10ee536a431e8c3338981579f12895da1f18544d124ae';

const PUSH_FOLLOW_UP_HASH =
  '0xd938ea14e1945ec47cb5a46b2db6debf57447acc50fda810d62df5c3ce56c459';

const SOLANA_DEVNET_CAIP = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const SOLANA_SIG_BASE58 =
  'KQkJoXd3xFtauANM1pSASWLc5oeF13Jmd5wpnrx6JRH6JtePFdmXkSd618YjpgRNs5CAAHRrdEHfXnab7AcEQsc';
const SOLANA_SIG_HEX =
  '0x0fe026a46ebd8afa6fc396794c278e1cdb942260111db9564c1a61a0251f488af1a3f88363d7e3c7583c5eca61657515563283859dfabbb5e31333325ccaff0b';
const SOLANA_UNIVERSAL_TX_LOG_INDEX = 14;
const SOLANA_EXPECTED_CHILD_UTX_HEX =
  '0xbe6c4edcfa2f57acf145b8a7e08f10495cdd00c75042a5ae53f4ccaa4b318c3b';

function makeInboundLog(eventName: string, logIndex: number): MatchingLog {
  return {
    eventName,
    address: '0x05bd7a3d18324c1f7e216f7fbf2b15985ae5281a',
    logIndex,
    args: {},
  };
}

describe('deriveChildUniversalTxId (sha256 formula)', () => {
  it('matches the chain GetInboundUniversalTxKey for real Sepolia inbound', () => {
    const id = deriveChildUniversalTxId(SEPOLIA_CAIP, SEPOLIA_HASH, SEPOLIA_LOG_INDEX);
    expect(id).toBe(EXPECTED_CHILD_UTX_HEX);
  });

  it('handles externalTxHash without 0x prefix', () => {
    const id = deriveChildUniversalTxId(SEPOLIA_CAIP, SEPOLIA_HASH.slice(2), SEPOLIA_LOG_INDEX);
    expect(id).toBe(EXPECTED_CHILD_UTX_HEX);
  });

  it('includes logIndex — different indices produce different ids', () => {
    const a = deriveChildUniversalTxId(SEPOLIA_CAIP, SEPOLIA_HASH, 0);
    const b = deriveChildUniversalTxId(SEPOLIA_CAIP, SEPOLIA_HASH, 1);
    expect(a).not.toBe(b);
  });

  it('normalizes SVM base58 signatures to the keeper hex form', () => {
    const fromBase58 = deriveChildUniversalTxId(
      SOLANA_DEVNET_CAIP,
      SOLANA_SIG_BASE58,
      SOLANA_UNIVERSAL_TX_LOG_INDEX
    );
    const fromHex = deriveChildUniversalTxId(
      SOLANA_DEVNET_CAIP,
      SOLANA_SIG_HEX,
      SOLANA_UNIVERSAL_TX_LOG_INDEX
    );
    const fromBareHex = deriveChildUniversalTxId(
      SOLANA_DEVNET_CAIP,
      SOLANA_SIG_HEX.slice(2),
      SOLANA_UNIVERSAL_TX_LOG_INDEX
    );

    expect(fromBase58).toBe(SOLANA_EXPECTED_CHILD_UTX_HEX);
    expect(fromHex).toBe(SOLANA_EXPECTED_CHILD_UTX_HEX);
    expect(fromBareHex).toBe(SOLANA_EXPECTED_CHILD_UTX_HEX);
  });
});

describe('derivePcUniversalTxId (sha256 formula, no logIndex)', () => {
  it('matches the chain GetPcUniversalTxKey for real Push Chain outbound', () => {
    const id = derivePcUniversalTxId(PUSH_CAIP, PUSH_HASH);
    expect(id).toBe(EXPECTED_PC_UTX_HEX);
  });
});

describe('resolveChildInboundsFromLogs', () => {
  it('derives child id and stitches pcTx/outboundTx from cosmos', async () => {
    const getUniversalTxByIdV2 = jest.fn().mockResolvedValue({
      universalTx: {
        id: EXPECTED_CHILD_UTX_HEX.slice(2),
        universalStatus: 3, // PC_EXECUTED_SUCCESS
        pcTx: [{ txHash: PUSH_FOLLOW_UP_HASH, gasUsed: '55167' }],
        outboundTx: [],
      },
    });
    const pushClient = { getUniversalTxByIdV2 } as unknown as PushClient;
    const out = await resolveChildInboundsFromLogs(
      pushClient,
      SEPOLIA_CAIP,
      SEPOLIA_HASH,
      [makeInboundLog('UniversalTx', SEPOLIA_LOG_INDEX)]
    );
    expect(getUniversalTxByIdV2).toHaveBeenCalledWith(
      EXPECTED_CHILD_UTX_HEX.slice(2)
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      universalTxId: EXPECTED_CHILD_UTX_HEX,
      sourceLogIndex: SEPOLIA_LOG_INDEX,
      sourceEventName: 'UniversalTx',
      status: 3,
      statusName: 'PC_EXECUTED_SUCCESS',
      pcTxHashes: [PUSH_FOLLOW_UP_HASH],
    });
  });

  it('marks notFound when cosmos returns null universalTx', async () => {
    const pushClient = {
      getUniversalTxByIdV2: jest.fn().mockResolvedValue({ universalTx: null }),
    } as unknown as PushClient;
    const out = await resolveChildInboundsFromLogs(
      pushClient,
      SEPOLIA_CAIP,
      SEPOLIA_HASH,
      [makeInboundLog('UniversalTx', SEPOLIA_LOG_INDEX)]
    );
    expect(out).toHaveLength(1);
    expect(out[0].notFound).toBe(true);
    expect(out[0].pcTxHashes).toEqual([]);
  });

  it('records diagnostic + marks notFound when getUniversalTxByIdV2 throws', async () => {
    const pushClient = {
      getUniversalTxByIdV2: jest.fn().mockRejectedValue(new Error('boom')),
    } as unknown as PushClient;
    const notes: string[] = [];
    const out = await resolveChildInboundsFromLogs(
      pushClient,
      SEPOLIA_CAIP,
      SEPOLIA_HASH,
      [makeInboundLog('UniversalTx', SEPOLIA_LOG_INDEX)],
      notes
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      universalTxId: EXPECTED_CHILD_UTX_HEX,
      sourceLogIndex: SEPOLIA_LOG_INDEX,
      sourceEventName: 'UniversalTx',
      status: 0,
      statusName: 'UNIVERSAL_TX_STATUS_UNSPECIFIED',
      pcTxHashes: [],
      outboundHashes: [],
      notFound: true,
    });
    expect(notes.some((n) => n.includes('getUniversalTxByIdV2'))).toBe(true);
  });

  it('resolves one entry per inbound log', async () => {
    const pushClient = {
      getUniversalTxByIdV2: jest.fn().mockResolvedValue({
        universalTx: {
          id: 'x',
          universalStatus: 3,
          pcTx: [],
          outboundTx: [],
        },
      }),
    } as unknown as PushClient;
    const out = await resolveChildInboundsFromLogs(
      pushClient,
      SEPOLIA_CAIP,
      SEPOLIA_HASH,
      [
        makeInboundLog('UniversalTx', 100),
        makeInboundLog('RevertUniversalTx', 200),
      ]
    );
    expect(out).toHaveLength(2);
    expect((pushClient.getUniversalTxByIdV2 as jest.Mock).mock.calls).toHaveLength(2);
    expect(out[0].sourceLogIndex).toBe(100);
    expect(out[1].sourceLogIndex).toBe(200);
  });
});
