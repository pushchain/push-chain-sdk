/**
 * The public `read(subject, options)` grammar → the internal `BuildReadSpecParams`.
 *
 *   read(user,     { chain })                          native balance (ETH / lamports)
 *   read(user,     { chain, token })                   token balance (ERC-20 / SPL via ATA)
 *   read(contract, { chain, abi, functionName, args }) typed call — abi encodes AND decodes
 *   read(contract, { chain, storageSlot })             storage word
 *   read(url,      { chain: CHAIN.WEB2, web2 })        web2
 *
 * Query keys are mutually exclusive; the namespace decides which are legal.
 */
import type { Abi, Address, Hex, ContractFunctionReturnType, ContractFunctionName, ContractFunctionArgs, ExtractAbiFunctionForArgs } from 'viem';
import { isAddress } from 'viem';
import type { Idl, IdlAccounts } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { accountCoder, detectTokenProgram } from './svm-account';
import { CHAIN, PUSH_NETWORK } from '../constants/enums';
import { computeReadQueryKey, resolveReadCallback } from './registry';
import { READ_NAMESPACE, WEB2_DESTINATION } from '../constants/read-state';
import { resolveDestination } from './destination';
import { deriveAssociatedTokenAddress } from './envelopes/svm';
import { InvalidReadQueryError } from './errors';
import type { BuildReadSpecParams, ReadChain, ReadDestination, ReadLifecycleOptions, ReadQuery, ReadResultShape, Web2Extract } from './read-state.types';
import type { ReadCallback } from './read-state.types';
import type { ProgressEvent } from '../progress-hook/progress-hook.types';

export interface ReadWeb2Options {
  /**
   * 1–16 entries; result values come back in this order. Validators vote on
   * identical extracted bytes. A volatile API may not reach quorum until
   * aggregation modes such as median are supported by the protocol.
   */
  extract: readonly Web2Extract[];
  method?: 'GET' | 'POST';
  /** ⚠ Written to a public event log, forever. */
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
}

interface ReadOptionsInput {
  /** Destination. `CHAIN.WEB2` for https. */
  chain: ReadChain;

  // ── query — which keys are present decides the kind ──
  /** Token balance of `subject`: ERC-20 `balanceOf` on EVM, the SPL ATA on SVM. */
  token?: string;
  /** Anchor account layout; does not execute a Solana instruction. */
  idl?: Idl;
  accountName?: string;
  /** Typed contract call — encodes the call and decodes the result. */
  abi?: Abi;
  functionName?: string;
  args?: readonly unknown[];
  /** EVM storage word. */
  storageSlot?: Hex | bigint;
  /** Web2 only — required when `chain` is web2. */
  web2?: ReadWeb2Options;

  // ── pinning ──
  blockNumber?: bigint;
  minConfirmations?: number;
  expiryBlocks?: bigint;
  maxFee?: bigint;

  // ── callback ──
  callback?: ReadCallback;

  // ── refund ──
  /** ReadSpec.revertRecipient. Default: the sending account. */
  refundTo?: Address;

  // ── lifecycle (read / executeReads / trackRead) ──
  waitForCompletion?: boolean;
  progressHook?: (event: ProgressEvent) => void;
  advanced?: {
    pollingIntervalMs?: number;
    timeout?: number;
    enforceGasCheck?: boolean;
  };
}

type NoQuery = { token?: never; tokenProgram?: never; idl?: never; accountName?: never; abi?: never; functionName?: never; args?: never; storageSlot?: never; web2?: never };
type Query<K extends keyof NoQuery, T> = Omit<NoQuery, K> & T;
type EvmChain = Extract<CHAIN, `eip155:${string}`>;
type SvmChain = Extract<CHAIN, `solana:${string}`>;
export type ReadQueryOptions =
  | ({ chain: EvmChain } & NoQuery)
  | ({ chain: SvmChain } & NoQuery)
  | ({ chain: EvmChain } & Query<'token', { token: string }>)
  | ({ chain: SvmChain } & Query<'token', { token: string }>)
  | ({ chain: SvmChain } & Query<'idl' | 'accountName', { idl: Idl; accountName: string }>)
  | ({ chain: EvmChain } & Query<'abi' | 'functionName' | 'args', { abi: Abi; functionName: string; args?: readonly unknown[] }>)
  | ({ chain: EvmChain } & Query<'storageSlot', { storageSlot: Hex | bigint }>)
  | ({ chain: typeof CHAIN.WEB2 } & Query<'web2', { web2: ReadWeb2Options }>);

