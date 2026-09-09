import {
  BaseError,
  ContractFunctionRevertedError,
  encodeAbiParameters,
  encodeFunctionData,
  getAbiItem,
  isAddress,
  type Abi,
  type AbiFunction,
  type Address,
  type Hex,
} from 'viem';
import { UNIVERSAL_CALLBACK_EVM } from '../constants/abi/universalCallback.evm';
import { UEA_FACTORY_ABI } from '../constants/abi/uea-factory';
import { UEA_FACTORY } from '../constants/chain';
import { DEFAULT_EXPIRY_BLOCKS, MIN_CONFIRMATIONS_FLOOR, READ_NAMESPACE } from '../constants/read-state';
import { sizeCallbackBudget } from './budget';
import { encodeReadQuery } from './envelopes';
import { InvalidReadQueryError, InvalidReadSpecError } from './errors';
import { preflightRead, type PreflightDeps } from './preflight';
import type {
  BuildReadSpecParams,
  EncodedReadQuery,
  PreparedRead,
  ReadPreflight,
  ReadSpec,
  ReadSpecTuple,
  SimulateReadResult,
} from './read-state.types';
import { assertValidReadSpec } from './validate';

/** The ReadSpec tuple as the contract declares it — for abi.encode(spec). */
const READ_SPEC_ABI_PARAM = (getAbiItem({ abi: UNIVERSAL_CALLBACK_EVM, name: 'requestExternalReadSelf' }) as AbiFunction).inputs[0];

export interface PrepareReadDeps extends PreflightDeps {
  /** The signer's Push-side account (UEA or EOA). Used when `refundTo` is not given. */
  defaultRefundTo?: Address;
}

function toTuple(spec: ReadSpec): ReadSpecTuple {
  return [
    [spec.account.chainNamespace, spec.account.chainId, spec.account.owner],
    spec.query,
    spec.minConfirmations,
    spec.blockNumber,
    spec.expiryPushChainHeight,
    spec.maxFee,
    spec.revertRecipient,
  ] as const;
}

function encodeSpec(spec: ReadSpec): Hex {
  return encodeAbiParameters([READ_SPEC_ABI_PARAM], [spec as never]);
}

/**
 * Assemble a `PreparedRead` from an already-fetched preflight. Pure — no network.
 * Use directly when preparing several reads from one preflight.
 */
export function buildReadSpecFromPreflight(
  preflight: ReadPreflight,
  params: BuildReadSpecParams,
  defaults: { refundTo?: Address } = {},
): PreparedRead {
  const dest = preflight.destination;
  const isWeb2 = dest.namespace === READ_NAMESPACE.WEB2;
  const minConfirmations = params.minConfirmations ?? MIN_CONFIRMATIONS_FLOOR;

  // --- pin ---
  let blockNumber: bigint;
  if (isWeb2) {
    if (params.blockNumber !== undefined && params.blockNumber !== 0n) {
      throw new InvalidReadQueryError('web2 is heightless: blockNumber must be 0 (or omitted)');
    }
    blockNumber = 0n;
  } else if (params.blockNumber !== undefined) {
    blockNumber = params.blockNumber;
  } else {
    // Back off by minConfirmations: validators hold until latest ≥ blockNumber + minConfirmations,
    // and the oracle height IS roughly latest — pinning at the head would always wait.
    const backed = preflight.observedChainHeight - BigInt(minConfirmations);
    blockNumber = backed >= 1n ? backed : 1n;
  }

  // --- envelope ---
  const encodedQuery: EncodedReadQuery = encodeReadQuery(params.destination, params.query, {
    blockNumber,
    minSlot: dest.namespace === READ_NAMESPACE.SVM ? blockNumber : undefined,
  });

  // --- money ---
  const callbackBudget = params.callbackBudget ?? sizeCallbackBudget(params.callbackGasLimit, preflight.pushGasPrice, params.budgetBuffer);
  const value = preflight.protocolFee + callbackBudget;
  const bps = BigInt(params.maxFeeBufferBps ?? 0);
  const maxFee = params.maxFee ?? value + (value * bps) / 10_000n;

  // --- identities ---
  const refundTo = params.refundTo ?? defaults.refundTo;
  if (!refundTo || !isAddress(refundTo)) {
    throw new InvalidReadSpecError(['ZERO_REVERT_RECIPIENT'], {
      destination: dest.caip2,
      hint: 'Pass refundTo (where unspent budget is pushed). In the SDK it defaults to your Push-side account.',
    });
  }
  let owner: Hex;
  if (dest.namespace === READ_NAMESPACE.SVM) {
    if (!encodedQuery.ownerBytes) throw new InvalidReadQueryError('SVM query did not yield the 32-byte owner');
    if (params.owner !== undefined) throw new InvalidReadQueryError('SVM reads take the account from the query, not `owner`');
    owner = encodedQuery.ownerBytes;
  } else {
    owner = params.owner ?? (refundTo.toLowerCase() as Hex); // validators ignore it for EVM; any non-empty bytes
  }

  const expiryPushChainHeight = params.expiryPushChainHeight ?? preflight.pushBlockNumber + (params.expiryBlocks ?? DEFAULT_EXPIRY_BLOCKS);

  const spec: ReadSpec = {
    account: { chainNamespace: dest.chainNamespace, chainId: dest.chainId, owner },
    query: encodedQuery.encoded,
    minConfirmations,
    blockNumber,
    expiryPushChainHeight,
    maxFee,
    revertRecipient: refundTo,
  };

  assertValidReadSpec({ spec, value, callbackGasLimit: params.callbackGasLimit, preflight });

  return {
    spec,
    specTuple: toTuple(spec),
    encodedSpec: encodeSpec(spec),
    value,
    protocolFee: preflight.protocolFee,
    callbackBudget,
    callbackGasLimit: params.callbackGasLimit,
    encodedQuery,
    preflight,
    warnings: [...encodedQuery.warnings],
  };
}

