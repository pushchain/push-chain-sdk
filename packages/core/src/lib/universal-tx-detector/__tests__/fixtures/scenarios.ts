/**
 * Parametric scenario catalogue for universal-tx-detector specs.
 *
 * Each ScenarioFixture declares a deterministic tx (receipt + optional
 * mocked cosmos state) plus the assertions every consumer should check.
 *
 * Adding coverage for a new event shape or cascade topology = append one
 * row here. The driver spec (__tests__/scenarios.spec.ts) picks it up
 * automatically via describe.each.
 */
import type { TransactionReceipt } from 'viem';

import { CHAIN } from '../../../constants/enums';
import {
  EVENT_FUNDS_RESCUED,
  EVENT_REVERT_UNIVERSAL_TX,
  EVENT_UNIVERSAL_TX,
  EVENT_UNIVERSAL_TX_EXECUTED,
  EVENT_UNIVERSAL_TX_FINALIZED,
  EVENT_UNIVERSAL_TX_OUTBOUND,
  EVENT_UNIVERSAL_TX_REVERTED,
} from '../../events';
import type { DecodedIdentifiers, MatchingLog, UniversalTxKind } from '../../types';
import {
  deriveChildUniversalTxId,
  derivePcUniversalTxId,
} from '../../child-inbounds';

import { buildLog, buildReceipt, type EventDef } from './builders';

// ── Shared constants ──────────────────────────────────────────────────

const ADDR = {
  gatewayBsc: '0x44aFFC61983F4348DdddB886349eb992C061EaC0' as `0x${string}`,
  vaultBsc: '0xE52AC4f8DD3e0263bDF748F3390cdFA1f02be881' as `0x${string}`,
  gatewaySepolia: '0x05bD7a3D18324c1F7e216f7fbf2b15985aE5281A' as `0x${string}`,
  vaultSepolia: '0xD019Eb12D0d6eF8D299661f22B4B7d262eD4b965' as `0x${string}`,
  pcGateway: '0x00000000000000000000000000000000000000c1' as `0x${string}`,
  uea: '0x4A701114F991bf75685584c8156Db983c0DF95a0' as `0x${string}`,
  cea: '0x30a9dB8E3cCe83e8A8720EB61B8728F98449ee6b' as `0x${string}`,
  sender: '0xaaaa000000000000000000000000000000000001' as `0x${string}`,
  recipient: '0xbbbb000000000000000000000000000000000002' as `0x${string}`,
  token: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  pushToken: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06' as `0x${string}`,
  revertTo: '0xdddd000000000000000000000000000000000004' as `0x${string}`,
};

const HASH = {
  // Stable test hashes — each pattern identifies one scenario.
  sA: '0xaa01000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  sC: '0xcc01000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  sD: '0xdd01000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  sE: '0xee01000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  sF: '0xff01000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  sG: '0x0701000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  sH: '0x0801000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  sI: '0x0901000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  sJ: '0x0a01000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  sK: '0x0b01000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  sL: '0x0c01000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  sM: '0x0d01000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  sN: '0x0e01000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  // Destinations for cascade follow-ups.
  bscDest: '0xbcbc000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  sepoliaDest: '0x5e5e000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  solanaDest: '0x5a5a000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  // Refund txs on Push Chain.
  pcRefundA: '0xfa01000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  pcRefundB: '0xfb01000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  pcRevertA: '0xfc01000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
};

const SUB_TX = '0x1111111111111111111111111111111111111111111111111111111111111111' as `0x${string}`;
const SUB_TX_2 = '0x2222222222222222222222222222222222222222222222222222222222222222' as `0x${string}`;
const SUB_TX_3 = '0x3333333333333333333333333333333333333333333333333333333333333333' as `0x${string}`;
const UTX_A = '0xabcd000000000000000000000000000000000000000000000000000000000001' as `0x${string}`;

// ── Fixture types ─────────────────────────────────────────────────────

export type LogSpec = {
  event: EventDef;
  args: Record<string, unknown>;
  address: `0x${string}`;
  logIndex: number;
};

