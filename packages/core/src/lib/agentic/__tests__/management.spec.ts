import { decodeFunctionData, type Hex, type Log } from 'viem';
import { PUSH_NETWORK } from '../../constants/enums';
import { PushChainBatchExecutionError } from '../../orchestrator/internals/errors';
import type { MultiCall } from '../../orchestrator/orchestrator.types';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import { AgenticCapability } from '../capabilities';
import { currentGeneration, resetAgenticGenerations } from '../deployments';
import { AGW_ABI, UNIVERSAL_RULES_POLICY_ABI } from '../contracts/abi/e704d5b';
import { e704d5b } from '../contracts/e704d5b';
import { deriveWallet, rulesId as computeRulesId } from '../codec/ids';
import { AGENTIC_ERROR_CODE } from '../errors';
import { createWallet } from '../management/create';
import { addRules, revokeRules, updateRules } from '../management/rules-write';
import type { NativeRule } from '../agentic.types';
import { ADDR, FakeChain, PUSH_NS, log, registerFakeGeneration, ruleId } from './fake-chain';
import { fakeResponse, mockRuntime } from './mock-runtime';

const NOW = 1_700_000_000;
const rule = (agent = ADDR.agent): NativeRule => ({ agent, target: ADDR.target, selector: 'increment()', validUntil: NOW + 100 });
const granted = (wallet: `0x${string}`, id: Hex, block = BigInt(101)) =>
  log(wallet, e704d5b.events.rulesGranted, { rulesId: id, chainHash: `0x${'00'.repeat(32)}` }, { mode: 1, chainNamespace: PUSH_NS }, block);
const revoked = (wallet: `0x${string}`, id: Hex) => log(wallet, e704d5b.events.rulesRevoked, { rulesId: id }, {}, BigInt(101));

function withLogs(logs: Log[], over = {}) {
  const r = fakeResponse(over);
  const base = r.wait;
  r.wait = async () => ({ ...(await base()), logs });
  return r;
}

beforeEach(() => registerFakeGeneration());
afterEach(() => resetAgenticGenerations());