export type ReadCallbackOptions = {
  callback?:
    | ({ target: Address; gasLimit: bigint } & Pick<ReadCallback, 'abi' | 'functionName' | 'args'>)
    | { target?: never; gasLimit?: bigint; abi?: never; functionName?: never; args?: never };
};
type SharedPrepareOptions = ReadCallbackOptions &
  Pick<ReadOptionsInput, 'expiryBlocks' | 'maxFee' | 'refundTo'> &
  { advanced?: never; waitForCompletion?: never; progressHook?: never };
type EvmPinningOptions = Pick<ReadOptionsInput, 'blockNumber' | 'minConfirmations'>;
type FinalizedDestinationOptions = { blockNumber?: never; minConfirmations?: never };

/** EVM reads expose pinning; SVM and Web2 choose their finalized/heightless references internally. */
export type ReadPrepareOptions = SharedPrepareOptions & (
  | (Extract<ReadQueryOptions, { chain: EvmChain }> & EvmPinningOptions)
  | (Extract<ReadQueryOptions, { chain: SvmChain | typeof CHAIN.WEB2 }> & FinalizedDestinationOptions)
);
export type ReadExecuteOptions = Pick<ReadOptionsInput, 'advanced' | 'waitForCompletion' | 'progressHook'>;
type WithExecutionOptions<T> = T extends unknown
  ? Omit<T, 'advanced' | 'waitForCompletion' | 'progressHook'> & ReadExecuteOptions
  : never;
export type ReadOptions = WithExecutionOptions<ReadPrepareOptions> & {
  callback?:
    | (Required<Pick<ReadCallback, 'target' | 'gasLimit' | 'abi' | 'functionName'>> & Pick<ReadCallback, 'args'>)
    | { target?: never; gasLimit?: bigint; abi?: never; functionName?: never; args?: never };
};
export type ReadTrackOptions = { advanced?: Omit<NonNullable<ReadOptionsInput['advanced']>, 'enforceGasCheck'>; resultShape?: ReadResultShape };

type Web2Values = { uint256: bigint; int256: bigint; bool: boolean; bytes: Hex; string: string };
type Web2Value<E extends Web2Extract> = Web2Values[E['valueType']];
type ReadFunctionName<A extends Abi, F extends string> = F & ContractFunctionName<A, 'view' | 'pure'>;
type ReadFunctionArgs<O, A extends Abi, F extends string> =
  O extends { args: infer Args extends ContractFunctionArgs<A, 'view' | 'pure', ReadFunctionName<A, F>> } ? Args
    : readonly [] extends ContractFunctionArgs<A, 'view' | 'pure', ReadFunctionName<A, F>> ? readonly []
      : ContractFunctionArgs<A, 'view' | 'pure', ReadFunctionName<A, F>>;
type ReadCallValue<A extends Abi, F extends string, Args extends ContractFunctionArgs<A, 'view' | 'pure', ReadFunctionName<A, F>>> =
  ExtractAbiFunctionForArgs<A, 'view' | 'pure', ReadFunctionName<A, F>, Args> extends infer Selected
    ? Selected extends Abi[number] & { type: 'function'; outputs: readonly unknown[] }
      ? ContractFunctionReturnType<readonly [Selected]>
      : never
    : never;
