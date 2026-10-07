import {
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAbiItem,
  getAddress,
  toEventSelector,
  type AbiEvent,
  type Address,
  type Hex,
  type Log,
} from 'viem';
import {
  AGW_ABI,
  AGW_FACTORY_ABI,
  SMART_SESSION_ABI,
  UNIVERSAL_RULES_POLICY_ABI,
} from './abi/v5';
import type { SessionWire } from '../codec/session';
import type { CheckpointKind } from '../agentic.types';
import type { NativeTermsWire } from '../codec/native';
import type { UniversalTermsWire } from '../codec/universal-terms';
import type { SvmTermsWire } from '../codec/svm-terms';

/**
 * Contract adapter for the reviewed v5 ABI generation. All version-
 * sensitive encoding, decoding and view names live here; callers never touch
 * a raw ABI. A future generation gets its own adapter implementing the same
 * interface.
 */

export interface Call {
  target: Address;
  value: bigint;
  data: Hex;
}

export const MODE_SINGLE = `0x${'00'.repeat(32)}` as Hex;
export const MODE_BATCH = `0x01${'00'.repeat(31)}` as Hex;
export const SEND_OUTBOUND_SELECTOR = '0x77b86bec' as const;
export const UEA_MULTICALL_PREFIX = '0x2cc2842d' as const;

const CHECKPOINT_KINDS: readonly CheckpointKind[] = [
  'OWNER_ACTION',
  'RULES_GRANTED',
  'RULES_REVOKED',
];

export interface NativeConfigRead extends NativeTermsWire {
  initialized: boolean;
  valueSpent: bigint;
  amountSpent: bigint;
  callsUsed: number;
}

export interface ModeRead {
  initialized: boolean;
  /** 0 = UNIVERSAL, 1 = NATIVE (RulesType). */
  mode: number;
  /** 0 = EVM, 1 = SVM (VmFamily). */
  vm: number;
  chainHash: Hex;
}

export interface UniversalConfigRead
  extends Omit<UniversalTermsWire, 'assets'> {
  initialized: boolean;
  assets: readonly {
    token: Address;
    maxPerCall: bigint;
    maxTotal: bigint;
    spent: bigint;
  }[];
}

export interface SvmConfigRead extends Omit<SvmTermsWire, 'assets'> {
  initialized: boolean;
  assets: readonly {
    token: Address;
    maxPerCall: bigint;
    maxTotal: bigint;
    spent: bigint;
  }[];
}

export type DecodedWalletCall =
  | { kind: 'execute'; mode: Hex; calls: Call[] }
  | { kind: 'executeAsAgent'; rulesId: Hex; mode: Hex; calls: Call[] }
  | { kind: 'grantRules'; session: SessionWire }
  | { kind: 'revokeRules'; rulesId: Hex }
  | { kind: 'revokeAllRules' };

const EXECUTION_TUPLE = [
  {
    type: 'tuple[]',
    components: [
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'callData', type: 'bytes' },
    ],
  },
] as const;

