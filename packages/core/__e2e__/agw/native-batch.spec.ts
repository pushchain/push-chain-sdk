/** Opt-in live cases: require the existing verified-manifest gate and native
 * EIP-7702 transport. These never accept a sequential fallback as success. */
import { getAddress, parseEther, type Hex } from 'viem';
import { AgenticRevertError } from '../../src';
import { readNativeCounters } from '@e2e/shared/agw-state';
import {
  AGW_E2E_ENABLED,
  inSeconds,
  setupAgw,
  type AgwFixture,
} from './_fixture';

const d = AGW_E2E_ENABLED ? describe : describe.skip;
const SINK = getAddress('0x000000000000000000000000000000000000dEaD');
const calls = () =>
  Array.from({ length: 2 }, () => ({
    to: SINK,
    value: BigInt(1000),
    data: '0x' as Hex,
  }));

d('agw native batch', () => {
  let f: AgwFixture;
  beforeAll(async () => {
    f = await setupAgw();
  }, 300_000);
  afterAll(() => f?.teardown());

  const create = async (maxCalls: number) => {
    const created = await f.owner.agentic.create('e2e-native-batch', {
      rules: [
        {
          agent: f.agentAddress,
          target: SINK,
          selector: 'value-only',
          validUntil: inSeconds(3600),
          maxValuePerCall: BigInt(1000),
          maxValueTotal: BigInt(5000),
          maxCalls,
        },
      ],
    });
    await f.fundPC(created.wallet, parseEther('0.001'));
    return { ...created, agent: await f.agent(created.wallet) };
  };

  it('1. sender-preserving atomic native batch meters both actions', async () => {
    const { wallet, rulesIds, agent } = await create(3);
    const before = await f.push.getBalance({ address: wallet });
    const tx = await agent.universal.sendTransaction({
      to: SINK,
      data: calls(),
    });
    expect((await tx.wait()).status).toBe(1);
    expect(tx.agentic?.nativeCalls).toEqual(calls());
    expect(tx.from).toBe(wallet);
    expect(await f.push.getBalance({ address: wallet })).toBe(
      before - BigInt(2000)
    );
    expect(
      await readNativeCounters(
        f.push,
        f.manifest.addresses,
        wallet,
        rulesIds[0]
      )
    ).toMatchObject({ callsUsed: 2, valueSpent: BigInt(2000) });
    const raw = await f.push.getTransaction({ hash: tx.hash as Hex });
    expect(raw.type).toBe('eip7702');
    expect(getAddress(raw.from)).toBe(f.agentAddress);
    expect(getAddress(raw.to as Hex)).toBe(f.agentAddress);
    const replay = await f.owner.universal.trackTransaction(tx.hash);
    expect(replay.agentic?.nativeCalls).toEqual(calls());
    expect(replay.from).toBe(wallet);
    f.evidence('native-agent-batch', {
      wallet,
      rulesId: rulesIds[0],
      tx: tx.hash,
    });
  });

  it('2. a later policy failure rolls back earlier native actions', async () => {
    const { wallet, rulesIds, agent } = await create(1);
    const before = await f.push.getBalance({ address: wallet });
    await expect(
      agent.universal.sendTransaction({ to: SINK, data: calls() })
    ).rejects.toBeInstanceOf(AgenticRevertError);
    expect(await f.push.getBalance({ address: wallet })).toBe(before);
    expect(
      await readNativeCounters(
        f.push,
        f.manifest.addresses,
        wallet,
        rulesIds[0]
      )
    ).toMatchObject({ callsUsed: 0, valueSpent: BigInt(0) });
    f.evidence('native-agent-batch-rollback', { wallet, rulesId: rulesIds[0] });
  });
});
