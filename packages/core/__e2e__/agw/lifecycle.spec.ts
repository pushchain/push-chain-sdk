import { readNativeCounters } from '@e2e/shared/agw-state';
/**
 * Scenarios 5 and 6 — add / update / revoke lifecycle and checkpoint counts.
 * A replacement is five checkpoint ticks; allowance pulls are not ticks.
 * The stale-spend race (intervening agent spend) is verified against the
 * real contracts in the local harness; it cannot be timed reliably live.
 */
import { v4 } from '../../src/lib/agentic/contracts/v4';
import { getAddress, parseEther, type Address, type Hex } from 'viem';
import { AGENTIC_ERROR_CODE } from '../../src/lib/agentic/errors';
import {
  AGW_E2E_ENABLED,
  inSeconds,
  setupAgw,
  type AgwFixture,
} from './_fixture';

const d = AGW_E2E_ENABLED ? describe : describe.skip;

d('agw lifecycle', () => {
  let f: AgwFixture;
  let wallet: Address;
  let original: Hex;
  const sink = getAddress('0x000000000000000000000000000000000000dEaD');
  const rule = (maxValuePerCall: bigint) => ({
    agent: f.agentAddress,
    target: sink,
    selector: 'value-only' as const,
    validUntil: inSeconds(3600),
    maxValuePerCall,
    maxValueTotal: maxValuePerCall * BigInt(10),
  });
  const count = () =>
    f.push.readContract({
      address: wallet,
      abi: v4.abis.wallet,
      functionName: 'checkpointCount',
    }) as Promise<bigint>;

  beforeAll(async () => {
    f = await setupAgw();
    wallet = (await f.owner.agentic.create('e2e-lifecycle', { rules: [] }))
      .wallet;
    await f.fundPC(wallet, parseEther('0.01'));
  }, 300_000);
  afterAll(() => f?.teardown());

  it('1. rules.add grants with one RULES_GRANTED checkpoint', async () => {
    const before = await count();
    const added = await f.owner.agentic
      .wallet(wallet)
      .rules.add([rule(BigInt(1000))]);
    original = added.rulesIds[0];
    expect(await count()).toBe(before + BigInt(1));
    const { checkpoints } = await f.owner.agentic
      .wallet(wallet)
      .checkpoints({ sinceBlock: added.tx.blockNumber });
    expect(checkpoints.at(-1)).toMatchObject({
      kind: 'RULES_GRANTED',
      ref: original,
    });
  });

  it('2. rules.update: old ID disabled, new ID usable with reset counters, five checkpoint ticks', async () => {
    const agent = await f.agent(wallet);
    await (
      await agent.universal.sendTransaction({ to: sink, value: BigInt(10) })
    ).wait();
    const spentBefore = await readNativeCounters(
      f.push,
      f.manifest.addresses,
      wallet,
      original
    );
    expect(spentBefore).toMatchObject({
      valueSpent: BigInt(10),
      callsUsed: 1,
    });
    const before = await count();
    const res = await f.owner.agentic.wallet(wallet).rules.update({
      rules: [{ rulesId: original, rule: rule(BigInt(2000)) }],
    });
    expect(await count()).toBe(before + BigInt(5));
    const replacement = res.rules[0].rulesId;
    expect(res.rules[0].replaced).toBe(original);
    expect(
      await readNativeCounters(
        f.push,
        f.manifest.addresses,
        wallet,
        replacement
      )
    ).toMatchObject({ valueSpent: BigInt(0), callsUsed: 0 });
    await expect(
      f.owner.agentic.wallet(wallet).rules.get(original)
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.RULE_NOT_FOUND });
    const tx = await agent.universal.sendTransaction({
      to: sink,
      value: BigInt(1500),
    });
    expect(tx.agentic?.rulesId).toBe(replacement);
    f.evidence('rules-update', {
      wallet,
      original,
      replacement,
      tx: res.tx.hash,
      checkpointDelta: 5,
    });
  });

  it('3. checkpoint history is contiguous and matches checkpointCount()', async () => {
    const { checkpoints } = await f.owner.agentic.wallet(wallet).checkpoints();
    expect(checkpoints.map((c) => c.seq)).toEqual(
      checkpoints.map((_, i) => i + 1)
    );
    expect(BigInt(checkpoints.length)).toBe(await count());
  });

  it('4. revoke({ all: true }) leaves no enabled rules', async () => {
    await (
      await f.owner.agentic.wallet(wallet).rules.revoke({ all: true })
    ).wait();
    expect((await f.owner.agentic.wallet(wallet).rules.list()).rules).toEqual(
      []
    );
  });
});
