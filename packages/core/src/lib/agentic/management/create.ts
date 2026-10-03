import { getAddress, type Address, type Hex } from 'viem';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import type { MultiCall } from '../../orchestrator/orchestrator.types';
import { PushChainBatchExecutionError } from '../../orchestrator/internals/errors';
import { AgenticCapability, requireCapability } from '../capabilities';
import { currentGeneration, forbiddenTargets, verifyFactoryWiring } from '../deployments';
import { deriveWallet, rulesId as computeRulesId } from '../codec/ids';
import { prepareRules } from '../codec/rules';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import type { AgenticRuntime } from '../runtime';
import type { CreateOptions, CreateResult } from '../agentic.types';
import { Snapshot } from '../reads/snapshot';
import { walletCount } from '../reads/wallets';
import {
  assertCanSign,
  confirmedLogs,
  emitAgentic,
  sendOwnerCalls,
  wrapSendError,
} from './common';

/**
 * client.agentic.create(label, { rules }): deploy + grants only. Funding and
 * approvals are separate ordinary sends. Every input is validated and every
 * prediction re-read immediately before signing; IDs are returned from
 * receipts in input order.
 *
 * Strategy follows the signer: an external owner's UEA batches atomically, a
 * Push EOA uses an EIP-7702 batch when available and otherwise the documented
 * sequential fallback. A sequential failure raises CREATE_PARTIAL with the
 * deployed wallet, confirmed/pending hashes and granted IDs so the caller can
 * finish with `wallet(w).rules.add(remaining)` — the SDK never deploys another
 * wallet on its own.
 */
export async function createWallet(
  runtime: AgenticRuntime,
  label: string,
  options: CreateOptions
): Promise<CreateResult> {
  const hook = options?.progressHook;
  if (typeof label !== 'string') {
    throw new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, 'label must be a string');
  }
  if (!options || !Array.isArray(options.rules)) {
    throw new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, 'options.rules is required (use [] for a bare wallet)');
  }
  assertCanSign(runtime, 'agentic.create');
  const gen = currentGeneration(runtime.network);
  requireCapability(gen.capabilities, AgenticCapability.WALLET_READS);
  await verifyFactoryWiring(runtime.reader, gen);

  const owner = runtime.signerPushAccount();
  const prepared = prepareRules(options.rules, {
    owner,
    pushChainNamespace: runtime.pushChainNamespace,
    validator: gen.addresses.sessionValidator,
    rulesPolicy: gen.addresses.rulesPolicy,
    capabilities: gen.capabilities,
    nowSeconds: runtime.nowSeconds(),
    forbiddenTargets: forbiddenTargets(gen),
  });

  const snap = await Snapshot.at(runtime.reader);
  const index = await walletCount(snap, gen, owner);
  const [predicted, deployed] = await snap.read<readonly [Address, boolean]>(
    gen.addresses.factory,
    gen.contracts.abis.factory,
    'predictWallet',
    [owner, index]
  );
  const wallet = getAddress(predicted);
  const mirror = deriveWallet({
    factory: gen.addresses.factory,
    walletImplementation: gen.addresses.walletImplementation,
    owner,
    index,
  });
  if (wallet !== mirror || deployed || (await snap.code(wallet))) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INDEX_RACE,
      `next wallet slot ${index} for ${owner} is not a fresh counterfactual address`,
      { details: { wallet, mirror, deployed } }
    );
  }
  const selfTarget = prepared.findIndex((p) => p.nativeTerms?.target === wallet);
  if (selfTarget >= 0) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      `rules[${selfTarget}].target is the wallet being created; the contracts refuse it as a native target`
    );
  }
  emitAgentic(runtime, hook, PROGRESS_HOOK.AGENTIC_TX_101, wallet, Number(index), false);

  // A fresh wallet's grant nonce starts at 0 and increments per grant.
  const predictedIds = prepared.map((p, i) =>
    computeRulesId({ validator: gen.addresses.sessionValidator, agent: p.agent, grantNonce: BigInt(i) })
  );
  const calls: MultiCall[] = [
    { to: gen.addresses.factory, value: BigInt(0), data: gen.contracts.encodeDeployWallet(label) },
    ...prepared.map((p) => ({
      to: wallet,
      value: BigInt(0),
      data: gen.contracts.encodeGrantRules(p.session),
    })),
  ];
  const strategy =
    calls.length === 1 ? 'single' : runtime.signerIsPushNative() ? 'push-eoa-batch' : 'uea-multicall';
  emitAgentic(runtime, hook, PROGRESS_HOOK.AGENTIC_TX_102, wallet, strategy);

  let tx;
  try {
    tx = await sendOwnerCalls(runtime, calls, hook);
  } catch (err) {
    const wrapped = await partialCreateError(runtime, gen, wallet, Number(index), err);
    emitFailure(runtime, hook, wrapped);
    throw wrapped;
  }

  let logs;
  try {
    ({ logs } = await confirmedLogs(runtime, tx));
  } catch (err) {
    const wrapped = await partialCreateError(runtime, gen, wallet, Number(index), err);
    emitFailure(runtime, hook, wrapped);
    throw wrapped;
  }
  const deployedEv = gen.contracts.parseWalletDeployed(logs, gen.addresses.factory);
  const granted = gen.contracts.parseRulesGranted(logs, wallet).map((g) => g.rulesId);
  if (deployedEv.length !== 1 || deployedEv[0].wallet !== wallet || deployedEv[0].index !== index) {
    const err = new AgenticError(
      AGENTIC_ERROR_CODE.INDEX_RACE,
      `deployWallet produced ${deployedEv.map((d) => `${d.wallet}#${d.index}`).join(', ') || 'no wallet'}, expected ${wallet}#${index}; grants targeted ${wallet}`,
      {
        hint: 'Another deployment by this owner raced this call. Inspect both wallets with client.agentic.list() before retrying.',
        details: { expected: wallet, deployed: deployedEv, grantedRulesIds: granted, txHash: tx.hash },
      }
    );
    emitFailure(runtime, hook, err);
    throw err;
  }
  if (!sameIds(granted, predictedIds)) {
    const err = new AgenticError(
      AGENTIC_ERROR_CODE.RECEIPT_MISMATCH,
      'RulesGranted events do not match the requested rules in order',
      { details: { granted, predicted: predictedIds, txHash: tx.hash } }
    );
    emitFailure(runtime, hook, err);
    throw err;
  }
  if (granted.length > 0) emitAgentic(runtime, hook, PROGRESS_HOOK.AGENTIC_TX_104, granted);
  emitAgentic(runtime, hook, PROGRESS_HOOK.AGENTIC_TX_199_01, 'create', tx.hash);
  return { wallet, index: Number(index), rulesIds: granted as `0x${string}`[], tx };
}

