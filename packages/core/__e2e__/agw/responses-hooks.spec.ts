/**
 * Scenario 10 — init-time and per-call hooks through wait without
 * duplicates, and AGW `from` / signer `origin` on live and replayed
 * responses.
 */
import { getAddress, parseEther, type Address } from 'viem';
import type { ProgressEvent } from '../../src/lib/progress-hook/progress-hook.types';
import { AGW_E2E_ENABLED, inSeconds, setupAgw, type AgwFixture } from './_fixture';

const d = AGW_E2E_ENABLED ? describe : describe.skip;
const SINK = getAddress('0x000000000000000000000000000000000000dEaD');

d('agw responses', () => {
  let f: AgwFixture;
  let wallet: Address;
  beforeAll(async () => {
    f = await setupAgw();
    const created = await f.owner.agentic.create('e2e-hooks', {
      rules: [{ agent: f.agentAddress, target: SINK, selector: 'value-only', validUntil: inSeconds(3600), maxValuePerCall: BigInt(10), maxValueTotal: BigInt(100) }],
    });
    wallet = created.wallet;
    await f.fundPC(wallet, parseEther('0.001'));
  }, 300_000);
  afterAll(() => f?.teardown());

  it('1. init and per-call hooks each see every event once, through wait', async () => {
    const init: ProgressEvent[] = [];
    const perCall: ProgressEvent[] = [];
    const agent = await f.agent(wallet, (e) => init.push(e as ProgressEvent));
    const tx = await agent.universal.sendTransaction({ to: SINK, value: BigInt(1) }, { progressHook: (e) => perCall.push(e) });
    await tx.wait();
    const ids = (xs: ProgressEvent[]) => xs.map((e) => e.id);
    expect(ids(perCall)).toEqual(ids(init));
    expect(new Set(ids(perCall).filter((i) => i.startsWith('AGENTIC-TX'))).size).toBe(ids(perCall).filter((i) => i.startsWith('AGENTIC-TX')).length);
    expect(ids(perCall)).toEqual(expect.arrayContaining(['AGENTIC-TX-107', 'AGENTIC-TX-199-01', 'SEND-TX-199-01']));
    expect(ids(perCall)).not.toContain('AGENTIC-TX-103');
  });

  it('2. live and replayed responses agree on wallet from and signer origin', async () => {
    const agent = await f.agent(wallet);
    const tx = await agent.universal.sendTransaction({ to: SINK, value: BigInt(1) });
    await tx.wait();
    const replay = await f.owner.universal.trackTransaction(tx.hash);
    expect(replay.from).toBe(tx.from);
    expect(replay.from).toBe(wallet);
    expect(replay.origin).toBe(tx.origin);
    expect(replay.to).toBe(SINK);
    expect((await replay.wait()).from).toBe(wallet);
    f.evidence('replay-identity', { wallet, tx: tx.hash });
  });
});
