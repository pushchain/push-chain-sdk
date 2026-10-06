import {
  decodeFunctionData,
  encodeErrorResult,
  type Hex,
  type Log,
  type TransactionReceipt,
} from 'viem';
import { PUSH_NETWORK } from '../../constants/enums';
import { PushChainBatchExecutionError } from '../../orchestrator/internals/errors';
import type { MultiCall } from '../../orchestrator/orchestrator.types';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import { currentGeneration, resetAgenticGenerations } from '../deployments';
import {
  AGW_ABI,
  AGW_FACTORY_ABI,
  UNIVERSAL_RULES_POLICY_ABI,
} from '../contracts/abi/v4';
import { v4 } from '../contracts/v4';
import { deriveWallet, rulesId as computeRulesId } from '../codec/ids';
import { AGENTIC_ERROR_CODE } from '../errors';
import { createWallet } from '../management/create';
import { addRules, revokeRules, updateRules } from '../management/rules-write';
import type { NativeRule } from '../agentic.types';
import {
  ADDR,
  FakeChain,
  PUSH_NS,
  log,
  registerFakeGeneration,
  ruleId,
} from './fake-chain';
import { fakeResponse, mockRuntime } from './mock-runtime';

const NOW = 1_700_000_000;
const rule = (agent = ADDR.agent): NativeRule => ({
  agent,
  target: ADDR.target,
  selector: 'increment()',
  validUntil: NOW + 100,
});
const granted = (wallet: `0x${string}`, id: Hex, block = BigInt(101)) =>
  log(
    wallet,
    v4.events.rulesGranted,
    { rulesId: id, chainHash: `0x${'00'.repeat(32)}` },
    { mode: 1, chainNamespace: PUSH_NS },
    block
  );
const revoked = (wallet: `0x${string}`, id: Hex) =>
  log(wallet, v4.events.rulesRevoked, { rulesId: id }, {}, BigInt(101));

function withLogs(logs: Log[], over = {}) {
  const r = fakeResponse(over);
  const base = r.wait;
  r.wait = async () => ({ ...(await base()), logs });
  return r;
}

beforeEach(() => registerFakeGeneration());
afterEach(() => resetAgenticGenerations());