/** Matches the existing decoder: select the overload by args before wrapping its outputs. */
export type ReadValue<O> = O extends { abi: infer A extends Abi; functionName: infer F extends string }
  ? number extends A['length'] ? readonly unknown[] : ReadCallValue<A, F, ReadFunctionArgs<O, A, F>>
  : O extends { web2: { extract: infer E extends readonly Web2Extract[] } }
    ? { readonly [K in keyof E]: Web2Value<E[K]> }
    : O extends { storageSlot: unknown } ? Hex
    : O extends { idl: infer I extends Idl; accountName: infer N extends string }
      ? N extends keyof IdlAccounts<I> ? IdlAccounts<I>[N] : unknown
      : bigint;

/** Just `balanceOf` — it also types the decoded result as uint256. */
export const ERC20_BALANCE_OF_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const satisfies Abi;

const QUERY_KEYS = ['token', 'abi', 'idl', 'storageSlot', 'web2'] as const;

function queryKind(o: ReadOptionsInput): (typeof QUERY_KEYS)[number] | 'native' {
  if ('tokenProgram' in o) throw new InvalidReadQueryError('tokenProgram is detected from the mint; remove options.tokenProgram');
  if (o.accountName !== undefined && o.idl === undefined) throw new InvalidReadQueryError('accountName requires idl');
  const present = QUERY_KEYS.filter((k) => o[k] !== undefined);
  if (present.length > 1) {
    throw new InvalidReadQueryError(`query keys are mutually exclusive, got ${present.join(' + ')}`);
  }
  if ((o.functionName !== undefined || o.args !== undefined) && o.abi === undefined) {
    throw new InvalidReadQueryError('functionName and args need abi');
  }
  return present[0] ?? 'native';
}

export function toReadDestination(chain: ReadChain): ReadDestination {
  return chain === CHAIN.WEB2 ? WEB2_DESTINATION : { chain };
}

