/**
 * The public `read(subject, options)` grammar → the internal `BuildReadSpecParams`.
 *
 *   read(user,     { chain })                          native balance (ETH / lamports)
 *   read(user,     { chain, token })                   token balance (ERC-20 / SPL via ATA)
 *   read(contract, { chain, abi, functionName, args }) typed call — abi encodes AND decodes
 *   read(contract, { chain, storageSlot })             storage word
 *   read(url,      { chain: READ_CHAIN_WEB2, web2 })   web2
 *
 * Query keys are mutually exclusive; the namespace decides which are legal.
 */
import type { Abi, Address, Hex } from 'viem';
import { isAddress } from 'viem';
import type { CHAIN } from '../constants/enums';
import { READ_NAMESPACE, WEB2_DESTINATION } from '../constants/read-state';
import { resolveDestination } from './destination';
import { deriveAssociatedTokenAddress, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from './envelopes/svm';
import { InvalidReadQueryError } from './errors';
import type { BuildReadSpecParams, ReadDestination, ReadLifecycleOptions, ReadQuery, ReadResultShape, Web2Extract } from './read-state.types';
import type { ReadCallback } from './read-state.types';
import type { ProgressEvent } from '../progress-hook/progress-hook.types';

/** Web2 is not a `CHAIN` member; this is the destination string the node routes on. */
export const READ_CHAIN_WEB2 = 'web2:https' as const;
export type ReadChain = CHAIN | typeof READ_CHAIN_WEB2;

export interface ReadWeb2Options {
  /** 1–16 entries; result values come back in this order. */
  extract: readonly Web2Extract[];
  method?: 'GET' | 'POST';
  /** ⚠ Written to a public event log, forever. */
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
}

export interface ReadOptions {
  /** Destination. `READ_CHAIN_WEB2` for https. */
  chain: ReadChain;

  // ── query — which keys are present decides the kind ──
  /** Token balance of `subject`: ERC-20 `balanceOf` on EVM, the SPL ATA on SVM. */
  token?: string;
  /** Solana token balance only. Defaults to the original SPL Token program. */
  tokenProgram?: 'spl-token' | 'token-2022';
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

export type ReadTrackOptions = Pick<ReadOptions, 'advanced'> & { resultShape?: ReadResultShape };
/** Defaults to waiting for all reads. Sequential fallback may produce multiple Push txs. */
export type ReadExecuteOptions = Pick<ReadOptions, 'advanced' | 'waitForCompletion' | 'progressHook'>;

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

const QUERY_KEYS = ['token', 'abi', 'storageSlot', 'web2'] as const;

function queryKind(o: ReadOptions): (typeof QUERY_KEYS)[number] | 'native' {
  const present = QUERY_KEYS.filter((k) => o[k] !== undefined);
  if (present.length > 1) {
    throw new InvalidReadQueryError(`query keys are mutually exclusive, got ${present.join(' + ')}`);
  }
  if (o.functionName !== undefined && o.abi === undefined) {
    throw new InvalidReadQueryError('functionName needs abi');
  }
  return present[0] ?? 'native';
}

export function toReadDestination(chain: ReadChain): ReadDestination {
  return chain === READ_CHAIN_WEB2 ? WEB2_DESTINATION : { chain };
}

/** Build the internal query from the public grammar. Pure. */
export function toReadQuery(subject: string, o: ReadOptions): ReadQuery {
  const dest = resolveDestination(toReadDestination(o.chain));
  const kind = queryKind(o);
  if (o.tokenProgram !== undefined && (dest.namespace !== READ_NAMESPACE.SVM || kind !== 'token' || !['spl-token', 'token-2022'].includes(o.tokenProgram))) {
    throw new InvalidReadQueryError('tokenProgram requires a Solana token balance query and must be spl-token or token-2022');
  }

  if (dest.namespace === READ_NAMESPACE.WEB2) {
    if (kind !== 'web2' || !o.web2) throw new InvalidReadQueryError('a web2 read needs the `web2` option and no other query key');
    if (!/^https:\/\//i.test(subject)) throw new InvalidReadQueryError('web2 subject must be an https:// URL');
    return { type: 'http', url: subject, ...o.web2 };
  }
  if (kind === 'web2') throw new InvalidReadQueryError('`web2` is only valid with chain READ_CHAIN_WEB2');

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

  // SVM: the account rides in ReadSpec.account.owner; the ATA is derived here, no network.
  switch (kind) {
    case 'native':
      return { type: 'lamportBalance', account: subject };
    case 'token':
      return { type: 'splTokenAccount', account: deriveAssociatedTokenAddress(subject, o.token as string, o.tokenProgram === 'token-2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID).toBase58() };
    default:
      throw new InvalidReadQueryError(`unsupported query for solana: ${kind} (program reads land with idl support)`);
  }
}

/** Public options → the spec builder's params. Pure; throws `InvalidReadQueryError` on a malformed request. */
export function toBuildReadSpecParams(subject: string, o: ReadOptions): BuildReadSpecParams {
  const gasLimit = o.callback?.gasLimit;
  if (gasLimit === undefined) {
    throw new InvalidReadQueryError('callback.gasLimit is required', {
      hint: 'The canonical UniversalReadRegistry is not deployed yet, so every read targets your own UniversalReadClient: pass callback: { target, gasLimit }.',
    });
  }
  return {
    callback: o.callback,
    destination: toReadDestination(o.chain),
    query: toReadQuery(subject, o),
    callbackGasLimit: gasLimit,
    refundTo: o.refundTo,
    minConfirmations: o.minConfirmations,
    blockNumber: o.blockNumber,
    expiryBlocks: o.expiryBlocks,
    maxFee: o.maxFee,
  };
}

export function toLifecycleOptions(o?: ReadTrackOptions): ReadLifecycleOptions {
  return {
    pollingIntervalMs: o?.advanced?.pollingIntervalMs,
    timeoutMs: o?.advanced?.timeout,
    resultShape: o?.resultShape,
  };
}