export type ReceiptEntry = {
  txHash: `0x${string}`;
  chain: CHAIN;
  to: `0x${string}`;
  logs: LogSpec[];
};

export type UtxRecordFixture = {
  /** 32-byte hex id (no 0x prefix) or prefix; matcher lowercases and strips. */
  id: string;
  record: Record<string, unknown> | null;
};

export type ExpectedCascade = {
  outboundCount?: number;
  refundCount?: number;
  childInboundCount?: number;
  totalFlatNodes?: number;
  rootKind?: UniversalTxKind;
  /** For each outbound edge, the destinationChain CAIP (order-insensitive). */
  outboundDestinations?: string[];
};

export type ScenarioFixture = {
  id: string;
  name: string;
  kind: UniversalTxKind;
  chain: CHAIN;
  txHash: `0x${string}`;
  to: `0x${string}`;
  logs: LogSpec[];
  /** Additional receipts the cascade walker will fetch when recursing. */
  extraReceipts?: ReceiptEntry[];
  /** Cosmos utx records keyed by id (hex without 0x prefix). */
  utxRecords?: UtxRecordFixture[];
  expectedDecoded?: Partial<DecodedIdentifiers>;
  expectedClassifyAll?: UniversalTxKind[];
  expectedCascade?: ExpectedCascade;
};

// ── Derived helpers ───────────────────────────────────────────────────

export function matchingLogsForFixture(f: ScenarioFixture): MatchingLog[] {
  return f.logs.map((l) => ({
    eventName: l.event.name,
    address: l.address,
    logIndex: l.logIndex,
    args: l.args,
  }));
}

export function receiptForFixture(f: ScenarioFixture): TransactionReceipt {
  const built = f.logs.map((l) =>
    buildLog(l.event, l.args, l.address, l.logIndex, f.txHash)
  );
  return buildReceipt(built, f.to, f.txHash);
}

export function receiptForExtra(r: ReceiptEntry): TransactionReceipt {
  const built = r.logs.map((l) =>
    buildLog(l.event, l.args, l.address, l.logIndex, r.txHash)
  );
  return buildReceipt(built, r.to, r.txHash);
}

/**
 * Flatten all utxRecord entries across a scenario and its linked fixtures
 * into a single Map keyed by the lowercased id (no 0x prefix).
 */
export function utxRecordMap(
  fixtures: ScenarioFixture[]
): Map<string, Record<string, unknown> | null> {
  const out = new Map<string, Record<string, unknown> | null>();
  for (const f of fixtures) {
    for (const r of f.utxRecords ?? []) {
      out.set(r.id.toLowerCase().replace(/^0x/, ''), r.record);
    }
  }
  return out;
}

/**
 * Build a Map<txHashLower, TransactionReceipt> covering the primary tx +
 * all extraReceipts across every fixture.
 */
export function receiptMap(
  fixtures: ScenarioFixture[]
): Map<string, TransactionReceipt> {
  const out = new Map<string, TransactionReceipt>();
  for (const f of fixtures) {
    out.set(f.txHash.toLowerCase(), receiptForFixture(f));
    for (const r of f.extraReceipts ?? []) {
      out.set(r.txHash.toLowerCase(), receiptForExtra(r));
    }
  }
  return out;
}

// ── Catalogue ─────────────────────────────────────────────────────────

const REVERT_INSTRUCTION_TUPLE: [
  `0x${string}`,
  `0x${string}`
] = [ADDR.revertTo, '0xcafe'];

const universalTxArgs = (fromCEA: boolean, txType = 2) => ({
  sender: ADDR.sender,
  recipient: ADDR.recipient,
  token: ADDR.token,
  amount: BigInt(1000),
  payload: '0x',
  revertRecipient: ADDR.revertTo,
  txType,
  signatureData: '0x',
  fromCEA,
});

const outboundArgs = (
  subTxId: `0x${string}`,
  chainNamespace: string,
  txType = 3
) => ({
  subTxId,
  sender: ADDR.sender,
  chainNamespace,
  token: ADDR.token,
  recipient: '0xdead',
  amount: BigInt(42),
  gasToken: ADDR.token,
  gasFee: BigInt(3),
  gasLimit: BigInt(100000),
  payload: '0x',
  protocolFee: BigInt(1),
  revertRecipient: ADDR.revertTo,
  txType,
  gasPrice: BigInt(9),
});