describe('agentic.create', () => {
  const nextWallet = deriveWallet({
    factory: ADDR.factory,
    walletImplementation: ADDR.impl,
    owner: ADDR.owner,
    index: 0,
  });
  const ids = [ruleId(0), ruleId(1)].map((_, i) =>
    computeRulesId({
      validator: ADDR.validator,
      agent: i === 0 ? ADDR.agent : ADDR.other,
      grantNonce: BigInt(i),
    })
  );

  it('validates first, then sends deploy + grants in input order and returns receipt IDs', async () => {
    const fake = new FakeChain();
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () =>
        withLogs([
          log(
            ADDR.factory,
            v4.events.walletDeployed,
            { owner: ADDR.owner, index: BigInt(0), wallet: nextWallet },
            { label: 'ops' },
            BigInt(101)
          ),
          granted(nextWallet, ids[0]),
          granted(nextWallet, ids[1]),
        ])) as never,
    });
    const execute = jest.spyOn(rt, 'execute');
    const perCall = jest.fn();
    const res = await createWallet(rt, 'ops', {
      rules: [rule(), rule(ADDR.other)],
      progressHook: perCall,
    });
    expect(res).toMatchObject({ wallet: nextWallet, index: 0, rulesIds: ids });
    const calls = (execute.mock.calls[0][0] as { data: MultiCall[] }).data;
    expect(calls.map((c) => c.to)).toEqual([
      ADDR.factory,
      nextWallet,
      nextWallet,
    ]);
    expect(
      decodeFunctionData({ abi: AGW_ABI, data: calls[1].data }).functionName
    ).toBe('grantRules');
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
        return withLogs([
          log(
            ADDR.factory,
            v4.events.walletDeployed,
            { owner: ADDR.owner, index: BigInt(0), wallet: nextWallet },
            { label: '' },
            BigInt(101)
          ),
        ]);
      }) as never,
    });
    expect((await createWallet(rt, '', { rules: [] })).rulesIds).toEqual([]);
  });

  it('invalid input never reaches the signer', async () => {
    const fake = new FakeChain();
    const rt = mockRuntime(fake, { signer: ADDR.owner });
    await expect(
      createWallet(rt, 'x', { rules: [rule(ADDR.owner)] })
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.AGENT_IS_OWNER });
    await expect(
      createWallet(rt, 'x', undefined as never)
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.INVALID_RULE });
    await expect(
      createWallet(
        mockRuntime(fake, { signer: ADDR.owner, readOnly: true }),
        'x',
        { rules: [] }
      )
    ).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.READ_ONLY,
    });
    expect(rt.executeMock).not.toHaveBeenCalled();
  });
  it('refuses a changed URP version before grant signing', async () => {
    const fake = new FakeChain();
    fake.policyVersion = '3.2.0';
    const rt = mockRuntime(fake, { signer: ADDR.owner });
    await expect(
      createWallet(rt, 'version', { rules: [rule()] })
    ).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.GENERATION_UNSUPPORTED,
    });
    expect(rt.executeMock).not.toHaveBeenCalled();
  });

  it('a different wallet in the receipt is an INDEX_RACE with full details', async () => {
    const fake = new FakeChain();
    const elsewhere = deriveWallet({
      factory: ADDR.factory,
      walletImplementation: ADDR.impl,
      owner: ADDR.owner,
      index: 1,
    });
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () =>
        withLogs([
          log(
            ADDR.factory,
            v4.events.walletDeployed,
            { owner: ADDR.owner, index: BigInt(1), wallet: elsewhere },
            { label: '' },
            BigInt(101)
          ),
        ])) as never,
    });
    await expect(createWallet(rt, '', { rules: [] })).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.INDEX_RACE,
    });
  });

  it('IDs that differ from the input order are a RECEIPT_MISMATCH, not a silent reorder', async () => {
    const fake = new FakeChain();
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () =>
        withLogs([
          log(
            ADDR.factory,
            v4.events.walletDeployed,
            { owner: ADDR.owner, index: BigInt(0), wallet: nextWallet },
            { label: '' },
            BigInt(101)
          ),
          granted(nextWallet, ids[1]),
          granted(nextWallet, ids[0]),
        ])) as never,
    });
    await expect(
      createWallet(rt, '', { rules: [rule(), rule(ADDR.other)] })
    ).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.RECEIPT_MISMATCH,
    });
  });

  const receipt = (logs: Log[], status: 'success' | 'reverted' = 'success') =>
    ({ status, logs } as unknown as TransactionReceipt);

  it('a sequential failure after deployment is CREATE_PARTIAL; what committed comes from this call’s receipts', async () => {
    const fake = new FakeChain();
    const h1 = `0x${'01'.repeat(32)}` as Hex;
    const h2 = `0x${'02'.repeat(32)}` as Hex;
    fake.receipts.set(
      h1,
      receipt([
        log(
          ADDR.factory,
          v4.events.walletDeployed,
          { owner: ADDR.owner, index: BigInt(0), wallet: nextWallet },
          { label: 'ops' },
          BigInt(101)
        ),
      ])
    );
    fake.receipts.set(h2, receipt([granted(nextWallet, ids[0])]));
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () => {
        throw new PushChainBatchExecutionError('grant 2 reverted', [h1, h2]);
      }) as never,
    });
    const err = await createWallet(rt, 'ops', {
      rules: [rule(), rule(ADDR.other)],
    }).catch((e) => e);
    expect(err.code).toBe(AGENTIC_ERROR_CODE.CREATE_PARTIAL);
    expect(err.details).toMatchObject({
      wallet: nextWallet,
      walletDeployed: true,
      grantedRulesIds: [ids[0]],
      confirmedHashes: [h1, h2],
    });
    expect(err.hint).toMatch(/rules\.add/);
    expect(rt.events.at(-1)?.id).toBe(PROGRESS_HOOK.AGENTIC_TX_199_02);
  });

  it('a pending hash keeps an unconfirmed deployment unknown', async () => {
    const fake = new FakeChain();
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () => {
        throw new PushChainBatchExecutionError(
          'timed out',
          [],
          `0x${'03'.repeat(32)}`
        );
      }) as never,
    });
    const err = await createWallet(rt, 'ops', { rules: [rule()] }).catch(
      (e) => e
    );
    expect(err.details).toMatchObject({
      walletDeployed: 'unknown',
      pendingHash: `0x${'03'.repeat(32)}`,
    });
    expect(err.hint).toMatch(/Do not retry/);
  });

  it('failed recovery reads report unknown state, never "not deployed"', async () => {
    const fake = new FakeChain();
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () => {
        fake.addWallet(ADDR.owner, 'committed');
        throw new PushChainBatchExecutionError('grant failed', [
          `0x${'11'.repeat(32)}`,
        ]);
      }) as never,
    });
    const err = await createWallet(rt, 'review', { rules: [rule()] }).catch(
      (e) => e
    );
    expect(err.code).toBe('CREATE_PARTIAL');
    expect(err.details.walletDeployed).toBe('unknown');
    expect(err.details.recoveryError).toBeTruthy();
    expect(err.hint).toMatch(/Do not retry/);
  });

  it('a receipt that cannot be read after submission keeps the hash and reports unknown state', async () => {
    const fake = new FakeChain();
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () => {
        const r = fakeResponse({ hash: `0x${'44'.repeat(32)}` });
        r.wait = async () => {
          throw new Error('rpc down');
        };
        return r;
      }) as never,
    });
    const err = await createWallet(rt, 'x', { rules: [] }).catch((e) => e);
    expect(err.code).toBe(AGENTIC_ERROR_CODE.CREATE_PARTIAL);
    expect(err.details).toMatchObject({
      walletDeployed: 'unknown',
      submitted: { txHash: `0x${'44'.repeat(32)}` },
    });
  });

  it('the deploy is index-bound: a raced slot reverts and is reported as INDEX_RACE with nothing committed', async () => {
    const fake = new FakeChain();
    const raceData = encodeErrorResult({
      abi: AGW_FACTORY_ABI,
      errorName: 'IndexMismatch',
      args: [BigInt(1), BigInt(0)],
    });
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async (p: { data: MultiCall[] }) => {
        const deploy = decodeFunctionData({
          abi: AGW_FACTORY_ABI,
          data: p.data[0].data,
        });
        expect(deploy.functionName).toBe('deployWalletWithSig');
        expect(
          (deploy.args[0] as { index: bigint; wallet: string }).index
        ).toBe(BigInt(0));
        expect((deploy.args[0] as { wallet: string }).wallet).toBe(nextWallet);
        throw new Error(
          `Execution reverted with reason: custom error ${raceData.slice(
            0,
            10
          )}: ${raceData.slice(10)}.`
        );
      }) as never,
    });
    const err = await createWallet(rt, 'x', { rules: [rule()] }).catch(
      (e) => e
    );
    expect(err.code).toBe(AGENTIC_ERROR_CODE.INDEX_RACE);
    expect(err.details).toMatchObject({ committed: false });
  });

  it('a generic send error is still identified as a race when the fresh slot label proves another create won', async () => {
    const fake = new FakeChain();
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () => {
        fake.addWallet(ADDR.owner, 'competing-create');
        throw new Error('opaque sender failure');
      }) as never,
    });
    const err = await createWallet(rt, 'this-create', {
      rules: [rule()],
    }).catch((e) => e);
    expect(err).toMatchObject({
      code: AGENTIC_ERROR_CODE.INDEX_RACE,
      details: {
        wallet: nextWallet,
        index: 0,
        committed: false,
        competingLabel: 'competing-create',
      },
    });
  });

  it('a slot that is already deployed is refused before signing', async () => {
    const fake = new FakeChain();
    fake.predictOverride = (owner, index) =>
      deriveWallet({
        factory: ADDR.factory,
        walletImplementation: ADDR.impl,
        owner,
        index,
      });
    const w = fake.addWallet(ADDR.owner, 'a');
    fake.walletCounts.set(ADDR.owner.toLowerCase(), BigInt(0)); // stale count pointing at a deployed slot
    void w;
    const rt = mockRuntime(fake, { signer: ADDR.owner });
    await expect(createWallet(rt, '', { rules: [] })).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.INDEX_RACE,
    });
    expect(rt.executeMock).not.toHaveBeenCalled();
  });
});