describe('agentic.create', () => {
  const nextWallet = deriveWallet({ factory: ADDR.factory, walletImplementation: ADDR.impl, owner: ADDR.owner, index: 0 });
  const ids = [ruleId(0), ruleId(1)].map((_, i) =>
    computeRulesId({ validator: ADDR.validator, agent: i === 0 ? ADDR.agent : ADDR.other, grantNonce: BigInt(i) })
  );

  it('validates first, then sends deploy + grants in input order and returns receipt IDs', async () => {
    const fake = new FakeChain();
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () =>
        withLogs([
          log(ADDR.factory, e704d5b.events.walletDeployed, { owner: ADDR.owner, index: BigInt(0), wallet: nextWallet }, { label: 'ops' }, BigInt(101)),
          granted(nextWallet, ids[0]),
          granted(nextWallet, ids[1]),
        ])) as never,
    });
    const execute = jest.spyOn(rt, 'execute');
    const perCall = jest.fn();
    const res = await createWallet(rt, 'ops', { rules: [rule(), rule(ADDR.other)], progressHook: perCall });
    expect(res).toMatchObject({ wallet: nextWallet, index: 0, rulesIds: ids });
    const calls = (execute.mock.calls[0][0] as { data: MultiCall[] }).data;
    expect(calls.map((c) => c.to)).toEqual([ADDR.factory, nextWallet, nextWallet]);
    expect(decodeFunctionData({ abi: AGW_ABI, data: calls[1].data }).functionName).toBe('grantRules');
    expect(rt.events.map((e) => e.id)).toEqual([
      PROGRESS_HOOK.AGENTIC_TX_101,
      PROGRESS_HOOK.AGENTIC_TX_102,
      PROGRESS_HOOK.AGENTIC_TX_104,
      PROGRESS_HOOK.AGENTIC_TX_199_01,
    ]);
    expect(rt.events.find((e) => e.id === 'AGENTIC-TX-103')).toBeUndefined();
    expect(perCall).toHaveBeenCalledTimes(4);
  });

  it('a bare wallet is one deployWallet call, no funding', async () => {
    const fake = new FakeChain();
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async (p: { to: string; data: Hex; value: bigint }) => {
        expect(p.to).toBe(ADDR.factory);
        expect(p.value).toBe(BigInt(0));
        return withLogs([log(ADDR.factory, e704d5b.events.walletDeployed, { owner: ADDR.owner, index: BigInt(0), wallet: nextWallet }, { label: '' }, BigInt(101))]);
      }) as never,
    });
    expect((await createWallet(rt, '', { rules: [] })).rulesIds).toEqual([]);
  });

  it('invalid input never reaches the signer', async () => {
    const fake = new FakeChain();
    const rt = mockRuntime(fake, { signer: ADDR.owner });
    await expect(createWallet(rt, 'x', { rules: [rule(ADDR.owner)] })).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.AGENT_IS_OWNER });
    await expect(createWallet(rt, 'x', { rules: [rule(), rule()] })).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.DUPLICATE_RULE });
    await expect(createWallet(rt, 'x', undefined as never)).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.INVALID_RULE });
    await expect(createWallet(mockRuntime(fake, { signer: ADDR.owner, readOnly: true }), 'x', { rules: [] })).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.READ_ONLY,
    });
    expect(rt.executeMock).not.toHaveBeenCalled();
  });

  it('a different wallet in the receipt is an INDEX_RACE with full details', async () => {
    const fake = new FakeChain();
    const elsewhere = deriveWallet({ factory: ADDR.factory, walletImplementation: ADDR.impl, owner: ADDR.owner, index: 1 });
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () =>
        withLogs([log(ADDR.factory, e704d5b.events.walletDeployed, { owner: ADDR.owner, index: BigInt(1), wallet: elsewhere }, { label: '' }, BigInt(101))])) as never,
    });
    await expect(createWallet(rt, '', { rules: [] })).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.INDEX_RACE });
  });

  it('IDs that differ from the input order are a RECEIPT_MISMATCH, not a silent reorder', async () => {
    const fake = new FakeChain();
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () =>
        withLogs([
          log(ADDR.factory, e704d5b.events.walletDeployed, { owner: ADDR.owner, index: BigInt(0), wallet: nextWallet }, { label: '' }, BigInt(101)),
          granted(nextWallet, ids[1]),
          granted(nextWallet, ids[0]),
        ])) as never,
    });
    await expect(createWallet(rt, '', { rules: [rule(), rule(ADDR.other)] })).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.RECEIPT_MISMATCH,
    });
  });

  it('a sequential failure after deployment is CREATE_PARTIAL with hashes and granted IDs, never a redeploy', async () => {
    const fake = new FakeChain();
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () => {
        // Deployment and the first grant committed before the failure.
        fake.addWallet(ADDR.owner, 'ops', [fake.nativeRule(ADDR.agent, ids[0])]);
        throw new PushChainBatchExecutionError('grant 2 reverted', [`0x${'01'.repeat(32)}`, `0x${'02'.repeat(32)}`], `0x${'03'.repeat(32)}`);
      }) as never,
    });
    const err = await createWallet(rt, 'ops', { rules: [rule(), rule(ADDR.other)] }).catch((e) => e);
    expect(err.code).toBe(AGENTIC_ERROR_CODE.CREATE_PARTIAL);
    expect(err.details).toMatchObject({
      wallet: nextWallet,
      walletDeployed: true,
      grantedRulesIds: [ids[0]],
      confirmedHashes: [`0x${'01'.repeat(32)}`, `0x${'02'.repeat(32)}`],
      pendingHash: `0x${'03'.repeat(32)}`,
    });
    expect(err.hint).toMatch(/rules\.add/);
    expect(rt.events.at(-1)?.id).toBe(PROGRESS_HOOK.AGENTIC_TX_199_02);
  });

  it('a slot that is already deployed is refused before signing', async () => {
    const fake = new FakeChain();
    fake.predictOverride = (owner, index) => deriveWallet({ factory: ADDR.factory, walletImplementation: ADDR.impl, owner, index });
    const w = fake.addWallet(ADDR.owner, 'a');
    fake.walletCounts.set(ADDR.owner.toLowerCase(), BigInt(0)); // stale count pointing at a deployed slot
    void w;
    const rt = mockRuntime(fake, { signer: ADDR.owner });
    await expect(createWallet(rt, '', { rules: [] })).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.INDEX_RACE });
    expect(rt.executeMock).not.toHaveBeenCalled();
  });
});

