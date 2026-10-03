import type { Address, Hex } from 'viem';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import type { MultiCall, UniversalTxResponse } from '../../orchestrator/orchestrator.types';
import { AgenticCapability, requireCapability } from '../capabilities';
import { forbiddenTargets, type AgenticGeneration } from '../deployments';
import { rulesId as computeRulesId } from '../codec/ids';
import { isUniversalRule, prepareRules } from '../codec/rules';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import type { AgenticRuntime } from '../runtime';
import type { AgenticHex, AgenticProgressHook, Rule } from '../agentic.types';
import { chainFromHash, readActiveRules, readNativeSpend, type ActiveRule } from '../reads/rules';
import { Snapshot } from '../reads/snapshot';
import {
  assertCanSign,
  assertOwner,
  confirmedLogs,
  emitAgentic,
  sendOwnerCalls,
  wrapSendError,
} from './common';

const MODE_NATIVE = 1;

function existingPairs(active: readonly ActiveRule[], pushChainNamespace: string, exclude: Set<string>) {
  return active
    .filter((r) => !exclude.has(r.rulesId.toLowerCase()))
    .map((r) => ({
      agent: r.agent,
      rulesId: r.rulesId,
      chainNamespace: chainFromHash(r.chainHash, pushChainNamespace) ?? `hash:${r.chainHash}`,
    }));
}

function encodeContext(runtime: AgenticRuntime, gen: AgenticGeneration, owner: Address, wallet: Address) {
  return {
    owner,
    pushChainNamespace: runtime.pushChainNamespace,
    validator: gen.addresses.sessionValidator,
    rulesPolicy: gen.addresses.rulesPolicy,
    capabilities: gen.capabilities,
    nowSeconds: runtime.nowSeconds(),
    forbiddenTargets: forbiddenTargets(gen, wallet),
  };
}

async function finish<T extends { tx: UniversalTxResponse }>(
  runtime: AgenticRuntime,
  hook: AgenticProgressHook | undefined,
  operation: string,
  run: () => Promise<T>
): Promise<T> {
  try {
    const result = await run();
    emitAgentic(runtime, hook, PROGRESS_HOOK.AGENTIC_TX_199_01, operation, result.tx.hash);
    return result;
  } catch (err) {
    const wrapped = wrapSendError(err) as { code?: string; message?: string; decodedError?: unknown };
    emitAgentic(
      runtime,
      hook,
      PROGRESS_HOOK.AGENTIC_TX_199_02,
      operation,
      wrapped?.code ?? 'UNKNOWN',
      wrapped?.message ?? String(err),
      wrapped?.decodedError
    );
    throw wrapped;
  }
}

/** w.rules.add(rules): owner grants on an existing wallet, IDs in input order. */
export async function addRules(
  runtime: AgenticRuntime,
  gen: AgenticGeneration,
  wallet: Address,
  rules: readonly Rule[],
  hook?: AgenticProgressHook
): Promise<{ rulesIds: AgenticHex[]; tx: UniversalTxResponse }> {
  assertCanSign(runtime, 'rules.add');
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, 'rules.add needs at least one rule');
  }
  const snap = await Snapshot.at(runtime.reader);
  const owner = await assertOwner(runtime, gen, wallet, snap);
  const active = await readActiveRules(snap, gen, wallet);
  const prepared = prepareRules(rules, {
    ...encodeContext(runtime, gen, owner, wallet),
    existing: existingPairs(active, runtime.pushChainNamespace, new Set()),
  });
  const nonce = BigInt(
    await snap.read<bigint>(wallet, gen.contracts.abis.wallet, 'grantNonce')
  );
  const predicted = prepared.map((p, i) =>
    computeRulesId({ validator: gen.addresses.sessionValidator, agent: p.agent, grantNonce: nonce + BigInt(i) })
  );
  const calls: MultiCall[] = prepared.map((p) => ({
    to: wallet,
    value: BigInt(0),
    data: gen.contracts.encodeGrantRules(p.session),
  }));
  return finish(runtime, hook, 'rules.add', async () => {
    const tx = await sendOwnerCalls(runtime, calls, hook);
    const { logs } = await confirmedLogs(runtime, tx);
    const granted = gen.contracts.parseRulesGranted(logs, wallet).map((g) => g.rulesId as AgenticHex);
    if (!sameIds(granted, predicted)) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.RECEIPT_MISMATCH,
        'RulesGranted events do not match the requested rules in order (a concurrent grant may have raced)',
        { details: { granted, predicted, txHash: tx.hash } }
      );
    }
    emitAgentic(runtime, hook, PROGRESS_HOOK.AGENTIC_TX_104, granted);
    return { rulesIds: granted, tx };
  });
}