function sameIds(a: readonly Hex[], b: readonly Hex[]): boolean {
  return a.length === b.length && a.every((x, i) => x.toLowerCase() === b[i].toLowerCase());
}

async function partialCreateError(
  runtime: AgenticRuntime,
  gen: ReturnType<typeof currentGeneration>,
  wallet: Address,
  index: number,
  err: unknown
): Promise<unknown> {
  const wrapped = wrapSendError(err);
  const batch = err instanceof PushChainBatchExecutionError ? err : undefined;
  const hashes = (batch?.transactionHashes ??
    (wrapped as { transactionHashes?: Hex[] }).transactionHashes ??
    []) as Hex[];
  if (hashes.length === 0) return wrapped;
  // Something committed. Re-read chain state rather than trusting the error.
  let walletDeployed = false;
  let grantedRulesIds: Hex[] = [];
  try {
    walletDeployed = !!(await runtime.reader.getCode({ address: wallet }))?.slice(2);
    if (walletDeployed) {
      const snap = await Snapshot.at(runtime.reader);
      grantedRulesIds = [
        ...(await snap.read<readonly Hex[]>(gen.addresses.sessionEngine, gen.contracts.abis.engine, 'getPermissionIDs', [
          wallet,
        ])),
      ];
    }
  } catch {
    // keep what we know; the hashes below are authoritative for retry decisions
  }
  // A reverted atomic transaction committed nothing: report the revert itself.
  if (!batch && !walletDeployed) return wrapped;
  return new AgenticError(
    AGENTIC_ERROR_CODE.CREATE_PARTIAL,
    `agentic.create did not complete: ${(wrapped as Error)?.message ?? String(err)}`,
    {
      hint: walletDeployed
        ? `Wallet ${wallet} is deployed. Do not call create again; finish with client.agentic.wallet('${wallet}').rules.add(<remaining rules>).`
        : 'No wallet was deployed. Check the pending hash (if any) before retrying.',
      details: {
        wallet,
        index,
        walletDeployed,
        grantedRulesIds,
        confirmedHashes: hashes,
        pendingHash: batch?.pendingTransactionHash,
      },
      cause: wrapped,
    }
  );
}

function emitFailure(runtime: AgenticRuntime, hook: CreateOptions['progressHook'], err: unknown): void {
  const e = err as { code?: string; message?: string; decodedError?: unknown };
  emitAgentic(
    runtime,
    hook,
    PROGRESS_HOOK.AGENTIC_TX_199_02,
    'create',
    e?.code ?? 'UNKNOWN',
    e?.message ?? String(err),
    e?.decodedError
  );
}