describe('rules.add / rules.revoke', () => {
  const gen = () => currentGeneration(PUSH_NETWORK.TESTNET_DONUT);

  it('add: owner-only, duplicate-aware against enabled rules, IDs from the grant nonce', async () => {
    const fake = new FakeChain();
    const w = fake.addWallet(ADDR.owner, 'w', [fake.nativeRule(ADDR.agent, ruleId(1))]);
    w.grantNonce = BigInt(4);
    const expected = computeRulesId({ validator: ADDR.validator, agent: ADDR.other, grantNonce: BigInt(4) });
    const stranger = mockRuntime(fake, { signer: ADDR.other });
    await expect(addRules(stranger, gen(), w.address, [rule(ADDR.other)])).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.NOT_WALLET_OWNER,
    });
    const rt = mockRuntime(fake, { signer: ADDR.owner, execute: (async () => withLogs([granted(w.address, expected)])) as never });
    await expect(addRules(rt, gen(), w.address, [rule(ADDR.agent)])).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.DUPLICATE_RULE,
    });
    expect((await addRules(rt, gen(), w.address, [rule(ADDR.other)])).rulesIds).toEqual([expected]);
  });

  it('add: several rules are one atomic owner execute batch (one signature on any signer)', async () => {
    const fake = new FakeChain();
    const w = fake.addWallet(ADDR.owner, 'w');
    const ids = [ADDR.agent, ADDR.other].map((agent, i) =>
      computeRulesId({ validator: ADDR.validator, agent, grantNonce: BigInt(i) })
    );
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () => withLogs([granted(w.address, ids[0]), granted(w.address, ids[1])])) as never,
    });
    const exec = jest.spyOn(rt, 'execute');
    expect((await addRules(rt, gen(), w.address, [rule(), rule(ADDR.other)])).rulesIds).toEqual(ids);
    const sent = exec.mock.calls[0][0] as { to: string; data: Hex };
    expect(Array.isArray(sent.data)).toBe(false);
    const outer = e704d5b.decodeWalletCall(sent.data) as { kind: string; calls: { target: string; data: Hex }[] };
    expect(outer.kind).toBe('execute');
    expect(outer.calls.map((c) => decodeFunctionData({ abi: AGW_ABI, data: c.data }).functionName)).toEqual(['grantRules', 'grantRules']);
  });

  it('revoke: bare and empty are refused; unknown IDs fail before signing; several IDs are one atomic owner execute', async () => {
    const fake = new FakeChain();
    const w = fake.addWallet(ADDR.owner, 'w', [fake.nativeRule(ADDR.agent, ruleId(1)), fake.nativeRule(ADDR.other, ruleId(2))]);
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () => withLogs([revoked(w.address, ruleId(1)), revoked(w.address, ruleId(2))])) as never,
    });
    const exec = jest.spyOn(rt, 'execute');
    for (const bad of [undefined, [], {}, { all: false }]) {
      await expect(revokeRules(rt, gen(), w.address, bad as never)).rejects.toMatchObject({
        code: AGENTIC_ERROR_CODE.REVOKE_NEEDS_TARGET,
      });
    }
    await expect(revokeRules(rt, gen(), w.address, [ruleId(9)])).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.RULE_NOT_FOUND });
    expect(exec).not.toHaveBeenCalled();
    await revokeRules(rt, gen(), w.address, [ruleId(1), ruleId(2)]);
    const sent = exec.mock.calls[0][0] as { to: string; data: Hex };
    expect(sent.to).toBe(w.address);
    const decoded = e704d5b.decodeWalletCall(sent.data) as { kind: string; calls: { target: string; data: Hex }[] };
    expect(decoded.kind).toBe('execute');
    expect(decoded.calls.map((c) => decodeFunctionData({ abi: AGW_ABI, data: c.data }).functionName)).toEqual(['revokeRules', 'revokeRules']);
    await revokeRules(rt, gen(), w.address, { all: true });
    expect(decodeFunctionData({ abi: AGW_ABI, data: (exec.mock.calls[1][0] as { data: Hex }).data }).functionName).toBe('revokeAllRules');
  });
});

