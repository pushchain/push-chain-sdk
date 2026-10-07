import { PushChain } from '../../src';
import { getAddress, type Address } from 'viem';
import type { AgenticRuntime } from '../../src/lib/agentic/runtime';
import { v5 } from '../../src/lib/agentic/contracts/v5';
import { setupAgw, inSeconds, type AgwFixture } from './_fixture';
import { readNativeCounters } from '../shared/agw-state';

const d = process.env['AGW_E2E'] === '1' ? describe : describe.skip;
const runtime = (client: PushChain) =>
  (client as unknown as { agenticRuntime: AgenticRuntime }).agenticRuntime;

d('agw extended management', () => {
  let f: AgwFixture;
  beforeAll(async () => {
    f = await setupAgw();
  }, 300_000);
  afterAll(() => f?.teardown());
  const rule = (agent = f.agentAddress) => ({
    agent,
    target: f.ownerAddress,
    selector: 'value-only' as const,
    validUntil: inSeconds(3600),
    maxValuePerCall: BigInt(10),
    maxValueTotal: BigInt(100),
    maxCalls: 10,
  });
  const count = (wallet: Address) =>
    f.push.readContract({
      address: wallet,
      abi: v5.abis.wallet,
      functionName: 'checkpointCount',
    });
  it('1. prefunding a derived address survives deployment and info/list keep owner index and label', async () => {
    const predicted = await f.owner.agentic.derive();
    expect(predicted.deployed).toBe(false);
    await f.fundPC(predicted.address, BigInt(10));
    const made = await f.owner.agentic.create('e2e-prefunded-identity', {
      rules: [],
    });
    expect(made.wallet).toBe(predicted.address);
    expect(made.index).toBe(predicted.index);
    expect(await f.push.getBalance({ address: made.wallet })).toBe(BigInt(10));
    const w = f.owner.agentic.wallet(made.wallet);
    expect(await w.info()).toMatchObject({
      owner: f.ownerAddress,
      index: made.index,
      label: 'e2e-prefunded-identity',
      deployed: true,
      rulesCount: 0,
    });
    expect(await w.owner()).toEqual({ owner: f.ownerAddress });
    expect((await f.owner.agentic.list()).wallets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: made.wallet,
          index: made.index,
          label: 'e2e-prefunded-identity',
        }),
      ])
    );
    expect(await f.owner.agentic.derive({ index: made.index })).toMatchObject({
      address: made.wallet,
      deployed: true,
    });
    f.evidence('extended-prefunding', {
      wallet: made.wallet,
      index: made.index,
      txHash: made.tx.hash,
    });
  });
  it('2. same-agent multiplicity is ambiguous before signing and selective revoke restores uncached lookup', async () => {
    const made = await f.owner.agentic.create('e2e-ambiguous', {
      rules: [rule(), rule()],
    });
    await f.fundPC(made.wallet, BigInt(10));
    const agent = await f.agent(made.wallet),
      nonce = await f.push.getTransactionCount({ address: f.agentAddress });
    await expect(
      agent.universal.sendTransaction({ to: f.ownerAddress, value: BigInt(1) })
    ).rejects.toMatchObject({
      code: 'AMBIGUOUS_RULE',
      details: { rulesIds: expect.arrayContaining(made.rulesIds) },
    });
    expect(await f.push.getTransactionCount({ address: f.agentAddress })).toBe(
      nonce
    );
    await (
      await f.owner.agentic.wallet(made.wallet).rules.revoke([made.rulesIds[0]])
    ).wait();
    const tx = await agent.universal.sendTransaction({
      to: f.ownerAddress,
      value: BigInt(1),
    });
    expect((await tx.wait()).status).toBe(1);
    expect(tx.agentic?.rulesId).toBe(made.rulesIds[1]);
    f.evidence('extended-uncached-lookup', {
      wallet: made.wallet,
      removed: made.rulesIds[0],
      selected: made.rulesIds[1],
      txHash: tx.hash,
    });
  });
  it('3. multi-rule add and revoke are atomic batches with exact checkpoint counts', async () => {
    const made = await f.owner.agentic.create('e2e-management-batches', {
        rules: [],
      }),
      w = f.owner.agentic.wallet(made.wallet);
    const added = await w.rules.add([
      rule(),
      rule(getAddress('0x000000000000000000000000000000000000bEEF')),
    ]);
    expect(await count(made.wallet)).toBe(BigInt(4));
    expect(new Set(added.rulesIds).size).toBe(2);
    expect((await w.rules.list()).rules.map((r) => r.rulesId)).toEqual(
      expect.arrayContaining(added.rulesIds)
    );
    await (await w.rules.revoke(added.rulesIds)).wait();
    expect(await count(made.wallet)).toBe(BigInt(8));
    expect((await w.rules.list()).rules).toEqual([]);
    const cp = await w.checkpoints({ sinceBlock: added.tx.blockNumber });
    expect(cp.checkpoints).toHaveLength(8);
    f.evidence('extended-management-batches', {
      wallet: made.wallet,
      rulesIds: added.rulesIds,
      addHash: added.tx.hash,
      checkpoints: 8,
    });
  });
  it('4. invalid revoke targets preserve enabled rules and signer nonce', async () => {
    const made = await f.owner.agentic.create('e2e-revoke-guards', {
        rules: [rule()],
      }),
      w = f.owner.agentic.wallet(made.wallet),
      nonce = await f.push.getTransactionCount({ address: f.ownerAddress });
    await expect(w.rules.revoke([])).rejects.toMatchObject({
      code: 'REVOKE_NEEDS_TARGET',
    });
    await expect(
      w.rules.revoke([made.rulesIds[0], made.rulesIds[0]])
    ).rejects.toMatchObject({ code: 'INVALID_RULE' });
    await expect(
      w.rules.revoke([`0x${'12'.repeat(32)}`])
    ).rejects.toMatchObject({ code: 'RULE_NOT_FOUND' });
    expect(await f.push.getTransactionCount({ address: f.ownerAddress })).toBe(
      nonce
    );
    expect((await w.rules.list()).rules.map((r) => r.rulesId)).toEqual(
      made.rulesIds
    );
  });
  it('5. intervening agent spend refuses a stale replacement without changing grants or checkpoints', async () => {
    const made = await f.owner.agentic.create('e2e-live-stale-update', {
      rules: [rule()],
    });
    await f.fundPC(made.wallet, BigInt(10));
    const agent = await f.agent(made.wallet),
      rt = runtime(f.owner),
      original = rt.execute;
    let injected = false,
      hash: string | undefined;
    const before = await count(made.wallet),
      grantNonce = await f.push.readContract({
        address: made.wallet,
        abi: v5.abis.wallet,
        functionName: 'grantNonce',
      });
    rt.execute = async (params, opts) => {
      if (!injected && params.to === made.wallet) {
        injected = true;
        const tx = await agent.universal.sendTransaction({
          to: f.ownerAddress,
          value: BigInt(1),
        });
        await tx.wait();
        hash = tx.hash;
      }
      return original(params, opts);
    };
    try {
      const error = await f.owner.agentic
        .wallet(made.wallet)
        .rules.update({ rules: [{ rulesId: made.rulesIds[0], rule: rule() }] })
        .then(
          () => undefined,
          (e: unknown) => e
        );
      expect(error).toMatchObject({
        decodedError: { name: expect.stringContaining('SpentMismatch') },
      });
      expect(injected).toBe(true);
    } finally {
      rt.execute = original;
    }
    expect(await count(made.wallet)).toBe(before);
    expect(
      await f.push.readContract({
        address: made.wallet,
        abi: v5.abis.wallet,
        functionName: 'grantNonce',
      })
    ).toBe(grantNonce);
    expect(
      (await f.owner.agentic.wallet(made.wallet).rules.list()).rules.map(
        (r) => r.rulesId
      )
    ).toEqual(made.rulesIds);
    expect(
      await readNativeCounters(
        f.push,
        f.manifest.addresses,
        made.wallet,
        made.rulesIds[0]
      )
    ).toMatchObject({ valueSpent: BigInt(1), callsUsed: 1 });
    f.evidence('extended-stale-update', {
      wallet: made.wallet,
      rulesId: made.rulesIds[0],
      spendHash: hash,
      checkpoints: before,
      grantNonce,
    });
  });
  it('6. index race commits no grants to the competing wallet and retry takes the next slot', async () => {
    const expectedNext = await f.owner.agentic.derive();
    const rt = runtime(f.owner),
      original = rt.execute;
    let competing:
        | Awaited<ReturnType<typeof f.owner.agentic.create>>
        | undefined,
      injected = false;
    rt.execute = async (params, opts) => {
      if (!injected && Array.isArray(params.data)) {
        injected = true;
        competing = await f.owner.agentic.create('e2e-race-winner', {
          rules: [],
        });
      }
      return original(params, opts);
    };
    let raceError: unknown;
    try {
      await f.owner.agentic.create('e2e-race-loser', { rules: [rule()] });
    } catch (error) {
      raceError = error;
    }
    try {
      const afterRace = await f.owner.agentic.derive();
      const competingRules = competing
        ? (await f.owner.agentic.wallet(competing.wallet).rules.list()).rules
        : undefined;
      f.evidence('extended-index-race-error', {
        code: (raceError as { code?: string } | undefined)?.code,
        expectedWallet: expectedNext.address,
        expectedIndex: expectedNext.index,
        competingWallet: competing?.wallet,
        competingIndex: competing?.index,
        nextAfterRace: afterRace,
        competingRuleIds: competingRules?.map((r) => r.rulesId),
      });
      expect(raceError).toMatchObject({
        code: 'INDEX_RACE',
        details: { committed: false },
      });
    } finally {
      rt.execute = original;
    }
    if (!competing) throw new Error('Race injection did not run');
    expect(
      (await f.owner.agentic.wallet(competing.wallet).rules.list()).rules
    ).toEqual([]);
    const retried = await f.owner.agentic.create('e2e-race-retry', {
      rules: [rule()],
    });
    expect(retried.index).toBe(competing.index + 1);
    expect(retried.wallet).not.toBe(competing.wallet);
    f.evidence('extended-index-race', {
      competing: competing.wallet,
      winnerHash: competing.tx.hash,
      retried: retried.wallet,
      retryHash: retried.tx.hash,
    });
  });
});
