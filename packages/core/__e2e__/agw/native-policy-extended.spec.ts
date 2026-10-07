/** Native policy limits, confirmed zero defaults and lossless raw-offset reuse. */
import { PushChain, AgenticRevertError, type NativeRule } from '../../src';
import { encodeFunctionData, erc20Abi, type Address } from 'viem';
import { getNativePRC20ForChain } from '../../src/lib/orchestrator/internals/helpers';
import { readNativeCounters } from '../shared/agw-state';
import { CHAIN } from '../../src/lib/constants/enums';
import { setupAgw, inSeconds, type AgwFixture } from './_fixture';

const d = process.env['AGW_E2E'] === '1' ? describe : describe.skip;
const chain = PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT;

d('agw extended native policy', () => {
  let f: AgwFixture, token: Address;
  beforeAll(async () => {
    f = await setupAgw();
    token = getNativePRC20ForChain(CHAIN.ETHEREUM_SEPOLIA, f.manifest.network);
  }, 300_000);
  afterAll(() => f?.teardown());
  const transfer = (to: Address, amount: bigint) =>
    encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, amount],
    });
  async function fixture(
    balance = BigInt(50),
    maxCalls = 2,
    total = BigInt(15),
    omitPc = false
  ) {
    const rule = {
      agent: f.agentAddress,
      target: token,
      selector: 'transfer(address,uint256)' as const,
      validUntil: inSeconds(3600),
      ...(omitPc
        ? {}
        : { maxValuePerCall: BigInt(0), maxValueTotal: BigInt(0) }),
      maxCalls,
      pins: [{ arg: 0, expected: f.ownerAddress }],
      amount: { arg: 1, maxPerCall: BigInt(10), maxTotal: total },
    };
    const made = await f.owner.agentic.create('e2e-native-meter', {
      rules: [rule],
    });
    if (balance)
      await (
        await f.owner.universal.sendTransaction({
          to: token,
          data: transfer(made.wallet, balance),
        })
      ).wait();
    const agent = await f.agent(made.wallet);
    const counters = () =>
      readNativeCounters(
        f.push,
        f.manifest.addresses,
        made.wallet,
        made.rulesIds[0]
      );
    const tokenBalance = () =>
      f.push.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [made.wallet],
      });
    const send = (amount: bigint, to = f.ownerAddress, value = BigInt(0)) =>
      agent.universal.sendTransaction({
        to: { address: token, chain },
        value,
        data: transfer(to, amount),
      });
    return { ...made, agent, counters, tokenBalance, send };
  }
  async function refused(
    s: Awaited<ReturnType<typeof fixture>>,
    action: () => Promise<unknown>,
    gate?: string
  ) {
    const before = await s.counters(),
      balance = await s.tokenBalance();
    const error = await action().then(
      () => undefined,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(AgenticRevertError);
    if (gate)
      expect((error as AgenticRevertError).decodedError?.name).toBe(
        `PolicyCheckReverted(${gate})`
      );
    expect(await s.counters()).toEqual(before);
    expect(await s.tokenBalance()).toBe(balance);
    f.evidence('extended-native-refusal', {
      wallet: s.wallet,
      rulesId: s.rulesIds[0],
      gate: gate ?? 'callee/engine',
      counters: before,
      tokenBalance: balance,
    });
  }
  it('1. pinned recipient and metered amount decode losslessly and transfer through explicit Push chain', async () => {
    const s = await fixture();
    const record = await f.owner.agentic
      .wallet(s.wallet)
      .rules.get(s.rulesIds[0]);
    expect(record.rule).toMatchObject({
      pins: [
        {
          offset: 4,
          expected: `0x${f.ownerAddress
            .slice(2)
            .toLowerCase()
            .padStart(64, '0')}`,
        },
      ],
      amount: { offset: 36, maxPerCall: BigInt(10), maxTotal: BigInt(15) },
    });
    const before = await f.push.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [f.ownerAddress],
    });
    const tx = await s.send(BigInt(10));
    expect((await tx.wait()).status).toBe(1);
    expect(await s.tokenBalance()).toBe(BigInt(40));
    expect(await s.counters()).toMatchObject({
      valueSpent: BigInt(0),
      amountSpent: BigInt(10),
      callsUsed: 1,
    });
    expect(
      await f.push.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [f.ownerAddress],
      })
    ).toBe(before + BigInt(10));
    const replay = await f.owner.universal.trackTransaction(tx.hash);
    expect(replay.from).toBe(s.wallet);
    expect(replay.agentic?.rulesId).toBe(s.rulesIds[0]);
    f.evidence('extended-native-meter', {
      wallet: s.wallet,
      rulesId: s.rulesIds[0],
      txHash: tx.hash,
    });
  });
  it('2. wrong recipient pin is refused with unchanged token balance and counters', async () => {
    const s = await fixture();
    await refused(s, () => s.send(BigInt(1), f.agentAddress), 'ArgPinMismatch');
  });
  it('3. per-call amount cap refuses cap plus one', async () => {
    const s = await fixture();
    await refused(s, () => s.send(BigInt(11)), 'NativeAmountExceedsCap');
  });
  it('4. cumulative amount accepts the exact total and refuses the next unit', async () => {
    const s = await fixture(BigInt(50), 10);
    await (await s.send(BigInt(10))).wait();
    await (await s.send(BigInt(5))).wait();
    expect((await s.counters()).amountSpent).toBe(BigInt(15));
    await refused(s, () => s.send(BigInt(1)), 'TotalNativeAmountExceeded');
  });
  it('5. call count accepts the exact count and refuses a zero-amount extra call', async () => {
    const s = await fixture();
    await (await s.send(BigInt(1))).wait();
    await (await s.send(BigInt(1))).wait();
    expect((await s.counters()).callsUsed).toBe(2);
    await refused(s, () => s.send(BigInt(0)), 'CallLimitReached');
  });
  it('6. explicit zero total forbids positive amount but permits a metered zero call', async () => {
    const s = await fixture(BigInt(50), 10, BigInt(0));
    await refused(s, () => s.send(BigInt(1)), 'TotalNativeAmountExceeded');
    await (await s.send(BigInt(0))).wait();
    expect(await s.counters()).toMatchObject({
      amountSpent: BigInt(0),
      callsUsed: 1,
    });
  });
  it('7. failed token callee leaves all policy counters unchanged', async () => {
    const s = await fixture(BigInt(5));
    await refused(s, () => s.send(BigInt(10)));
  });
  it('8. an ungranted selector is refused without changing balances or allowance', async () => {
    const s = await fixture();
    const before = await f.push.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [s.wallet, f.agentAddress],
    });
    await refused(s, () =>
      s.agent.universal.sendTransaction({
        to: token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [f.agentAddress, BigInt(1)],
        }),
      })
    );
    expect(
      await f.push.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [s.wallet, f.agentAddress],
      })
    ).toBe(before);
  });
  it('9. omitted PC limits forbid value while still allowing a token transfer', async () => {
    const s = await fixture(BigInt(5), 3, BigInt(15), true);
    await f.fundPC(s.wallet, BigInt(10));
    const record = await f.owner.agentic
      .wallet(s.wallet)
      .rules.get(s.rulesIds[0]);
    expect(record.rule).toMatchObject({
      maxValuePerCall: BigInt(0),
      maxValueTotal: BigInt(0),
    });
    await refused(s, () => s.send(BigInt(1), f.ownerAddress, BigInt(1)), 'ValueExceedsCap');
    const sent = await s.send(BigInt(1));
    expect((await sent.wait()).status).toBe(1);
    expect(await s.counters()).toMatchObject({
      valueSpent: BigInt(0),
      amountSpent: BigInt(1),
    });
    f.evidence('zero-pc-defaults', { wallet: s.wallet, txHash: sent.hash });
  });
  it('10. decoded raw-offset rules can be granted again without fabricated ref metadata', async () => {
    const s = await fixture(BigInt(0));
    const original = await f.owner.agentic
      .wallet(s.wallet)
      .rules.get(s.rulesIds[0]);
    expect(original).not.toHaveProperty('ref');
    const made = await f.owner.agentic.create('raw-offset-reuse', {
      rules: [original.rule as NativeRule],
    });
    const reread = await f.owner.agentic
      .wallet(made.wallet)
      .rules.get(made.rulesIds[0]);
    expect(reread.rule).toEqual(original.rule);
    expect(reread).not.toHaveProperty('ref');
    f.evidence('raw-offset-reuse', {
      wallet: made.wallet,
      txHash: made.tx.hash,
    });
  });
  it('11. removed ref and conflicting argument-offset inputs fail before signing', async () => {
    const nonce = await f.push.getTransactionCount({ address: f.ownerAddress });
    const rule = {
      agent: f.agentAddress,
      target: token,
      selector: 'transfer(address,uint256)',
      validUntil: inSeconds(3600),
    };
    await expect(
      f.owner.agentic.create('invalid-ref', {
        rules: [{ ...rule, ref: `0x${'11'.repeat(32)}` } as never],
      })
    ).rejects.toMatchObject({ code: 'INVALID_RULE' });
    await expect(
      f.owner.agentic.create('invalid-pin', {
        rules: [
          {
            ...rule,
            pins: [{ arg: 0, offset: 4, expected: `0x${'00'.repeat(32)}` }],
          } as never,
        ],
      })
    ).rejects.toMatchObject({ code: 'INVALID_RULE' });
    expect(await f.push.getTransactionCount({ address: f.ownerAddress })).toBe(
      nonce
    );
  });
});