describe('rules.add / rules.revoke', () => {
  const gen = () => currentGeneration(PUSH_NETWORK.TESTNET_DONUT);

  it('add: owner-only, same-agent grants allowed, IDs from the grant nonce', async () => {
    const fake = new FakeChain();
    const w = fake.addWallet(ADDR.owner, 'w', [
      fake.nativeRule(ADDR.agent, ruleId(1)),
    ]);
    w.grantNonce = BigInt(4);
    const expected = computeRulesId({
      validator: ADDR.validator,
      agent: ADDR.agent,
      grantNonce: BigInt(4),
    });
    const stranger = mockRuntime(fake, { signer: ADDR.other });
    await expect(
      addRules(stranger, gen(), w.address, [rule(ADDR.other)])
    ).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.NOT_WALLET_OWNER,
    });
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () => withLogs([granted(w.address, expected)])) as never,
    });
    expect(
      (await addRules(rt, gen(), w.address, [rule(ADDR.agent)])).rulesIds
    ).toEqual([expected]);
  });

  it('add: several rules are one atomic owner execute batch (one signature on any signer)', async () => {
    const fake = new FakeChain();
    const w = fake.addWallet(ADDR.owner, 'w');
    const ids = [ADDR.agent, ADDR.other].map((agent, i) =>
      computeRulesId({
        validator: ADDR.validator,
        agent,
        grantNonce: BigInt(i),
      })
    );
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () =>
        withLogs([
          granted(w.address, ids[0]),
          granted(w.address, ids[1]),
        ])) as never,
    });
    const exec = jest.spyOn(rt, 'execute');
    expect(
      (await addRules(rt, gen(), w.address, [rule(), rule(ADDR.other)]))
        .rulesIds
    ).toEqual(ids);
    const sent = exec.mock.calls[0][0] as { to: string; data: Hex };
    expect(Array.isArray(sent.data)).toBe(false);
    const outer = v4.decodeWalletCall(sent.data) as {
      kind: string;
      calls: { target: string; data: Hex }[];
    };
    expect(outer.kind).toBe('execute');
    expect(
      outer.calls.map(
        (c) => decodeFunctionData({ abi: AGW_ABI, data: c.data }).functionName
      )
    ).toEqual(['grantRules', 'grantRules']);
  });

  it('revoke: bare and empty are refused; unknown IDs fail before signing; several IDs are one atomic owner execute', async () => {
    const fake = new FakeChain();
    const w = fake.addWallet(ADDR.owner, 'w', [
      fake.nativeRule(ADDR.agent, ruleId(1)),
      fake.nativeRule(ADDR.other, ruleId(2)),
    ]);
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () =>
        withLogs([
          revoked(w.address, ruleId(1)),
          revoked(w.address, ruleId(2)),
        ])) as never,
    });
    const exec = jest.spyOn(rt, 'execute');
    for (const bad of [undefined, [], {}, { all: false }]) {
      await expect(
        revokeRules(rt, gen(), w.address, bad as never)
      ).rejects.toMatchObject({
        code: AGENTIC_ERROR_CODE.REVOKE_NEEDS_TARGET,
      });
    }
    await expect(
      revokeRules(rt, gen(), w.address, [ruleId(9)])
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.RULE_NOT_FOUND });
    expect(exec).not.toHaveBeenCalled();
    await revokeRules(rt, gen(), w.address, [ruleId(1), ruleId(2)]);
    const sent = exec.mock.calls[0][0] as { to: string; data: Hex };
    expect(sent.to).toBe(w.address);
    const decoded = v4.decodeWalletCall(sent.data) as {
      kind: string;
      calls: { target: string; data: Hex }[];
    };
    expect(decoded.kind).toBe('execute');
    expect(
      decoded.calls.map(
        (c) => decodeFunctionData({ abi: AGW_ABI, data: c.data }).functionName
      )
    ).toEqual(['revokeRules', 'revokeRules']);
    await revokeRules(rt, gen(), w.address, { all: true });
    expect(
      decodeFunctionData({
        abi: AGW_ABI,
        data: (exec.mock.calls[1][0] as { data: Hex }).data,
      }).functionName
    ).toBe('revokeAllRules');
  });
});

