/**
 * The public `read(subject, options)` grammar → the internal `BuildReadSpecParams`.
 *
 *   read(user,     { chain })                          native balance (ETH / lamports)
 *   read(user,     { chain, token })                   token balance (ERC-20 / SPL via ATA)
 *   read(contract, { chain, abi, functionName, args }) typed call — abi encodes AND decodes (any mutability; eth_call simulation)
 *   read(account,  { chain, idl, functionName? })      Anchor account, layout picked by discriminator
 *   read(program,  { chain, idl, functionName, args }) Anchor PDA — args are its IDL-declared seeds
 *   read(contract, { chain, storageSlot })             storage word
 *   read(url,      { chain: CHAIN.WEB2, web2 })        web2
 *
 * Query keys are mutually exclusive; the namespace decides which are legal.
 */
import type { Abi, AbiStateMutability, Address, Hex, ContractFunctionReturnType, ContractFunctionName, ContractFunctionArgs, ExtractAbiFunctionForArgs } from 'viem';
import { isAddress } from 'viem';
import type { Idl, IdlAccounts } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { detectTokenProgram, resolveAccountName, validateIdl } from './svm-account';
import { deriveIdlPda, isProgramSubject } from './svm-pda';
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
  /**
   * Anchor IDL — the Solana counterpart of `abi`. The subject account is decoded
   * with the layout whose discriminator matches its data. Reads never execute an
   * instruction.
   */
  idl?: Idl;
  /** Typed contract call — encodes the call and decodes the result. */
  abi?: Abi;
  /**
   * With `abi`: the function to call (required). With `idl`: the account layout
   * (optional — inferred from the discriminator; snake_case or camelCase).
   */
  functionName?: string;
  /**
   * With `abi`: positional call args. With `idl` and the program id as subject:
   * the PDA's non-constant seeds, in IDL order.
   */
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
  | ({ chain: SvmChain } & Query<'idl' | 'functionName' | 'args', { idl: Idl; functionName?: string; args?: readonly unknown[] }>)
  | ({ chain: EvmChain } & Query<'abi' | 'functionName' | 'args', { abi: Abi; functionName: string; args?: readonly unknown[] }>)
  | ({ chain: EvmChain } & Query<'storageSlot', { storageSlot: Hex | bigint }>)
  | ({ chain: typeof CHAIN.WEB2 } & Query<'web2', { web2: ReadWeb2Options }>);

export type ReadCallbackOptions = {
  callback?:
    | ({ target: Address; gasLimit?: bigint } & Pick<ReadCallback, 'abi' | 'functionName' | 'args'>)
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
    | (Required<Pick<ReadCallback, 'target' | 'abi' | 'functionName'>> & Pick<ReadCallback, 'gasLimit' | 'args'>)
    | { target?: never; gasLimit?: bigint; abi?: never; functionName?: never; args?: never };
};
export type ReadTrackOptions = { advanced?: Omit<NonNullable<ReadOptionsInput['advanced']>, 'enforceGasCheck'>; resultShape?: ReadResultShape };

type Web2Values = { uint256: bigint; int256: bigint; bool: boolean; bytes: Hex; string: string };
type Web2Value<E extends Web2Extract> = Web2Values[E['valueType']];
type ReadFunctionName<A extends Abi, F extends string> = F & ContractFunctionName<A, AbiStateMutability>;
type ReadFunctionArgs<O, A extends Abi, F extends string> =
  O extends { args: infer Args extends ContractFunctionArgs<A, AbiStateMutability, ReadFunctionName<A, F>> } ? Args
    : readonly [] extends ContractFunctionArgs<A, AbiStateMutability, ReadFunctionName<A, F>> ? readonly []
      : ContractFunctionArgs<A, AbiStateMutability, ReadFunctionName<A, F>>;
type ReadCallValue<A extends Abi, F extends string, Args extends ContractFunctionArgs<A, AbiStateMutability, ReadFunctionName<A, F>>> =
  ExtractAbiFunctionForArgs<A, AbiStateMutability, ReadFunctionName<A, F>, Args> extends infer Selected
    ? Selected extends Abi[number] & { type: 'function'; outputs: readonly unknown[] }
      ? ContractFunctionReturnType<readonly [Selected]>
      : never
    : never;