export const v5 = {
  id: 'v5',
  abis: {
    wallet: AGW_ABI,
    factory: AGW_FACTORY_ABI,
    engine: SMART_SESSION_ABI,
    policy: UNIVERSAL_RULES_POLICY_ABI,
  },
  events: {
    walletDeployed: getAbiItem({
      abi: AGW_FACTORY_ABI,
      name: 'WalletDeployed',
    }) as AbiEvent,
    checkpointed: getAbiItem({
      abi: AGW_ABI,
      name: 'Checkpointed',
    }) as AbiEvent,
    rulesGranted: getAbiItem({
      abi: AGW_ABI,
      name: 'RulesGranted',
    }) as AbiEvent,
    rulesRevoked: getAbiItem({
      abi: AGW_ABI,
      name: 'RulesRevoked',
    }) as AbiEvent,
  },

  // ---------------------------------------------------------------- encoders
  encodeDeployWallet(label: string): Hex {
    return encodeFunctionData({
      abi: AGW_FACTORY_ABI,
      functionName: 'deployWallet',
      args: [label],
    });
  },
  /**
   * Index-bound deployment for an owner calling the factory itself.
   * deployWalletWithSig skips signature checks when msg.sender == intent.owner
   * but still reverts IndexMismatch / IntentWalletMismatch unless the owner's
   * next slot is exactly `index` and predicts to `wallet`. A concurrent
   * creation therefore makes this call revert instead of deploying another
   * slot while later calls in the batch target the predicted address.
   */
  encodeDeployWalletAt(
    owner: Address,
    index: bigint,
    wallet: Address,
    label: string
  ): Hex {
    const zero32 = `0x${'00'.repeat(32)}` as Hex;
    const zeroAddress = '0x0000000000000000000000000000000000000000' as Address;
    return encodeFunctionData({
      abi: AGW_FACTORY_ABI,
      functionName: 'deployWalletWithSig',
      args: [
        {
          owner,
          wallet,
          executor: zeroAddress,
          index,
          sessionHash: zero32,
          mode: zero32,
          execCalldataHash: zero32,
          nonceKey: BigInt(0),
          nonceSeq: BigInt(0),
          grantNonce: BigInt(0),
          deadline: 0,
          signerChainId: BigInt(0),
        },
        '0x',
        label,
      ],
    });
  },
  encodeGrantRules(session: SessionWire): Hex {
    return encodeFunctionData({
      abi: AGW_ABI,
      functionName: 'grantRules',
      args: [session as never],
    });
  },
  encodeRevokeRules(rulesId: Hex): Hex {
    return encodeFunctionData({
      abi: AGW_ABI,
      functionName: 'revokeRules',
      args: [rulesId],
    });
  },
  encodeRevokeAllRules(): Hex {
    return encodeFunctionData({
      abi: AGW_ABI,
      functionName: 'revokeAllRules',
      args: [],
    });
  },
  encodeSetLabel(label: string): Hex {
    return encodeFunctionData({
      abi: AGW_ABI,
      functionName: 'setLabel',
      args: [label],
    });
  },
  /** ERC-7579 single execution calldata: abi.encodePacked(target, value, callData). */
  packSingle(call: Call): Hex {
    return encodePacked(
      ['address', 'uint256', 'bytes'],
      [call.target, call.value, call.data]
    );
  },
  encodeExecute(calls: Call[]): Hex {
    if (calls.length === 0) throw new Error('execute needs at least one call');
    if (calls.length === 1) {
      return encodeFunctionData({
        abi: AGW_ABI,
        functionName: 'execute',
        args: [MODE_SINGLE, v5.packSingle(calls[0])],
      });
    }
    const batch = encodeAbiParameters(EXECUTION_TUPLE, [
      calls.map((c) => ({
        target: c.target,
        value: c.value,
        callData: c.data,
      })),
    ]);
    return encodeFunctionData({
      abi: AGW_ABI,
      functionName: 'execute',
      args: [MODE_BATCH, batch],
    });
  },
  encodeExecuteAsAgent(rulesId: Hex, call: Call): Hex {
    return encodeFunctionData({
      abi: AGW_ABI,
      functionName: 'executeAsAgent',
      args: [rulesId, MODE_SINGLE, v5.packSingle(call)],
    });
  },
  encodeAssertSpentNative(
    configId: Hex,
    wallet: Address,
    expected: { valueSpent: bigint; amountSpent: bigint; callsUsed: number }
  ): Hex {
    return encodeFunctionData({
      abi: UNIVERSAL_RULES_POLICY_ABI,
      functionName: 'assertSpent',
      args: [
        configId,
        wallet,
        expected.valueSpent,
        expected.amountSpent,
        expected.callsUsed,
      ],
    });
  },
  encodeAssertSpentUniversal(
    configId: Hex,
    wallet: Address,
    expectedSpent: readonly bigint[]
  ): Hex {
    return encodeFunctionData({
      abi: UNIVERSAL_RULES_POLICY_ABI,
      functionName: 'assertSpent',
      args: [configId, wallet, expectedSpent],
    });
  },

  // ---------------------------------------------------------------- decoders
  decodeWalletCall(data: Hex): DecodedWalletCall | null {
    let decoded;
    try {
      decoded = decodeFunctionData({ abi: AGW_ABI, data });
    } catch {
      return null;
    }
    switch (decoded.functionName) {
      case 'execute': {
        const [mode, ecd] = decoded.args as readonly [Hex, Hex];
        return { kind: 'execute', mode, calls: unpackExecution(mode, ecd) };
      }
      case 'executeAsAgent': {
        const [rulesId, mode, ecd] = decoded.args as readonly [Hex, Hex, Hex];
        return {
          kind: 'executeAsAgent',
          rulesId,
          mode,
          calls: unpackExecution(mode, ecd),
        };
      }
      case 'grantRules':
        return {
          kind: 'grantRules',
          session: decoded.args[0] as unknown as SessionWire,
        };
      case 'revokeRules':
        return { kind: 'revokeRules', rulesId: decoded.args[0] as Hex };
      case 'revokeAllRules':
        return { kind: 'revokeAllRules' };
      default:
        return null;
    }
  },
  decodeCheckpointKind(kind: number): CheckpointKind {
    const k = CHECKPOINT_KINDS[kind];
    if (!k) throw new Error(`unknown checkpoint kind ${kind}`);
    return k;
  },
  parseWalletDeployed(logs: readonly Log[], factory: Address) {
    return decodeMatching(logs, factory, v5.events.walletDeployed).map(
      (args) => ({
        owner: getAddress(args['owner'] as Address),
        index: BigInt(args['index'] as bigint),
        wallet: getAddress(args['wallet'] as Address),
        label: args['label'] as string,
      })
    );
  },
  parseRulesGranted(logs: readonly Log[], wallet: Address) {
    return decodeMatching(logs, wallet, v5.events.rulesGranted).map((args) => ({
      rulesId: args['rulesId'] as Hex,
      mode: Number(args['mode']),
      chainNamespace: args['chainNamespace'] as string,
    }));
  },
  parseRulesRevoked(logs: readonly Log[], wallet: Address) {
    return decodeMatching(logs, wallet, v5.events.rulesRevoked).map((args) => ({
      rulesId: args['rulesId'] as Hex,
    }));
  },
  parseCheckpointed(logs: readonly Log[], wallet: Address) {
    return logs
      .filter(
        (l) =>
          sameAddress(l.address, wallet) &&
          l.topics[0]?.toLowerCase() ===
            toEventSelector(v5.events.checkpointed).toLowerCase()
      )
      .flatMap((log) => {
        try {
          const ev = decodeEventLog({
            abi: [v5.events.checkpointed],
            ...log,
            strict: true,
          });
          return [{ log, args: ev.args as unknown as Record<string, unknown> }];
        } catch {
          return [];
        }
      })
      .map(({ log, args }) => ({
        seq: Number(args['seq']),
        kind: v5.decodeCheckpointKind(Number(args['kind'])),
        ref: args['ref'] as Hex,
        blockNumber: BigInt(log.blockNumber ?? BigInt(0)),
        txHash: log.transactionHash as Hex,
        logIndex: Number(log.logIndex ?? 0),
        transactionIndex: Number(log.transactionIndex ?? 0),
      }));
  },
};