/**
 * Preflight + build. Adds the `refundTo` advisory: a contract recipient that is not a
 * UEA must have a payable receive() or the refund is forfeited to the admin rescue
 * pool (verified live). UEAs (UEA_EVM / UEA_SVM) always have one.
 */
export async function prepareRead(deps: PrepareReadDeps, params: BuildReadSpecParams): Promise<PreparedRead> {
  const preflight = await preflightRead(deps, params.destination);
  const prepared = buildReadSpecFromPreflight(preflight, params, { refundTo: deps.defaultRefundTo });

  const refundTo = prepared.spec.revertRecipient;
  const code = await deps.pushClient.publicClient.getCode({ address: refundTo });
  // EIP-7702 delegation designator (0xef0100 + delegate): an EOA that batches via the SDK's
  // executor. It receives value like an EOA — refunds to such accounts have landed live.
  const isDelegatedEoa = !!code && code.toLowerCase().startsWith('0xef0100');
  if (code && code !== '0x' && !isDelegatedEoa) {
    const [, isUEA] = await deps.pushClient.readContract<[unknown, boolean]>({
      address: UEA_FACTORY[deps.pushNetwork],
      abi: UEA_FACTORY_ABI,
      functionName: 'getOriginForUEA',
      args: [refundTo],
    });
    if (!isUEA) {
      prepared.warnings.push(
        `refundTo ${refundTo} is a contract that is not a UEA — it must have a payable receive() or the unspent callback budget is forfeited`,
      );
    }
  }
  return prepared;
}

/**
 * Splice the prepared spec into the app's own entrypoint.
 * Default argument order is `(spec, callbackGasLimit)`; pass `args` to remap.
 */
export function toCallData(
  prepared: PreparedRead,
  target: { abi: Abi; functionName: string; args?: (spec: ReadSpecTuple, callbackGasLimit: bigint) => readonly unknown[] },
): { data: Hex; value: bigint } {
  // Positional tuple: viem accepts it whether the app ABI names the struct components or not.
  const args = target.args ? target.args(prepared.specTuple, prepared.callbackGasLimit) : [prepared.specTuple, prepared.callbackGasLimit];
  return {
    data: encodeFunctionData({ abi: target.abi, functionName: target.functionName, args: args as never }),
    value: prepared.value,
  };
}

/**
 * eth_call `requestExternalReadSelf` with `from` = the app contract, so validation
 * reverts surface before broadcast, decoded into the contract's custom errors.
 * Only meaningful for the app-contract persona: `callbackTarget` becomes `msg.sender`.
 */
export async function simulateRead(
  deps: PreflightDeps,
  prepared: PreparedRead,
  opts: { appContract: Address; callbackSelector: Hex; staleAfterMs?: number },
): Promise<SimulateReadResult> {
  const age = Date.now() - prepared.preflight.fetchedAt;
  if (age > (opts.staleAfterMs ?? 60_000)) {
    prepared.warnings.push(`preflight is ${Math.round(age / 1000)} s old — pushBlockNumber moves every block; rebuild before sending`);
  }
  try {
    await deps.pushClient.publicClient.simulateContract({
      address: prepared.preflight.universalCallback,
      abi: UNIVERSAL_CALLBACK_EVM,
      functionName: 'requestExternalReadSelf',
      args: [prepared.spec as never, opts.callbackSelector, prepared.callbackGasLimit],
      account: opts.appContract,
      value: prepared.value,
      // In the real flow the app contract forwards the msg.value it just received from the
      // user, so for the simulation it must "hold" it. Without this the node answers
      // "insufficient balance for transfer" — and maps it to JSON-RPC -32602, which viem
      // renders as the misleading "Missing or invalid parameters". Verified on Donut.
      stateOverride: [{ address: opts.appContract, balance: prepared.value * 2n + 10n ** 18n }],
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof BaseError) {
      const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (reverted instanceof ContractFunctionRevertedError && reverted.data) {
        return { ok: false, error: reverted.shortMessage, errorName: reverted.data.errorName, args: reverted.data.args };
      }
      // Surface the node's own reason when viem's summary is generic.
      const details = (err as { details?: string }).details || (err.cause as { details?: string } | undefined)?.details;
      return { ok: false, error: details ? `${err.shortMessage} (${details})` : err.shortMessage };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
