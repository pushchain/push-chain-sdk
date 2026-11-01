import { assertNoDuplicateRules } from './duplicates';
import { getAddress, type Address, type Hex } from 'viem';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import type { MultiCall } from '../../orchestrator/orchestrator.types';
import { currentGeneration, verifyFactoryWiring } from '../deployments';
import { deriveWallet, rulesId as computeRulesId } from '../codec/ids';
import { prepareWalletRules } from './prepare';
import { assertLabel } from './label';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import type { AgenticRuntime } from '../runtime';
import type { InternalCreateOptions, CreateResult } from '../agentic.types';
import { Snapshot } from '../reads/snapshot';
import { walletCount } from '../reads/wallets';
import {
  assertCanSign,
  confirmedLogs,
  emitAgentic,
  sendOwnerCalls,
  wrapSendError,
} from './common';

/** One index-bound v6 factory call deploys and grants atomically for EOA/UEA owners. */
export async function createWallet(
  runtime: AgenticRuntime,
  label: string,
  options: InternalCreateOptions
): Promise<CreateResult> {
  const hook = options?.progressHook;
  assertLabel(label);
  if (!options || !Array.isArray(options.rules)) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      'options.rules is required (use [] for a bare wallet)'
    );
  }
  assertCanSign(runtime, 'agentic.create');
  const gen = currentGeneration(runtime.network);
  await verifyFactoryWiring(runtime.reader, gen);

  const owner = runtime.signerPushAccount();
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
  const prepared = await prepareWalletRules(
    runtime,
    gen,
    owner,
    wallet,
    options.rules,
    snap
  );
  assertNoDuplicateRules(prepared);
  const selfTarget = prepared.findIndex((p) =>
    p.nativeTerms?.some((t) => t.target === wallet)
  );
  if (selfTarget >= 0) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      `rules[${selfTarget}].target is the wallet being created; the contracts refuse it as a native target`
    );
  }
  emitAgentic(
    runtime,
    hook,
    PROGRESS_HOOK.AGENTIC_TX_101,
    wallet,
    Number(index),
    false
  );

  // A fresh wallet's grant nonce starts at 0 and increments per grant.
  const predictedIds = prepared.map((p, i) =>
    computeRulesId({
      validator: gen.addresses.sessionValidator,
      agent: p.agent,
      grantNonce: BigInt(i),
    })
  );
  if (prepared.length > 8)
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      'create accepts at most eight initial rules'
    );
  const calls: MultiCall[] = [
    {
      to: gen.addresses.factory,
      value: BigInt(0),
      data: gen.contracts.encodeCreateWalletAt(
        owner,
        index,
        wallet,
        label,
        prepared.map((p) => p.session)
      ),
    },
  ];
  emitAgentic(runtime, hook, PROGRESS_HOOK.AGENTIC_TX_102, wallet, 'single');
  let tx;
  try {
    tx = await sendOwnerCalls(runtime, calls, hook);
  } catch (err) {
    const wrapped = atomicCreateFailure(err);
    emitFailure(runtime, hook, wrapped);
    throw wrapped;
  }

  let logs;
  try {
    ({ logs } = await confirmedLogs(runtime, tx));
  } catch (err) {
    const wrapped = atomicCreateFailure(err);
    emitFailure(runtime, hook, wrapped);
    throw wrapped;
  }
  const deployedEv = gen.contracts.parseWalletDeployed(
    logs,
    gen.addresses.factory
  );
  const granted = gen.contracts
    .parseRulesGranted(logs, wallet)
    .map((g) => g.rulesId);
  if (
    deployedEv.length !== 1 ||
    deployedEv[0].wallet !== wallet ||
    deployedEv[0].index !== index
  ) {
    const err = new AgenticError(
      AGENTIC_ERROR_CODE.RECEIPT_MISMATCH,
      `createWallet produced ${
        deployedEv.map((d) => `${d.wallet}#${d.index}`).join(', ') ||
        'no wallet'
      }, expected ${wallet}#${index}; grants targeted ${wallet}`,
      {
        hint: 'The receipt does not describe the requested atomic creation. Inspect the submitted hash before retrying.',
        details: {
          expected: wallet,
          deployed: deployedEv,
          grantedRulesIds: granted,
          txHash: tx.hash,
        },
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
  if (granted.length > 0)
    emitAgentic(runtime, hook, PROGRESS_HOOK.AGENTIC_TX_104, granted);
  emitAgentic(
    runtime,
    hook,
    PROGRESS_HOOK.AGENTIC_TX_199_01,
    'create',
    tx.hash
  );
  return {
    wallet,
    index: Number(index),
    rulesIds: granted as `0x${string}`[],
    tx,
  };
}

function sameIds(a: readonly Hex[], b: readonly Hex[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => x.toLowerCase() === b[i].toLowerCase())
  );
}

function atomicCreateFailure(error: unknown): unknown {
  const wrapped = wrapSendError(error) as { decodedError?: { name?: string } };
  if (
    ['IndexMismatch', 'IntentWalletMismatch'].includes(
      wrapped?.decodedError?.name ?? ''
    )
  )
    return new AgenticError(
      AGENTIC_ERROR_CODE.INDEX_RACE,
      'the predicted wallet slot changed; atomic creation committed nothing',
      {
        cause: wrapped,
        details: {
          committed: false,
          walletDeployed: false,
          grantedRulesIds: [],
        },
      }
    );
  return wrapped;
}

function emitFailure(
  runtime: AgenticRuntime,
  hook: InternalCreateOptions['progressHook'],
  err: unknown
): void {
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