/** Bare revoke (no IDs, empty list, or anything but { all: true }) is refused. */
export function assertRevokeTarget(target: unknown): { all: boolean; ids?: AgenticHex[] } {
  const all = !!target && !Array.isArray(target) && (target as { all?: unknown }).all === true;
  const ids = Array.isArray(target) ? (target as AgenticHex[]) : undefined;
  if (!all && (!ids || ids.length === 0)) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.REVOKE_NEEDS_TARGET,
      'rules.revoke needs explicit rule IDs or { all: true }',
      { hint: 'A bare revoke that wipes every rule is too easy to make by mistake.' }
    );
  }
  return { all, ids };
}

/** w.rules.revoke(ids) / w.rules.revoke({ all: true }). Bare revoke is refused. */
export async function revokeRules(
  runtime: AgenticRuntime,
  gen: AgenticGeneration,
  wallet: Address,
  target: AgenticHex[] | { all: true; progressHook?: AgenticProgressHook } | undefined,
  hook?: AgenticProgressHook
): Promise<UniversalTxResponse> {
  const { all, ids } = assertRevokeTarget(target);
  if (all) hook = (target as { progressHook?: AgenticProgressHook }).progressHook ?? hook;
  assertCanSign(runtime, 'rules.revoke');
  const snap = await Snapshot.at(runtime.reader);
  await assertOwner(runtime, gen, wallet, snap);

  let calls: MultiCall[];
  if (all) {
    calls = [{ to: wallet, value: BigInt(0), data: gen.contracts.encodeRevokeAllRules() }];
  } else {
    const unique = new Set((ids as Hex[]).map((i) => i.toLowerCase()));
    if (unique.size !== (ids as Hex[]).length) {
      throw new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, 'rules.revoke got the same rule ID twice');
    }
    for (const id of ids as Hex[]) {
      const enabled = await snap.read<boolean>(
        gen.addresses.sessionEngine,
        gen.contracts.abis.engine,
        'isPermissionEnabled',
        [id, wallet]
      );
      if (!enabled) {
        throw new AgenticError(AGENTIC_ERROR_CODE.RULE_NOT_FOUND, `rule ${id} is not enabled on ${wallet}`);
      }
    }
    // Several IDs go through one owner `execute` batch so revocation is atomic
    // regardless of signer batching support.
    calls =
      (ids as Hex[]).length === 1
        ? [{ to: wallet, value: BigInt(0), data: gen.contracts.encodeRevokeRules((ids as Hex[])[0]) }]
        : [
            {
              to: wallet,
              value: BigInt(0),
              data: gen.contracts.encodeExecute(
                (ids as Hex[]).map((id) => ({ target: wallet, value: BigInt(0), data: gen.contracts.encodeRevokeRules(id) }))
              ),
            },
          ];
  }
  const result = await finish(runtime, hook, 'rules.revoke', async () => {
    const tx = await sendOwnerCalls(runtime, calls, hook);
    const { logs } = await confirmedLogs(runtime, tx);
    const revoked = gen.contracts.parseRulesRevoked(logs, wallet).map((r) => r.rulesId);
    emitAgentic(runtime, hook, PROGRESS_HOOK.AGENTIC_TX_105, all ? { all: true } : { rulesIds: revoked });
    return { tx };
  });
  return result.tx;
}

/**
 * w.rules.update({ rules: [{ rulesId, rule }] }): for every pair, inside ONE
 * owner `execute` batch: assertSpent(expected) → revokeRules(old) →
 * grantRules(new). Never falls back to sequential sends. An agent spending
 * between the read and inclusion makes the whole batch revert; retry needs a
 * fresh read and a new owner signature. New counters start at zero.
 */