/** Matches the existing decoder: select the overload by args before wrapping its outputs. */
export type ReadValue<O> = O extends { abi: infer A extends Abi; functionName: infer F extends string }
  // A non-literal ABI: viem returns one output bare and several as an array, so the shape is unknown.
  ? number extends A['length'] ? unknown : ReadCallValue<A, F, ReadFunctionArgs<O, A, F>>
  : O extends { web2: { extract: infer E extends readonly Web2Extract[] } }
    ? { readonly [K in keyof E]: Web2Value<E[K]> }
    : O extends { storageSlot: unknown } ? Hex
    : O extends { idl: infer I extends Idl }
      ? IdlReadValue<I, O extends { functionName: infer N extends string } ? N : undefined>
      : bigint;

/** snake_case / camelCase / PascalCase spellings compare equal (mirrors `idlNameKey`). */
type IdlNameKey<S extends string> = Lowercase<S extends `${infer H}_${infer T}` ? `${H}${IdlNameKey<T>}` : S>;
type IdlAccountName<I extends Idl> = Extract<keyof IdlAccounts<I>, string>;
type MatchAccount<I extends Idl, N extends string> = { [K in IdlAccountName<I>]: IdlNameKey<K> extends IdlNameKey<N> ? K : never }[IdlAccountName<I>];
/** A literal IDL types the account; a dynamic one (names typed `string`) yields `unknown`. */
type IdlReadValue<I extends Idl, N extends string | undefined> =
  string extends IdlAccountName<I> ? unknown
    : N extends string ? IdlAccounts<I>[MatchAccount<I, N>]
      : IdlAccounts<I>[IdlAccountName<I>];

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
  if ('accountName' in o) throw new InvalidReadQueryError('accountName was removed; pass the account layout as functionName (optional — inferred from the discriminator)');
  const present = QUERY_KEYS.filter((k) => o[k] !== undefined);
  if (present.length > 1) {
    throw new InvalidReadQueryError(`query keys are mutually exclusive, got ${present.join(' + ')}`);
  }
  if ((o.functionName !== undefined || o.args !== undefined) && o.abi === undefined && o.idl === undefined) {
    throw new InvalidReadQueryError('functionName and args need abi or idl');
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
      return toIdlAccountQuery(subject, o);
    default:
      throw new InvalidReadQueryError(`unsupported query for solana: ${kind}; use idl for account-state decoding`);
  }
}

/**
 * `idl` → a raw account read that decodes with the IDL. The subject is the account,
 * or the program id when `args` are the seeds of the `functionName` PDA.
 */
function toIdlAccountQuery(subject: string, o: ReadOptionsInput): ReadQuery {
  const idl = o.idl!;
  validateIdl(idl);
  const accountName = o.functionName === undefined ? undefined : resolveAccountName(idl, o.functionName);
  if (isProgramSubject(idl, subject)) {
    if (!o.functionName) throw new InvalidReadQueryError('the subject is the program id: pass functionName (the account layout) and args (its PDA seeds) to derive the account');
    const pda = deriveIdlPda(idl, o.functionName, o.args ?? []);
    return { type: 'rawAccountData', account: pda.toBase58(), idl, accountName };
  }
  if (o.args !== undefined) throw new InvalidReadQueryError('with idl, args are PDA seeds and need the program id as the subject');
  try { new PublicKey(subject); } catch { throw new InvalidReadQueryError(`Solana subject must be a base58 pubkey, got ${subject}`); }
  return { type: 'rawAccountData', account: subject, idl, accountName };
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

/**
 * Restrict known ABIs to declared functions and their argument tuple. Every mutability
 * is allowed: the read is an eth_call simulation, so state-changing functions only return data.
 */
export type ValidateReadCall<O> = O extends { abi: infer A extends Abi; functionName: infer F extends string }
  ? { functionName: ContractFunctionName<A, AbiStateMutability> } &
    (readonly [] extends ContractFunctionArgs<A, AbiStateMutability, F & ContractFunctionName<A, AbiStateMutability>>
      ? { args?: ContractFunctionArgs<A, AbiStateMutability, F & ContractFunctionName<A, AbiStateMutability>> }
      : { args: ContractFunctionArgs<A, AbiStateMutability, F & ContractFunctionName<A, AbiStateMutability>> })
  : O extends { idl: infer I extends Idl; functionName: infer N extends string }
    ? string extends IdlAccountName<I> ? unknown
      : [MatchAccount<I, N>] extends [never] ? { functionName: IdlAccountName<I> } : unknown
    : unknown;
