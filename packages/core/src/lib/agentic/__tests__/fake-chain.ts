/**
 * In-memory stand-in for the AGW contract views used by unit tests. It models
 * only what the SDK reads (factory registry/prediction, wallet wiring,
 * engine enumeration, URP mode/native config, checkpoints and logs), so the
 * SDK's own logic — selection, consistency, error mapping — is what is tested.
 * Real-contract behaviour is covered by the local harness (__agw-local__).
 */
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  keccak256,
  toBytes,
  type AbiEvent,
  type Address,
  type Hex,
  type Log,
  type TransactionReceipt,
} from 'viem';
import { PUSH_NETWORK } from '../../constants/enums';
import { v5 } from '../contracts/v5';
import type { ChainReader } from '../contracts/reader';
import { actionId, configId, deriveWallet } from '../codec/ids';
import {
  registerAgenticGeneration,
  resetAgenticGenerations,
  type AgenticGeneration,
} from '../deployments';
import type { NativeConfigRead } from '../contracts/v5';

export const ADDR = {
  factory: getAddress('0x00000000000000000000000000000000000fac70'),
  impl: getAddress('0x00000000000000000000000000000000000001a1'),
  engine: getAddress('0x00000000000000000000000000000000000e0e0e'),
  policy: getAddress('0x0000000000000000000000000000000000000b01'),
  validator: getAddress('0x0000000000000000000000000000000000000a1d'),
  gateway: getAddress('0x00000000000000000000000000000000000000c1'),
  owner: getAddress('0x00000000000000000000000000000000000000a0'),
  agent: getAddress('0x00000000000000000000000000000000000000a9'),
  other: getAddress('0x00000000000000000000000000000000000000b9'),
  target: getAddress('0x0000000000000000000000000000000000007a76'),
};

export const PUSH_NS = 'eip155:42101';
export const SEPOLIA_NS = 'eip155:11155111';

export interface FakeRule {
  rulesId: Hex;
  agent: Address;
  mode: number; // 1 native, 0 universal
  chain: string;
  actionIds: Hex[];
  native?: Partial<NativeConfigRead>;
  universal?: {
    assets: readonly {
      token: Address;
      maxPerCall?: bigint;
      maxTotal?: bigint;
      spent?: bigint;
    }[];
    expectedCEA: Address;
    maxGasPerCall: bigint;
  };
}

export interface FakeWallet {
  address: Address;
  owner: Address;
  index: bigint;
  label: string;
  rules: FakeRule[];
  checkpointCount: bigint;
  grantNonce: bigint;
  accountId?: string;
}

export class FakeChain implements ChainReader {
  policyVersion = '3.1.0';
  sourceTokens = new Map<string, string>();
  block = BigInt(100);
  wallets = new Map<string, FakeWallet>();
  walletCounts = new Map<string, bigint>();
  balances = new Map<string, bigint>();
  checkpointLogs: Log[] = [];
  extraLogs: Log[] = [];
  failOn = new Set<string>();
  calls: { functionName: string; blockNumber?: bigint }[] = [];
  /** Override the factory's prediction (to simulate derivation drift). */
  predictOverride?: (owner: Address, index: bigint) => Address;
  receipts = new Map<string, TransactionReceipt>();

  addWallet(owner: Address, label: string, rules: FakeRule[] = []): FakeWallet {
    const index = this.walletCounts.get(owner.toLowerCase()) ?? BigInt(0);
    const address = deriveWallet({
      factory: ADDR.factory,
      walletImplementation: ADDR.impl,
      owner,
      index,
    });
    const w: FakeWallet = {
      address,
      owner,
      index,
      label,
      rules,
      checkpointCount: BigInt(0),
      grantNonce: BigInt(rules.length),
    };
    this.wallets.set(address.toLowerCase(), w);
    this.walletCounts.set(owner.toLowerCase(), index + BigInt(1));
    this.extraLogs.push(
      log(
        ADDR.factory,
        v5.events.walletDeployed,
        { owner, index, wallet: address },
        { label },
        BigInt(10)
      )
    );
    return w;
  }

  nativeRule(
    agent: Address,
    rulesId: Hex,
    extra: Partial<NativeConfigRead> = {}
  ): FakeRule {
    return {
      rulesId,
      agent,
      mode: 1,
      chain: PUSH_NS,
      actionIds: [actionId(ADDR.target, '0xd09de08a')],
      native: extra,
    };
  }