export async function updateRules(
  runtime: AgenticRuntime,
  gen: AgenticGeneration,
  wallet: Address,
  params: { rules: { rulesId: AgenticHex; rule: Rule }[]; progressHook?: AgenticProgressHook }
): Promise<{ rules: { rulesId: AgenticHex; replaced: AgenticHex }[]; tx: UniversalTxResponse }> {
  const hook = params?.progressHook;
  assertCanSign(runtime, 'rules.update');
  if (!params || !Array.isArray(params.rules) || params.rules.length === 0) {
    throw new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, 'rules.update needs at least one { rulesId, rule } pair');
  }
  requireCapability(gen.capabilities, AgenticCapability.OWNER_EXECUTE);
  const oldIds = params.rules.map((p) => p.rulesId.toLowerCase());
  if (new Set(oldIds).size !== oldIds.length) {
    throw new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, 'rules.update names the same old rule twice');
  }

  const snap = await Snapshot.at(runtime.reader);
  const owner = await assertOwner(runtime, gen, wallet, snap);
  const active = await readActiveRules(snap, gen, wallet);
  const byId = new Map(active.map((r) => [r.rulesId.toLowerCase(), r]));

  const assertions: Awaited<ReturnType<typeof readNativeSpend>>[] = [];
  for (const pair of params.rules) {
    const old = byId.get(pair.rulesId.toLowerCase());
    if (!old) {
      throw new AgenticError(AGENTIC_ERROR_CODE.RULE_NOT_FOUND, `rule ${pair.rulesId} is not enabled on ${wallet}`);
    }
    if (old.mode !== MODE_NATIVE || isUniversalRule(pair.rule)) {
      requireCapability(gen.capabilities, AgenticCapability.ASSERT_SPENT_UNIVERSAL_MULTI);
    }
    requireCapability(gen.capabilities, AgenticCapability.ASSERT_SPENT_NATIVE);
    if (old.actionIds.length !== 1) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.RULE_READ_FAILED,
        `rule ${pair.rulesId} has ${old.actionIds.length} native actions; replacing it would need one assertion per action`
      );
    }
    assertions.push(await readNativeSpend(snap, gen, wallet, old));
  }

  const prepared = prepareRules(
    params.rules.map((p) => p.rule),
    {
      ...encodeContext(runtime, gen, owner, wallet),
      existing: existingPairs(active, runtime.pushChainNamespace, new Set(oldIds)),
    }
  );
  const nonce = BigInt(await snap.read<bigint>(wallet, gen.contracts.abis.wallet, 'grantNonce'));
  const predicted = prepared.map((p, i) =>
    computeRulesId({ validator: gen.addresses.sessionValidator, agent: p.agent, grantNonce: nonce + BigInt(i) })
  );

  const batch = params.rules.flatMap((pair, i) => [
    {
      target: gen.addresses.rulesPolicy,
      value: BigInt(0),
      data: gen.contracts.encodeAssertSpentNative(assertions[i].configId, wallet, assertions[i]),
    },
    { target: wallet, value: BigInt(0), data: gen.contracts.encodeRevokeRules(pair.rulesId) },
    { target: wallet, value: BigInt(0), data: gen.contracts.encodeGrantRules(prepared[i].session) },
  ]);
  const call: MultiCall = { to: wallet, value: BigInt(0), data: gen.contracts.encodeExecute(batch) };

  return finish(runtime, hook, 'rules.update', async () => {
    const tx = await sendOwnerCalls(runtime, [call], hook);
    const { logs } = await confirmedLogs(runtime, tx);
    const granted = gen.contracts.parseRulesGranted(logs, wallet).map((g) => g.rulesId as AgenticHex);
    const revoked = gen.contracts.parseRulesRevoked(logs, wallet).map((r) => r.rulesId.toLowerCase());
    if (!sameIds(granted, predicted) || !sameIds(revoked as Hex[], oldIds as Hex[])) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.RECEIPT_MISMATCH,
        'rules.update receipt does not show the expected revoke/grant pairs',
        { details: { granted, predicted, revoked, txHash: tx.hash } }
      );
    }
    emitAgentic(runtime, hook, PROGRESS_HOOK.AGENTIC_TX_105, { rulesIds: params.rules.map((p) => p.rulesId) });
    emitAgentic(runtime, hook, PROGRESS_HOOK.AGENTIC_TX_104, granted);
    return {
      tx,
      rules: granted.map((id, i) => ({ rulesId: id, replaced: params.rules[i].rulesId })),
    };
  });
}

function sameIds(a: readonly Hex[], b: readonly Hex[]): boolean {
  return a.length === b.length && a.every((x, i) => x.toLowerCase() === b[i].toLowerCase());
}

/** w.setLabel — PROPOSED; no generation implements an editable label (A07). */
export async function setLabel(
  _runtime: AgenticRuntime,
  gen: AgenticGeneration,
  _wallet: Address,
  label: string
): Promise<never> {
  if (typeof label !== 'string') {
    throw new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, 'label must be a string');
  }
  requireCapability(gen.capabilities, AgenticCapability.SET_LABEL);
  throw new AgenticError(AGENTIC_ERROR_CODE.CAPABILITY_UNAVAILABLE, 'setLabel has no adapter implementation');
}