/** Build the internal query from the public grammar. Pure. */
export function toReadQuery(subject: string, o: ReadOptionsInput, resolvedTokenProgram?: PublicKey): ReadQuery {
  const dest = resolveDestination(toReadDestination(o.chain));
  const kind = queryKind(o);

  if (dest.namespace === READ_NAMESPACE.WEB2) {
    if (kind !== 'web2' || !o.web2) throw new InvalidReadQueryError('a web2 read needs the `web2` option and no other query key');
    if (!/^https:\/\//i.test(subject)) throw new InvalidReadQueryError('web2 subject must be an https:// URL');
    return { type: 'http', url: subject, ...o.web2 };
  }
  if (kind === 'web2') throw new InvalidReadQueryError('`web2` is only valid with chain CHAIN.WEB2');

  if (dest.namespace === READ_NAMESPACE.EVM) {
    if (!isAddress(subject)) throw new InvalidReadQueryError(`EVM subject must be an address, got ${subject}`);
    switch (kind) {
      case 'native':
        return { type: 'accountBalance', target: subject };
      case 'token': {
        const token = o.token as string;
        if (!isAddress(token)) throw new InvalidReadQueryError(`token must be an address, got ${token}`);
        return { type: 'contractCall', target: token, abi: ERC20_BALANCE_OF_ABI, functionName: 'balanceOf', args: [subject] };
      }
      case 'abi':
        if (!o.functionName) throw new InvalidReadQueryError('abi needs functionName');
        return { type: 'contractCall', target: subject, abi: o.abi as Abi, functionName: o.functionName, args: o.args };
      case 'storageSlot':
        return { type: 'storageSlot', target: subject, slot: o.storageSlot as Hex | bigint };
      default:
        throw new InvalidReadQueryError(`unsupported query for eip155: ${kind}`);
    }
  }

  // SVM: token-program ownership has already been resolved by the async public path.
  switch (kind) {
    case 'native':
      return { type: 'lamportBalance', account: subject };
    case 'token':
      if (!resolvedTokenProgram) throw new InvalidReadQueryError('Solana token reads need mint-owner resolution; use universal.prepareRead or universal.read');
      return { type: 'splTokenAccount', account: deriveAssociatedTokenAddress(subject, o.token as string, resolvedTokenProgram).toBase58() };
    case 'idl':
      accountCoder(o.idl!, o.accountName!);
      return { type: 'rawAccountData', account: subject, idl: o.idl!, accountName: o.accountName! };
    default:
      throw new InvalidReadQueryError(`unsupported query for solana: ${kind}; use idl and accountName for account-state decoding`);
  }
}

/** Public options → the spec builder's params. Pure; throws `InvalidReadQueryError` on a malformed request. */
export function toBuildReadSpecParams(subject: string, o: ReadOptionsInput, network: PUSH_NETWORK = PUSH_NETWORK.TESTNET_DONUT, resolvedTokenProgram?: PublicKey): BuildReadSpecParams {
  const destination = toReadDestination(o.chain);
  const namespace = resolveDestination(destination).namespace;
  if (namespace !== READ_NAMESPACE.EVM && (o.blockNumber !== undefined || o.minConfirmations !== undefined)) {
    throw new InvalidReadQueryError(`${namespace} reads do not expose blockNumber or minConfirmations; the SDK selects the read reference internally`);
  }
  const query = toReadQuery(subject, o, resolvedTokenProgram);
  const callback = resolveReadCallback(o.callback, network, computeReadQueryKey(destination, query));
  return {
    callback,
    destination,
    query,
    callbackGasLimit: callback.gasLimit,
    refundTo: o.refundTo,
    minConfirmations: o.minConfirmations,
    blockNumber: o.blockNumber,
    expiryBlocks: o.expiryBlocks,
    maxFee: o.maxFee,
  };
}

/** Resolve Solana mint ownership before the otherwise-pure options conversion. */
export async function resolveReadSpecParams(subject: string, o: ReadOptionsInput, network: PUSH_NETWORK, rpcUrls: Partial<Record<CHAIN, string[]>>): Promise<BuildReadSpecParams> {
  const kind = queryKind(o);
  const namespace = resolveDestination(toReadDestination(o.chain)).namespace;
  if (namespace === READ_NAMESPACE.SVM && kind === 'token') {
    new PublicKey(subject);
    const program = await detectTokenProgram(o.token!, o.chain as CHAIN, rpcUrls[o.chain as CHAIN]);
    return toBuildReadSpecParams(subject, o, network, program);
  }
  return toBuildReadSpecParams(subject, o, network);
}

/** Internal offline key helper. Solana token callers must use PreparedRead.queryKey after mint resolution. */
export function getReadQueryKey<const O extends ReadQueryOptions>(subject: string, options: O & ValidateReadCall<O>): Hex {
  return computeReadQueryKey(toReadDestination(options.chain), toReadQuery(subject, options));
}

export function toLifecycleOptions(o?: ReadTrackOptions): ReadLifecycleOptions {
  return {
    pollingIntervalMs: o?.advanced?.pollingIntervalMs,
    timeoutMs: o?.advanced?.timeout,
    resultShape: o?.resultShape,
  };
}

/** Restrict known ABIs to read functions and their declared argument tuple. */
export type ValidateReadCall<O> = O extends { abi: infer A extends Abi; functionName: infer F extends string }
  ? { functionName: ContractFunctionName<A, 'view' | 'pure'> } &
    (readonly [] extends ContractFunctionArgs<A, 'view' | 'pure', F & ContractFunctionName<A, 'view' | 'pure'>>
      ? { args?: ContractFunctionArgs<A, 'view' | 'pure', F & ContractFunctionName<A, 'view' | 'pure'>> }
      : { args: ContractFunctionArgs<A, 'view' | 'pure', F & ContractFunctionName<A, 'view' | 'pure'>> })
  : O extends { idl: infer I extends Idl; accountName: string }
    ? { accountName: NonNullable<I['accounts']>[number]['name'] }
    : unknown;