  async readContract(
    args: Parameters<ChainReader['readContract']>[0]
  ): Promise<unknown> {
    const fn = args.functionName;
    this.calls.push({ functionName: fn, blockNumber: args.blockNumber });
    if (this.failOn.has(fn)) throw new Error(`rpc failure: ${fn}`);
    const a = (args.args ?? []) as readonly unknown[];
    const at = args.address.toLowerCase();
    const wallet = this.wallets.get(at);
    switch (fn) {
      case 'version':
        return this.policyVersion;
      // factory
      case 'walletImplementation':
        return ADDR.impl;
      case 'walletCount':
        return this.walletCounts.get(String(a[0]).toLowerCase()) ?? BigInt(0);
      case 'predictWallet': {
        const [owner, index] = a as [Address, bigint];
        const count = this.walletCounts.get(owner.toLowerCase()) ?? BigInt(0);
        if (index > count) throw new Error('IndexOutOfRange');
        const addr = this.predictOverride
          ? this.predictOverride(owner, index)
          : deriveWallet({
              factory: ADDR.factory,
              walletImplementation: ADDR.impl,
              owner,
              index,
            });
        return [addr, index < count] as const;
      }
      case 'isWallet':
        return this.wallets.has(String(a[0]).toLowerCase());
      case 'indexOf':
        return this.wallets.get(String(a[0]).toLowerCase())?.index ?? BigInt(0);
      // wallet
      case 'factory':
        if (!wallet) throw new Error('no factory()');
        return ADDR.factory;
      case 'label':
        if (!wallet) throw new Error('not a wallet');
        return wallet.label || `AGW ${wallet.index + BigInt(1)}`;
      case 'owner':
        if (!wallet) throw new Error('not a wallet');
        return wallet.owner;
      case 'SESSION_ENGINE':
        return ADDR.engine;
      case 'RULES_POLICY':
        return ADDR.policy;
      case 'SESSION_VALIDATOR':
        return ADDR.validator;
      case 'UNIVERSAL_GATEWAY_PC':
        return ADDR.gateway;
      case 'accountId':
        return wallet?.accountId ?? 'push.agw.1.0.0';
      case 'grantNonce':
        return wallet?.grantNonce ?? BigInt(0);
      case 'checkpointCount':
        return wallet?.checkpointCount ?? BigInt(0);
      case 'agentOf': {
        const r = wallet?.rules.find((x) => x.rulesId === a[0]);
        return r?.agent ?? '0x0000000000000000000000000000000000000000';
      }
      // engine
      case 'getPermissionIDs':
        return (this.wallets.get(String(a[0]).toLowerCase())?.rules ?? []).map(
          (r) => r.rulesId
        );
      case 'isPermissionEnabled': {
        const w = this.wallets.get(String(a[1]).toLowerCase());
        return !!w?.rules.some((r) => r.rulesId === a[0]);
      }
      case 'getEnabledActions': {
        const w = this.wallets.get(String(a[0]).toLowerCase());
        return w?.rules.find((r) => r.rulesId === a[1])?.actionIds ?? [];
      }
      // policy
      case 'getMode': {
        const found = this.findConfig(a[0] as Hex, a[1] as Address);
        if (!found)
          return {
            initialized: false,
            mode: 0,
            vm: 0,
            chainHash: `0x${'00'.repeat(32)}`,
          };
        return {
          initialized: true,
          mode: found.rule.mode,
          vm: 0,
          chainHash: keccak256(toBytes(found.rule.chain)),
        };
      }
      case 'getNativeConfig': {
        const found = this.findConfig(a[0] as Hex, a[1] as Address);
        const n = found?.rule.native ?? {};
        return {
          initialized: !!found,
          validUntil: 2_000_000_000,
          target: ADDR.target,
          selector: '0xd09de08a',
          maxValuePerCall: BigInt(0),
          maxValueTotal: BigInt(0),
          valueSpent: BigInt(0),
          amount: {
            enabled: false,
            offset: 0,
            maxPerCall: BigInt(0),
            maxTotal: BigInt(0),
          },
          amountSpent: BigInt(0),
          maxCalls: 0,
          callsUsed: 0,
          pins: [],
          ...n,
        };
      }
      case 'getConfig': {
        const found = this.findConfig(a[0] as Hex, a[1] as Address);
        const u = found?.rule.universal;
        return {
          initialized: !!found,
          validUntil: 2_000_000_000,
          expectedCEA: u?.expectedCEA ?? ADDR.other,
          assets: (u?.assets ?? [{ token: ADDR.target }]).map((a) => ({
            maxPerCall: BigInt(1000),
            maxTotal: BigInt(10000),
            spent: BigInt(0),
            ...a,
          })),
          maxGasPerCall: u?.maxGasPerCall ?? BigInt(0),
          allowedCalls: [
            {
              target: ADDR.target,
              selector: '0xd09de08a',
              beneficiaryOffset: 0,
              hasBeneficiary: false,
              maxValue: BigInt(0),
            },
          ],
        };
      }
      case 'SOURCE_CHAIN_NAMESPACE':
        return SEPOLIA_NS;
      case 'SOURCE_TOKEN_ADDRESS':
        return (
          this.sourceTokens.get(args.address.toLowerCase()) ?? args.address
        );
      case 'gasTokenPRC20ByChainNamespace':
        return getAddress('0x0000000000000000000000000000000000007070');
      case 'balanceOf':
      case 'allowance':
        return this.balances.get(`${fn}:${at}`) ?? BigInt(0);
      default:
        throw new Error(`FakeChain: unhandled ${fn}`);
    }
  }