describe('rules.update — one owner batch: assert → revoke → grant', () => {
  const gen = () => currentGeneration(PUSH_NETWORK.TESTNET_DONUT);

  it('builds exactly one execute(batch) with the observed spend asserted per pair', async () => {
    const fake = new FakeChain();
    const w = fake.addWallet(ADDR.owner, 'w', [
      fake.nativeRule(ADDR.agent, ruleId(1), { valueSpent: BigInt(3), amountSpent: BigInt(4), callsUsed: 5 }),
    ]);
    w.grantNonce = BigInt(2);
    const newId = computeRulesId({ validator: ADDR.validator, agent: ADDR.agent, grantNonce: BigInt(2) });
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () => withLogs([revoked(w.address, ruleId(1)), granted(w.address, newId)])) as never,
    });
    const exec = jest.spyOn(rt, 'execute');
    const res = await updateRules(rt, gen(), w.address, { rules: [{ rulesId: ruleId(1), rule: rule() }] });
    expect(res.rules).toEqual([{ rulesId: newId, replaced: ruleId(1) }]);
    expect(exec).toHaveBeenCalledTimes(1);
    const sent = exec.mock.calls[0][0] as { to: string; data: Hex };
    expect(Array.isArray(sent.data)).toBe(false); // never a sequential multi-tx batch
    const outer = e704d5b.decodeWalletCall(sent.data) as { kind: string; mode: Hex; calls: { target: string; data: Hex }[] };
    expect(outer.kind).toBe('execute');
    expect(outer.calls.map((c) => c.target)).toEqual([ADDR.policy, w.address, w.address]);
    const assertion = decodeFunctionData({ abi: UNIVERSAL_RULES_POLICY_ABI, data: outer.calls[0].data });
    expect(assertion.functionName).toBe('assertSpent');
    expect(assertion.args.slice(1)).toEqual([w.address, BigInt(3), BigInt(4), 5]);
    expect(outer.calls.slice(1).map((c) => decodeFunctionData({ abi: AGW_ABI, data: c.data }).functionName)).toEqual([
      'revokeRules',
      'grantRules',
    ]);
  });

  it('replacing a universal rule needs the per-token assertion (A05) and fails before signing', async () => {
    const fake = new FakeChain();
    const w = fake.addWallet(ADDR.owner, 'w', [{ ...fake.nativeRule(ADDR.agent, ruleId(1)), mode: 0, chain: 'eip155:11155111' }]);
    const rt = mockRuntime(fake, { signer: ADDR.owner });
    await expect(updateRules(rt, gen(), w.address, { rules: [{ rulesId: ruleId(1), rule: rule() }] })).rejects.toMatchObject({
      details: { capability: AgenticCapability.ASSERT_SPENT_UNIVERSAL_MULTI },
    });
    expect(rt.executeMock).not.toHaveBeenCalled();
  });

  it('a replacement may reuse the replaced pair but not collide with another enabled rule', async () => {
    const fake = new FakeChain();
    const w = fake.addWallet(ADDR.owner, 'w', [fake.nativeRule(ADDR.agent, ruleId(1)), fake.nativeRule(ADDR.other, ruleId(2))]);
    const rt = mockRuntime(fake, { signer: ADDR.owner });
    await expect(
      updateRules(rt, gen(), w.address, { rules: [{ rulesId: ruleId(1), rule: rule(ADDR.other) }] })
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.DUPLICATE_RULE });
    await expect(
      updateRules(rt, gen(), w.address, { rules: [{ rulesId: ruleId(1), rule: rule() }, { rulesId: ruleId(1), rule: rule() }] })
    ).rejects.toThrow(/same old rule twice/);
    expect(rt.executeMock).not.toHaveBeenCalled();
  });
});