function unpackExecution(mode: Hex, ecd: Hex): Call[] {
  const callType = mode.slice(2, 4);
  if (callType === '00') {
    const bytes = ecd.slice(2);
    return [
      {
        target: getAddress(`0x${bytes.slice(0, 40)}`),
        value: BigInt(`0x${bytes.slice(40, 104) || '0'}`),
        data: `0x${bytes.slice(104)}` as Hex,
      },
    ];
  }
  if (callType === '01') {
    const [execs] = decodeAbiParameters(EXECUTION_TUPLE, ecd);
    return execs.map((e) => ({
      target: getAddress(e.target),
      value: e.value,
      data: e.callData as Hex,
    }));
  }
  return [];
}

function sameAddress(a: string | null | undefined, b: string): boolean {
  return !!a && a.toLowerCase() === b.toLowerCase();
}

function decodeMatching(
  logs: readonly Log[],
  emitter: Address,
  event: AbiEvent
): Record<string, unknown>[] {
  // viem's decodeEventLog skips the topic0 check when given a one-event ABI,
  // so the event signature is matched explicitly here.
  const topic0 = toEventSelector(event).toLowerCase();
  const out: Record<string, unknown>[] = [];
  for (const log of logs) {
    if (!sameAddress(log.address, emitter)) continue;
    if (log.topics[0]?.toLowerCase() !== topic0) continue;
    try {
      const ev = decodeEventLog({
        abi: [event],
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      out.push(ev.args as unknown as Record<string, unknown>);
    } catch {
      // not this event
    }
  }
  return out;
}

export type AgwContracts = typeof v5;