  private findConfig(id: Hex, account: Address) {
    const w = this.wallets.get(account.toLowerCase());
    if (!w) return undefined;
    for (const rule of w.rules) {
      for (const action of rule.actionIds) {
        if (configId(w.address, rule.rulesId, action) === id)
          return { rule, action };
      }
    }
    return undefined;
  }

  async getBlockNumber(): Promise<bigint> {
    if (this.failOn.has('getBlockNumber'))
      throw new Error('rpc failure: getBlockNumber');
    return this.block;
  }

  async getCode(args: { address: Address }): Promise<Hex | undefined> {
    return this.wallets.has(args.address.toLowerCase()) ? '0x3d' : undefined;
  }

  async getBalance(args: { address: Address }): Promise<bigint> {
    return this.balances.get(`pc:${args.address.toLowerCase()}`) ?? BigInt(0);
  }

  async getLogs(args: Parameters<ChainReader['getLogs']>[0]): Promise<Log[]> {
    if (this.failOn.has('getLogs')) throw new Error('rpc failure: getLogs');
    return [...this.checkpointLogs, ...this.extraLogs].filter(
      (l) =>
        l.address.toLowerCase() === args.address.toLowerCase() &&
        BigInt(l.blockNumber ?? BigInt(0)) >= args.fromBlock &&
        BigInt(l.blockNumber ?? BigInt(0)) <= args.toBlock
    );
  }

  async getTransactionReceipt(args: {
    hash: Hex;
  }): Promise<TransactionReceipt> {
    const r = this.receipts.get(args.hash);
    if (!r) throw new Error(`no receipt ${args.hash}`);
    return r;
  }
}

let logIndex = 0;
export function log(
  address: Address,
  event: AbiEvent,
  indexed: Record<string, unknown>,
  data: Record<string, unknown>,
  blockNumber: bigint,
  txHash: Hex = `0x${'ab'.repeat(32)}`,
  transactionIndex = 0
): Log {
  const topics = encodeEventTopics({
    abi: [event],
    eventName: event.name,
    args: indexed,
  } as never);
  const nonIndexed = event.inputs.filter((i) => !('indexed' in i && i.indexed));
  return {
    address,
    topics: topics as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      nonIndexed,
      nonIndexed.map((i) => data[i.name as string]) as never
    ),
    blockNumber,
    transactionHash: txHash,
    transactionIndex,
    logIndex: logIndex++,
    blockHash: `0x${'cd'.repeat(32)}`,
    removed: false,
  } as Log;
}

export function checkpointLog(
  wallet: Address,
  seq: number,
  kind: number,
  block: bigint,
  txIndex = 0
): Log {
  return log(
    wallet,
    v5.events.checkpointed,
    { seq: BigInt(seq) },
    { kind, ref: `0x${'11'.repeat(32)}`, blockNumber: block },
    block,
    `0x${seq.toString(16).padStart(64, '0')}`,
    txIndex
  );
}

export function registerFakeGeneration(
  network: PUSH_NETWORK = PUSH_NETWORK.TESTNET_DONUT
): AgenticGeneration {
  resetAgenticGenerations();
  return registerAgenticGeneration({
    id: 'v5',
    sourceCommit: '2e61e133e641b4e0e1ddbdc9306b0903b60e4dbb',
    network,
    advertised: false,
    addresses: {
      factory: ADDR.factory,
      walletImplementation: ADDR.impl,
      sessionEngine: ADDR.engine,
      rulesPolicy: ADDR.policy,
      sessionValidator: ADDR.validator,
      gateway: ADDR.gateway,
    },
    startBlock: BigInt(1),
    accountId: 'push.agw.1.0.0',
  });
}

export function ruleId(n: number): Hex {
  return `0x${n.toString(16).padStart(64, '0')}`;
}