// Helper — synthesize the utx record that expandPushOutbounds expects.
function pcUtxRecord(opts: {
  txHash: `0x${string}`;
  outboundTx: Record<string, unknown>[];
  universalStatus?: number;
}) {
  return {
    id: derivePcUniversalTxId(CHAIN.PUSH_TESTNET_DONUT, opts.txHash).slice(2),
    universalStatus: opts.universalStatus ?? 7,
    pcTx: [{ txHash: opts.txHash }],
    outboundTx: opts.outboundTx,
  };
}

function outboundTuple(opts: {
  subTxId: `0x${string}`;
  destinationChain: string;
  externalTxHash?: string;
  outboundStatus?: number;
  pcRefundExecution?: Record<string, unknown>;
  pcRevertExecution?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    id: opts.subTxId.slice(2),
    outboundStatus: opts.outboundStatus ?? 2,
    destinationChain: opts.destinationChain,
    observedTx: opts.externalTxHash
      ? { txHash: opts.externalTxHash, success: true, gasFeeUsed: '100' }
      : { txHash: '', success: false },
    amount: '0',
    recipient: ADDR.recipient,
    pcRefundExecution: opts.pcRefundExecution,
    pcRevertExecution: opts.pcRevertExecution,
  };
}

function refundTx(txHash: `0x${string}`, gasUsed = 100000) {
  return {
    txHash,
    sender: ADDR.sender,
    gasUsed,
    blockHeight: 1,
    status: 'SUCCESS',
    errorMsg: '',
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────

export const SCENARIOS: ScenarioFixture[] = [
  // S-A — INBOUND_FROM_EOA (EOA sends FUNDS to UEA)
  {
    id: 'S-A',
    name: 'INBOUND_FROM_EOA — Sepolia EOA sends FUNDS',
    kind: 'INBOUND_FROM_EOA',
    chain: CHAIN.ETHEREUM_SEPOLIA,
    txHash: HASH.sA,
    to: ADDR.gatewaySepolia,
    logs: [
      {
        event: EVENT_UNIVERSAL_TX,
        args: universalTxArgs(false, 2),
        address: ADDR.gatewaySepolia,
        logIndex: 10,
      },
    ],
    expectedDecoded: { fromCEA: false, txType: 2, txTypeName: 'FUNDS' },
    expectedClassifyAll: ['INBOUND_FROM_EOA'],
  },

  // S-C — INBOUND_FROM_CEA (CEA round-trip inbound)
  {
    id: 'S-C',
    name: 'INBOUND_FROM_CEA — Sepolia CEA round-trip',
    kind: 'INBOUND_FROM_CEA',
    chain: CHAIN.ETHEREUM_SEPOLIA,
    txHash: HASH.sC,
    to: ADDR.gatewaySepolia,
    logs: [
      {
        event: EVENT_UNIVERSAL_TX,
        args: universalTxArgs(true, 1),
        address: ADDR.gatewaySepolia,
        logIndex: 20,
      },
    ],
    expectedDecoded: { fromCEA: true, txTypeName: 'GAS_AND_PAYLOAD' },
    expectedClassifyAll: ['INBOUND_FROM_CEA'],
  },

  // S-D — OUTBOUND_INITIATED (Push root with one EVM outbound)
  {
    id: 'S-D',
    name: 'OUTBOUND_INITIATED — Push root with one OBSERVED outbound to BSC',
    kind: 'OUTBOUND_INITIATED',
    chain: CHAIN.PUSH_TESTNET_DONUT,
    txHash: HASH.sD,
    to: ADDR.pcGateway,
    logs: [
      {
        event: EVENT_UNIVERSAL_TX_OUTBOUND,
        args: outboundArgs(SUB_TX, CHAIN.BNB_TESTNET, 3),
        address: ADDR.pcGateway,
        logIndex: 5,
      },
    ],
    extraReceipts: [
      {
        txHash: HASH.bscDest,
        chain: CHAIN.BNB_TESTNET,
        to: ADDR.vaultBsc,
        logs: [
          {
            event: EVENT_UNIVERSAL_TX_FINALIZED,
            args: {
              subTxId: SUB_TX,
              universalTxId: derivePcUniversalTxId(
                CHAIN.PUSH_TESTNET_DONUT,
                HASH.sD
              ),
              pushAccount: ADDR.uea,
              recipient: ADDR.recipient,
              token: ADDR.token,
              amount: BigInt(42),
              data: '0x',
            },
            address: ADDR.vaultBsc,
            logIndex: 0,
          },
        ],
      },
    ],
    utxRecords: [
      {
        id: derivePcUniversalTxId(CHAIN.PUSH_TESTNET_DONUT, HASH.sD).slice(2),
        record: pcUtxRecord({
          txHash: HASH.sD,
          outboundTx: [
            outboundTuple({
              subTxId: SUB_TX,
              destinationChain: CHAIN.BNB_TESTNET,
              externalTxHash: HASH.bscDest,
              pcRefundExecution: refundTx(HASH.pcRefundA),
            }),
          ],
        }),
      },
      // Refund tx has no utx record of its own (terminal).
      {
        id: derivePcUniversalTxId(CHAIN.PUSH_TESTNET_DONUT, HASH.pcRefundA).slice(
          2
        ),
        record: null,
      },
    ],
    expectedDecoded: { subTxId: SUB_TX, destinationChainNamespace: CHAIN.BNB_TESTNET },
    expectedClassifyAll: ['OUTBOUND_INITIATED'],
    expectedCascade: {
      rootKind: 'OUTBOUND_INITIATED',
      outboundCount: 1,
      refundCount: 1,
      childInboundCount: 0,
      outboundDestinations: [CHAIN.BNB_TESTNET],
      totalFlatNodes: 3, // root + bsc dest + pc-refund
    },
  },

  // S-E — OUTBOUND_FINALIZED (destination Vault finalize with executed sibling)
  {
    id: 'S-E',
    name: 'OUTBOUND_FINALIZED — Sepolia Vault finalize',
    kind: 'OUTBOUND_FINALIZED',
    chain: CHAIN.ETHEREUM_SEPOLIA,
    txHash: HASH.sE,
    to: ADDR.vaultSepolia,
    logs: [
      {
        event: EVENT_UNIVERSAL_TX_FINALIZED,
        args: {
          subTxId: SUB_TX,
          universalTxId: UTX_A,
          pushAccount: ADDR.uea,
          recipient: ADDR.recipient,
          token: ADDR.token,
          amount: BigInt(500),
          data: '0x',
        },
        address: ADDR.vaultSepolia,
        logIndex: 5,
      },
      {
        event: EVENT_UNIVERSAL_TX_EXECUTED,
        args: {
          subTxId: SUB_TX,
          universalTxId: UTX_A,
          pushAccount: ADDR.uea,
          target: ADDR.recipient,
          token: ADDR.token,
          amount: BigInt(500),
          data: '0x',
        },
        address: ADDR.gatewaySepolia,
        logIndex: 6,
      },
    ],
    expectedDecoded: {
      subTxId: SUB_TX,
      universalTxId: UTX_A,
      pushAccount: ADDR.uea,
    },
    expectedClassifyAll: ['OUTBOUND_FINALIZED', 'EXECUTED_ON_DEST'],
  },

  // S-F — OUTBOUND_REVERTED (Vault reverted; pcRevertExecution refund)
  {
    id: 'S-F',
    name: 'OUTBOUND_REVERTED — BSC Vault emitted UniversalTxReverted',
    kind: 'OUTBOUND_REVERTED',
    chain: CHAIN.BNB_TESTNET,
    txHash: HASH.sF,
    to: ADDR.vaultBsc,
    logs: [
      {
        event: EVENT_UNIVERSAL_TX_REVERTED,
        args: {
          subTxId: SUB_TX,
          universalTxId: UTX_A,
          token: ADDR.token,
          amount: BigInt(999),
          revertInstruction: REVERT_INSTRUCTION_TUPLE,
        },
        address: ADDR.vaultBsc,
        logIndex: 3,
      },
    ],
    expectedDecoded: {
      subTxId: SUB_TX,
      universalTxId: UTX_A,
      revertRecipient: ADDR.revertTo,
    },
    expectedClassifyAll: ['OUTBOUND_REVERTED'],
  },

  // S-G — INBOUND_REVERTED (RevertUniversalTx on external chain)
  {
    id: 'S-G',
    name: 'INBOUND_REVERTED — Sepolia RevertUniversalTx',
    kind: 'INBOUND_REVERTED',
    chain: CHAIN.ETHEREUM_SEPOLIA,
    txHash: HASH.sG,
    to: ADDR.gatewaySepolia,
    logs: [
      {
        event: EVENT_REVERT_UNIVERSAL_TX,
        args: {
          subTxId: SUB_TX,
          universalTxId: UTX_A,
          to: ADDR.recipient,
          token: ADDR.token,
          amount: BigInt(1),
          revertInstruction: REVERT_INSTRUCTION_TUPLE,
        },
        address: ADDR.gatewaySepolia,
        logIndex: 12,
      },
    ],
    expectedDecoded: {
      subTxId: SUB_TX,
      universalTxId: UTX_A,
      revertRecipient: ADDR.revertTo,
    },
    expectedClassifyAll: ['INBOUND_REVERTED'],
  },

  // S-H — EXECUTED_ON_DEST (only UniversalTxExecuted log)
  {
    id: 'S-H',
    name: 'EXECUTED_ON_DEST — Destination payload executed',
    kind: 'EXECUTED_ON_DEST',
    chain: CHAIN.BNB_TESTNET,
    txHash: HASH.sH,
    to: ADDR.gatewayBsc,
    logs: [
      {
        event: EVENT_UNIVERSAL_TX_EXECUTED,
        args: {
          subTxId: SUB_TX,
          universalTxId: UTX_A,
          pushAccount: ADDR.uea,
          target: ADDR.recipient,
          token: ADDR.token,
          amount: BigInt(100),
          data: '0xdeadbeef',
        },
        address: ADDR.gatewayBsc,
        logIndex: 0,
      },
    ],
    expectedDecoded: { subTxId: SUB_TX, universalTxId: UTX_A, pushAccount: ADDR.uea },
    expectedClassifyAll: ['EXECUTED_ON_DEST'],
  },

  // S-I — RESCUED_FUNDS (FundsRescued event)
  {
    id: 'S-I',
    name: 'RESCUED_FUNDS — Vault-side FundsRescued',
    kind: 'RESCUED_FUNDS',
    chain: CHAIN.BNB_TESTNET,
    txHash: HASH.sI,
    to: ADDR.vaultBsc,
    logs: [
      {
        event: EVENT_FUNDS_RESCUED,
        args: {
          subTxId: SUB_TX,
          universalTxId: UTX_A,
          token: ADDR.token,
          amount: BigInt(777),
          revertInstruction: REVERT_INSTRUCTION_TUPLE,
        },
        address: ADDR.vaultBsc,
        logIndex: 0,
      },
    ],
    expectedDecoded: { subTxId: SUB_TX, universalTxId: UTX_A },
    expectedClassifyAll: ['RESCUED_FUNDS'],
  },

  // S-J — UNKNOWN (receipt with no universal-tx events)
  {
    id: 'S-J',
    name: 'UNKNOWN — receipt with no universal-tx events',
    kind: 'UNKNOWN',
    chain: CHAIN.BNB_TESTNET,
    txHash: HASH.sJ,
    to: ADDR.gatewayBsc,
    logs: [],
    expectedClassifyAll: [],
  },

  // S-K — PENDING outbound (cascade-only; externalTxHash empty)
  {
    id: 'S-K',
    name: 'PENDING outbound — Push root, outbound not yet observed',
    kind: 'OUTBOUND_INITIATED',
    chain: CHAIN.PUSH_TESTNET_DONUT,
    txHash: HASH.sK,
    to: ADDR.pcGateway,
    logs: [
      {
        event: EVENT_UNIVERSAL_TX_OUTBOUND,
        args: outboundArgs(SUB_TX, CHAIN.BNB_TESTNET, 3),
        address: ADDR.pcGateway,
        logIndex: 0,
      },
    ],
    utxRecords: [
      {
        id: derivePcUniversalTxId(CHAIN.PUSH_TESTNET_DONUT, HASH.sK).slice(2),
        record: pcUtxRecord({
          txHash: HASH.sK,
          universalStatus: 6, // OUTBOUND_PENDING
          outboundTx: [
            outboundTuple({
              subTxId: SUB_TX,
              destinationChain: CHAIN.BNB_TESTNET,
              outboundStatus: 1, // PENDING
              // No externalTxHash → cascade edge has node=null
            }),
          ],
        }),
      },
    ],
    expectedCascade: {
      rootKind: 'OUTBOUND_INITIATED',
      outboundCount: 1,
      refundCount: 0,
      outboundDestinations: [CHAIN.BNB_TESTNET],
      totalFlatNodes: 1, // root only (outbound edge has node=null)
    },
  },

  // S-L — Hash with no utx record (cascade-only)
  {
    id: 'S-L',
    name: 'UNKNOWN + no utx record — cascade root resolves with zero children',
    kind: 'UNKNOWN',
    chain: CHAIN.PUSH_TESTNET_DONUT,
    txHash: HASH.sL,
    to: ADDR.pcGateway,
    logs: [],
    utxRecords: [
      {
        id: derivePcUniversalTxId(CHAIN.PUSH_TESTNET_DONUT, HASH.sL).slice(2),
        record: null,
      },
    ],
    expectedClassifyAll: [],
    expectedCascade: {
      rootKind: 'UNKNOWN',
      outboundCount: 0,
      refundCount: 0,
      childInboundCount: 0,
      totalFlatNodes: 1,
    },
  },

  // S-M — Mixed-destination fan-out (BSC + Sepolia EVM + Solana non-EVM)
  {
    id: 'S-M',
    name: 'Mixed-destination fan-out — BSC + Sepolia + Solana',
    kind: 'OUTBOUND_INITIATED',
    chain: CHAIN.PUSH_TESTNET_DONUT,
    txHash: HASH.sM,
    to: ADDR.pcGateway,
    logs: [
      {
        event: EVENT_UNIVERSAL_TX_OUTBOUND,
        args: outboundArgs(SUB_TX, CHAIN.BNB_TESTNET, 3),
        address: ADDR.pcGateway,
        logIndex: 0,
      },
      {
        event: EVENT_UNIVERSAL_TX_OUTBOUND,
        args: outboundArgs(SUB_TX_2, CHAIN.ETHEREUM_SEPOLIA, 3),
        address: ADDR.pcGateway,
        logIndex: 1,
      },
      {
        event: EVENT_UNIVERSAL_TX_OUTBOUND,
        args: outboundArgs(SUB_TX_3, CHAIN.SOLANA_DEVNET, 3),
        address: ADDR.pcGateway,
        logIndex: 2,
      },
    ],
    extraReceipts: [
      {
        txHash: HASH.bscDest,
        chain: CHAIN.BNB_TESTNET,
        to: ADDR.vaultBsc,
        logs: [], // terminal — no events needed for this scenario's assertions
      },
      {
        txHash: HASH.sepoliaDest,
        chain: CHAIN.ETHEREUM_SEPOLIA,
        to: ADDR.vaultSepolia,
        logs: [],
      },
    ],
    utxRecords: [
      {
        id: derivePcUniversalTxId(CHAIN.PUSH_TESTNET_DONUT, HASH.sM).slice(2),
        record: pcUtxRecord({
          txHash: HASH.sM,
          outboundTx: [
            outboundTuple({
              subTxId: SUB_TX,
              destinationChain: CHAIN.BNB_TESTNET,
              externalTxHash: HASH.bscDest,
            }),
            outboundTuple({
              subTxId: SUB_TX_2,
              destinationChain: CHAIN.ETHEREUM_SEPOLIA,
              externalTxHash: HASH.sepoliaDest,
            }),
            outboundTuple({
              subTxId: SUB_TX_3,
              destinationChain: CHAIN.SOLANA_DEVNET,
              externalTxHash: HASH.solanaDest,
            }),
          ],
        }),
      },
    ],
    expectedCascade: {
      rootKind: 'OUTBOUND_INITIATED',
      outboundCount: 3,
      refundCount: 0,
      outboundDestinations: [
        CHAIN.BNB_TESTNET,
        CHAIN.ETHEREUM_SEPOLIA,
        CHAIN.SOLANA_DEVNET,
      ],
      // root + BSC + Sepolia + Solana (SVM now expands; with no SVM fixture
      // the Solana destination resolves to an empty UNKNOWN node but still
      // contributes a CascadeNode to the flattened list)
      totalFlatNodes: 4,
    },
  },

  // S-N — Fan-out with one delivered + one reverted leg (dual refund edges)
  {
    id: 'S-N',
    name: 'Fan-out delivered + reverted — dual pc-refund/pc-revert edges',
    kind: 'OUTBOUND_INITIATED',
    chain: CHAIN.PUSH_TESTNET_DONUT,
    txHash: HASH.sN,
    to: ADDR.pcGateway,
    logs: [
      {
        event: EVENT_UNIVERSAL_TX_OUTBOUND,
        args: outboundArgs(SUB_TX, CHAIN.BNB_TESTNET, 3),
        address: ADDR.pcGateway,
        logIndex: 0,
      },
      {
        event: EVENT_UNIVERSAL_TX_OUTBOUND,
        args: outboundArgs(SUB_TX_2, CHAIN.BNB_TESTNET, 3),
        address: ADDR.pcGateway,
        logIndex: 1,
      },
    ],
    extraReceipts: [
      {
        txHash: HASH.bscDest,
        chain: CHAIN.BNB_TESTNET,
        to: ADDR.vaultBsc,
        logs: [],
      },
    ],
    utxRecords: [
      {
        id: derivePcUniversalTxId(CHAIN.PUSH_TESTNET_DONUT, HASH.sN).slice(2),
        record: pcUtxRecord({
          txHash: HASH.sN,
          outboundTx: [
            // Delivered leg
            outboundTuple({
              subTxId: SUB_TX,
              destinationChain: CHAIN.BNB_TESTNET,
              externalTxHash: HASH.bscDest,
              outboundStatus: 2, // OBSERVED
              pcRefundExecution: refundTx(HASH.pcRefundA),
            }),
            // Reverted leg
            outboundTuple({
              subTxId: SUB_TX_2,
              destinationChain: CHAIN.BNB_TESTNET,
              externalTxHash: HASH.bscDest,
              outboundStatus: 3, // REVERTED
              pcRevertExecution: refundTx(HASH.pcRevertA, 50000),
            }),
          ],
        }),
      },
      {
        id: derivePcUniversalTxId(CHAIN.PUSH_TESTNET_DONUT, HASH.pcRefundA).slice(
          2
        ),
        record: null,
      },
      {
        id: derivePcUniversalTxId(CHAIN.PUSH_TESTNET_DONUT, HASH.pcRevertA).slice(
          2
        ),
        record: null,
      },
    ],
    expectedCascade: {
      rootKind: 'OUTBOUND_INITIATED',
      outboundCount: 2,
      refundCount: 2,
      outboundDestinations: [CHAIN.BNB_TESTNET, CHAIN.BNB_TESTNET],
      // root + 2 BSC dest nodes (only 1 visited due to cycle dedupe) + 2 refunds
      // The walker visits each unique (chain, txHash) once — both outbound legs
      // point at HASH.bscDest, so the second walk returns null (cycle guard).
      totalFlatNodes: 4,
    },
  },
];

// Re-export derivation helpers so scenario rows + specs share one path.
export { deriveChildUniversalTxId, derivePcUniversalTxId };