describe('rules.update — one owner batch: assert → revoke → grant', () => {
  const gen = () => currentGeneration(PUSH_NETWORK.TESTNET_DONUT);

  it('builds exactly one execute(batch) with the observed spend asserted per pair', async () => {
    const fake = new FakeChain();
    const w = fake.addWallet(ADDR.owner, 'w', [
      fake.nativeRule(ADDR.agent, ruleId(1), {
        valueSpent: BigInt(3),
        amountSpent: BigInt(4),
        callsUsed: 5,
      }),
    ]);
    w.grantNonce = BigInt(2);
    const newId = computeRulesId({
      validator: ADDR.validator,
      agent: ADDR.agent,
      grantNonce: BigInt(2),
    });
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () =>
        withLogs([
          revoked(w.address, ruleId(1)),
          granted(w.address, newId),
        ])) as never,
    });
    const exec = jest.spyOn(rt, 'execute');
    const res = await updateRules(rt, gen(), w.address, {
      rules: [{ rulesId: ruleId(1), rule: rule() }],
    });
    expect(res.rules).toEqual([{ rulesId: newId, replaced: ruleId(1) }]);
    expect(exec).toHaveBeenCalledTimes(1);
    const sent = exec.mock.calls[0][0] as { to: string; data: Hex };
    expect(Array.isArray(sent.data)).toBe(false); // never a sequential multi-tx batch
    const outer = v4.decodeWalletCall(sent.data) as {
      kind: string;
      mode: Hex;
      calls: { target: string; data: Hex }[];
    };
    expect(outer.kind).toBe('execute');
    expect(outer.calls.map((c) => c.target)).toEqual([
      ADDR.policy,
      w.address,
      w.address,
    ]);
    const assertion = decodeFunctionData({
      abi: UNIVERSAL_RULES_POLICY_ABI,
      data: outer.calls[0].data,
    });
    expect(assertion.functionName).toBe('assertSpent');
    expect(assertion.args.slice(1)).toEqual([
      w.address,
      BigInt(3),
      BigInt(4),
      5,
    ]);
    expect(
      outer.calls
        .slice(1)
        .map(
          (c) => decodeFunctionData({ abi: AGW_ABI, data: c.data }).functionName
        )
    ).toEqual(['revokeRules', 'grantRules']);
  });

  it('universal replacement asserts every asset in stored order before revoke/grant', async () => {
    const fake = new FakeChain();
    const w = fake.addWallet(ADDR.owner, 'w', [
      {
        ...fake.nativeRule(ADDR.agent, ruleId(1)),
        mode: 0,
        chain: 'eip155:11155111',
        universal: {
          expectedCEA: ADDR.other,
          maxGasPerCall: BigInt(10),
          assets: [
            { token: ADDR.target, spent: BigInt(4) },
            { token: ADDR.other, spent: BigInt(7) },
          ],
        },
      },
    ]);
    const next = computeRulesId({
      validator: ADDR.validator,
      agent: ADDR.agent,
      grantNonce: BigInt(1),
    });
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () =>
        withLogs([
          revoked(w.address, ruleId(1)),
          granted(w.address, next),
        ])) as never,
    });
    const exec = jest.spyOn(rt, 'execute');
    await updateRules(rt, gen(), w.address, {
      rules: [{ rulesId: ruleId(1), rule: rule() }],
    });
    const data = (exec.mock.calls[0][0] as { data: Hex }).data;
    const outer = v4.decodeWalletCall(data) as { calls: { data: Hex }[] };
    const assertion = decodeFunctionData({
      abi: UNIVERSAL_RULES_POLICY_ABI,
      data: outer.calls[0].data,
    });
    expect(assertion.args.slice(1)).toEqual([
      w.address,
      [BigInt(4), BigInt(7)],
    ]);
    expect(
      outer.calls
        .slice(1)
        .map(
          (c) => decodeFunctionData({ abi: AGW_ABI, data: c.data }).functionName
        )
    ).toEqual(['revokeRules', 'grantRules']);
  });

  it('replacement may name another live agent, but may not repeat an old ID', async () => {
    const fake = new FakeChain();
    const w = fake.addWallet(ADDR.owner, 'w', [
      fake.nativeRule(ADDR.agent, ruleId(1)),
      fake.nativeRule(ADDR.other, ruleId(2)),
    ]);
    const next = computeRulesId({
      validator: ADDR.validator,
      agent: ADDR.other,
      grantNonce: BigInt(2),
    });
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      execute: (async () =>
        withLogs([
          revoked(w.address, ruleId(1)),
          granted(w.address, next),
        ])) as never,
    });
    expect(
      (
        await updateRules(rt, gen(), w.address, {
          rules: [{ rulesId: ruleId(1), rule: rule(ADDR.other) }],
        })
      ).rules[0].rulesId
    ).toBe(next);
    await expect(
      updateRules(rt, gen(), w.address, {
        rules: [
          { rulesId: ruleId(1), rule: rule() },
          { rulesId: ruleId(1), rule: rule() },
        ],
      })
    ).rejects.toThrow(/same old rule twice/);
  });
});
