/** Public multi-action native rules on checked Donut v5; no contract deployments. */
import {
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { AgenticRevertError, type Rule } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';
import {
  CHAIN_INFO,
  getPushViemChain,
  PUSH_BATCH_EXECUTOR_ADDRESS,
} from '../../src/lib/constants/chain';
import { getNativePRC20ForChain } from '../../src/lib/orchestrator/internals/helpers';
import type { AgenticRuntime } from '../../src/lib/agentic/runtime';
import { v5 } from '../../src/lib/agentic/contracts/v5';
import { actionId } from '../../src/lib/agentic/codec/ids';
import { readNativeActionConfigs } from '@e2e/shared/agw-state';
import {
  AGW_E2E_ENABLED,
  inSeconds,
  setupAgw,
  type AgwFixture,
} from './_fixture';
const d = AGW_E2E_ENABLED ? describe : describe.skip;
const ZERO = BigInt(0),
  ONE = BigInt(1);
d('agw native multi-action', () => {
  let f: AgwFixture, token: Address;
  beforeAll(async () => {
    if (
      parseEther(process.env['AGW_E2E_AGENT_PC'] ?? '0.5') > parseEther('0.5')
    )
      throw new Error('Fixture agent budget is at most 0.5 PC');
    f = await setupAgw();
    token = getNativePRC20ForChain(CHAIN.ETHEREUM_SEPOLIA, f.manifest.network);
    const balance = await f.push.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [f.ownerAddress],
    });
    if (balance < BigInt(400))
      throw new Error(
        'Need 400 raw pETH units for bounded native multi-action fixtures'
      );
  }, 300000);
  afterAll(() => f?.teardown());
  const transfer = (amount: bigint, recipient = f.ownerAddress) =>
    encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [recipient, amount],
    });
  const rule = (): Rule => ({
    agent: f.agentAddress,
    validUntil: inSeconds(3600),
    allowedCalls: [
      {
        target: f.ownerAddress,
        selector: 'value-only',
        maxValue: ONE,
      },
      {
        target: token,
        selector: 'transfer(address,uint256)',
        pins: [
          { arg: 0, expected: f.ownerAddress },
          { arg: 1, max: BigInt(3) },
        ],
      },
    ],
  });
  async function fixture(input = rule()) {
    const made = await f.owner.agentic.create('e2e-native-multi', {
      rules: [input],
    });
    expect(made.rulesIds).toHaveLength(1);
    await f.fundPC(made.wallet, BigInt(10));
    await (
      await f.owner.universal.sendTransaction({
        to: token,
        data: transfer(BigInt(20), made.wallet),
      })
    ).wait();
    const agent = await f.agent(made.wallet);
    return {
      ...made,
      id: made.rulesIds[0] as Hex,
      handle: f.owner.agentic.wallet(made.wallet),
      agent,
    };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const sendPC = (s: Fixture, value = ONE) =>
    s.agent.universal.sendTransaction({ to: f.ownerAddress, value });
  const sendToken = (s: Fixture, amount = ONE, recipient = f.ownerAddress) =>
    s.agent.universal.sendTransaction({
      to: token,
      data: transfer(amount, recipient),
    });
  const calls = (amount = BigInt(2)) => [
    { to: f.ownerAddress, value: ONE, data: '0x' as Hex },
    { to: token, value: ZERO, data: transfer(amount) },
  ];
  async function state(s: Fixture) {
    const blockNumber = await f.push.getBlockNumber({ cacheTime: 0 });
    const [
      configs,
      walletPC,
      recipientPC,
      walletToken,
      recipientToken,
      checkpointCount,
      grantNonce,
    ] = await Promise.all([
      readNativeActionConfigs(
        f.push,
        f.manifest.addresses,
        s.wallet,
        s.id,
        blockNumber
      ),
      f.push.getBalance({ address: s.wallet, blockNumber }),
      f.push.getBalance({ address: f.ownerAddress, blockNumber }),
      f.push.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [s.wallet],
        blockNumber,
      }),
      f.push.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [f.ownerAddress],
        blockNumber,
      }),
      f.push.readContract({
        address: s.wallet,
        abi: v5.abis.wallet,
        functionName: 'checkpointCount',
        blockNumber,
      }),
      f.push.readContract({
        address: s.wallet,
        abi: v5.abis.wallet,
        functionName: 'grantNonce',
        blockNumber,
      }),
    ]);
    return {
      configs,
      walletPC,
      recipientPC,
      walletToken,
      recipientToken,
      checkpointCount,
      grantNonce,
    };
  }
  function config(
    snapshot: Awaited<ReturnType<typeof state>>,
    target: Address,
    selector: Hex
  ) {
    const entry = snapshot.configs.find(
      (entry) => entry.actionId === actionId(target, selector)
    );
    if (!entry) throw new Error('Missing independent per-action config');
    return entry.config;
  }
  async function refused(
    s: Fixture,
    send: () => Promise<unknown>,
    gate: string
  ) {
    const before = await state(s),
      nonce = await f.push.getTransactionCount({ address: f.agentAddress });
    const error = await send().then(
      () => undefined,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(AgenticRevertError);
    expect((error as AgenticRevertError).decodedError?.name).toBe(gate);
    expect(await state(s)).toEqual(before);
    expect(await f.push.getTransactionCount({ address: f.agentAddress })).toBe(
      nonce
    );
    f.evidence('native-multi-refused', {
      wallet: s.wallet,
      id: s.id,
      gate,
      state: before,
      agentNonce: nonce,
    });
  }
  it('1. one rule grants and reads both allowedCalls; decoded terms can be granted losslessly', async () => {
    const s = await fixture();
    const { rules } = await s.handle.rules.list();
    expect(rules.map((r) => r.rulesId)).toEqual([s.id]);
    const decoded = (await s.handle.rules.get(s.id)).rule as Rule;
    expect(decoded.allowedCalls.map((a) => [a.target, a.selector])).toEqual([
      [f.ownerAddress, 'value-only'],
      [token, '0xa9059cbb'],
    ]);
    expect(decoded.allowedCalls[1]).toMatchObject({
      pins: [{ arg: 0 }, { arg: 1, max: BigInt(3) }],
    });
    const copy = await f.owner.agentic.create('e2e-native-multi-copy', {
      rules: [decoded],
    });
    expect(
      (await f.owner.agentic.wallet(copy.wallet).rules.get(copy.rulesIds[0]))
        .rule
    ).toEqual(decoded);
    const before = await state(s);
    const pc = await sendPC(s);
    await pc.wait();
    const afterPC = await state(s);
    expect(afterPC.walletPC).toBe(before.walletPC - ONE);
    expect(afterPC.recipientPC).toBe(before.recipientPC + ONE);
    expect(config(afterPC, token, '0xa9059cbb')).toEqual(
      config(before, token, '0xa9059cbb')
    );
    const moved = await sendToken(s, BigInt(2));
    await moved.wait();
    const after = await state(s);
    expect(after.walletToken).toBe(before.walletToken - BigInt(2));
    expect(after.recipientToken).toBe(before.recipientToken + BigInt(2));
    expect(config(after, f.ownerAddress, '0xffffffff')).toMatchObject({
      valueSpent: ONE,
      callsUsed: 1,
    });
    expect(config(after, token, '0xa9059cbb')).toMatchObject({
      amountSpent: BigInt(2),
      callsUsed: 1,
    });
    expect(after.checkpointCount).toBe(before.checkpointCount);
    expect(pc.agentic?.rulesId).toBe(s.id);
    expect(moved.agentic?.rulesId).toBe(s.id);
    const replay = await f.owner.universal.trackTransaction(moved.hash);
    expect(replay.from).toBe(s.wallet);
    expect(replay.origin).toBe(moved.origin);
    expect(replay.agentic?.rulesId).toBe(s.id);
    f.evidence('native-multi-grant-read-send', {
      wallet: s.wallet,
      id: s.id,
      copy: copy.wallet,
      hashes: [s.tx.hash, copy.tx.hash, pc.hash, moved.hash],
      state: after,
    });
  });
  it('2. wrong pin, excess amount and an ungranted selector fail without changing either action', async () => {
    const s = await fixture();
    await refused(
      s,
      () => sendToken(s, ONE, f.agentAddress),
      'PolicyCheckReverted(ArgPinMismatch)'
    );
    await refused(
      s,
      () => sendToken(s, BigInt(4)),
      'PolicyCheckReverted(NativeAmountExceedsCap)'
    );
    await refused(
      s,
      () =>
        s.agent.universal.sendTransaction({
          to: token,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [f.agentAddress, ONE],
          }),
        }),
      'NoPoliciesSet'
    );
    expect(
      await f.push.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [s.wallet, f.agentAddress],
      })
    ).toBe(ZERO);
  });
  it('3. per-call limits allow repeated calls with independent spend entries', async () => {
    const s = await fixture();
    await (await sendPC(s)).wait();
    await (await sendPC(s)).wait();
    await (await sendPC(s, ZERO)).wait();
    await (await sendToken(s, BigInt(3))).wait();
    await (await sendToken(s, BigInt(2))).wait();
    await (await sendToken(s)).wait();
    const final = await state(s);
    expect(config(final, f.ownerAddress, '0xffffffff')).toMatchObject({
      valueSpent: BigInt(2),
      callsUsed: 3,
    });
    expect(config(final, token, '0xa9059cbb')).toMatchObject({
      amountSpent: BigInt(6),
      callsUsed: 3,
    });
    f.evidence('native-multi-independent-counters', {
      wallet: s.wallet,
      id: s.id,
      state: final,
    });
  });
  it('4. a mixed-function atomic agent batch preserves sender, per-action spend and replay', async () => {
    const s = await fixture(),
      before = await state(s);
    const tx = await s.agent.universal.sendTransaction({
      to: f.ownerAddress,
      data: calls(),
    });
    expect((await tx.wait()).status).toBe(1);
    const raw = await f.push.getTransaction({ hash: tx.hash as Hex });
    expect(raw.type).toBe('eip7702');
    expect(getAddress(raw.from)).toBe(f.agentAddress);
    expect(getAddress(raw.to as Address)).toBe(f.agentAddress);
    const after = await state(s);
    expect(after.walletPC).toBe(before.walletPC - ONE);
    expect(after.walletToken).toBe(before.walletToken - BigInt(2));
    expect(config(after, f.ownerAddress, '0xffffffff')).toMatchObject({
      callsUsed: 1,
      valueSpent: ONE,
    });
    expect(config(after, token, '0xa9059cbb')).toMatchObject({
      callsUsed: 1,
      amountSpent: BigInt(2),
    });
    expect(after.checkpointCount).toBe(before.checkpointCount);
    const replay = await f.owner.universal.trackTransaction(tx.hash);
    expect(replay.from).toBe(s.wallet);
    expect(replay.agentic?.nativeCalls).toEqual(calls());
    expect(replay.agentic?.rulesId).toBe(s.id);
    f.evidence('native-multi-mixed-batch', {
      wallet: s.wallet,
      id: s.id,
      hash: tx.hash,
      state: after,
    });
  });
  it('5. a failing second batch action rolls back PC, tokens and all action counters in a mined transaction', async () => {
    const s = await fixture();
    // Establish delegation through the real public SDK transport, then reuse
    // its configured executor for a bounded deliberately reverted transaction.
    await (
      await s.agent.universal.sendTransaction({
        to: f.ownerAddress,
        data: calls(ONE),
      })
    ).wait();
    await refused(
      s,
      () =>
        s.agent.universal.sendTransaction({
          to: f.ownerAddress,
          data: calls(BigInt(4)),
        }),
      'PolicyCheckReverted(NativeAmountExceedsCap)'
    );
    const executor = PUSH_BATCH_EXECUTOR_ADDRESS[CHAIN.PUSH_TESTNET_DONUT];
    if (!executor) throw new Error('Missing verified native batch executor');
    expect(
      (await f.push.getCode({ address: f.agentAddress }))?.toLowerCase()
    ).toBe(`0xef0100${executor.slice(2)}`.toLowerCase());
    const before = await state(s),
      nonce = await f.push.getTransactionCount({ address: f.agentAddress });
    const raw = createWalletClient({
      account: privateKeyToAccount(f.agentKey),
      chain: getPushViemChain(CHAIN.PUSH_TESTNET_DONUT),
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    const data = v5.encodeExecute(
      calls(BigInt(4)).map((c) => ({
        target: s.wallet,
        value: ZERO,
        data: v5.encodeExecuteAsAgent(s.id, {
          target: c.to,
          value: c.value,
          data: c.data,
        }),
      }))
    );
    const hash = await raw.sendTransaction({
      chain: raw.chain,
      to: f.agentAddress,
      data,
      gas: BigInt(600000),
    });
    const receipt = await f.push.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe('reverted');
    expect(receipt.logs).toHaveLength(0);
    expect(await state(s)).toEqual(before);
    expect(await f.push.getTransactionCount({ address: f.agentAddress })).toBe(
      nonce + 1
    );
    f.evidence('native-multi-mined-rollback', {
      wallet: s.wallet,
      id: s.id,
      hash,
      block: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      state: before,
    });
  });
  it('6. replacement guards every old action and records six checkpoints for a two-action rule', async () => {
    const s = await fixture();
    await (await sendPC(s)).wait();
    await (await sendToken(s, BigInt(2))).wait();
    const before = await state(s),
      input = rule();
    const replacement = await s.handle.rules.update({
      rules: [{ rulesId: s.id, rule: input }],
    });
    const next = replacement.rules[0].rulesId as Hex;
    expect(next).not.toBe(s.id);
    await expect(s.handle.rules.get(s.id)).rejects.toMatchObject({
      code: 'RULE_NOT_FOUND',
    });
    expect((await s.handle.rules.list()).rules.map((r) => r.rulesId)).toEqual([
      next,
    ]);
    expect(
      await f.push.readContract({
        address: s.wallet,
        abi: v5.abis.wallet,
        functionName: 'checkpointCount',
      })
    ).toBe(before.checkpointCount + BigInt(6));
    for (const { config: cfg } of await readNativeActionConfigs(
      f.push,
      f.manifest.addresses,
      s.wallet,
      next
    )) {
      expect(cfg).toMatchObject({
        valueSpent: ZERO,
        amountSpent: ZERO,
        callsUsed: 0,
      });
    }
    const reused = await sendToken(s);
    await reused.wait();
    expect(reused.agentic?.rulesId).toBe(next);
    const trimmed = await s.handle.rules.update({
      rules: [
        {
          rulesId: next,
          rule: { ...rule(), allowedCalls: [rule().allowedCalls[0]] },
        },
      ],
    });
    expect(
      (await s.handle.rules.get(trimmed.rules[0].rulesId)).rule
    ).toMatchObject({
      allowedCalls: [{ target: f.ownerAddress, selector: 'value-only' }],
    });
    const nonce = await f.push.getTransactionCount({ address: f.agentAddress });
    await expect(sendToken(s)).rejects.toMatchObject({
      decodedError: { name: 'NoPoliciesSet' },
    });
    expect(await f.push.getTransactionCount({ address: f.agentAddress })).toBe(
      nonce
    );
    f.evidence('native-multi-replacement', {
      wallet: s.wallet,
      oldId: s.id,
      newId: next,
      trimmedId: trimmed.rules[0].rulesId,
      hashes: [replacement.tx.hash, reused.hash, trimmed.tx.hash],
    });
  });
  it('7. spending the second action mid-update rejects the stale batch and a fresh retry succeeds', async () => {
    const s = await fixture(),
      before = await state(s);
    const runtime = (
      f.owner as unknown as {
        agenticRuntime: AgenticRuntime;
      }
    ).agenticRuntime;
    const original = runtime.execute;
    let injected = false,
      spendHash: string | undefined;
    runtime.execute = async (params, options) => {
      if (!injected && params.to === s.wallet) {
        injected = true;
        const tx = await sendToken(s);
        await tx.wait();
        spendHash = tx.hash;
      }
      return original(params, options);
    };
    try {
      await expect(
        s.handle.rules.update({ rules: [{ rulesId: s.id, rule: rule() }] })
      ).rejects.toMatchObject({
        decodedError: { name: 'SpentMismatch' },
      });
      expect(injected).toBe(true);
    } finally {
      runtime.execute = original;
    }
    const after = await state(s);
    expect(after.checkpointCount).toBe(before.checkpointCount);
    expect(after.grantNonce).toBe(before.grantNonce);
    expect(config(after, f.ownerAddress, '0xffffffff')).toEqual(
      config(before, f.ownerAddress, '0xffffffff')
    );
    expect(config(after, token, '0xa9059cbb')).toMatchObject({
      amountSpent: ONE,
      callsUsed: 1,
    });
    expect(after.walletToken).toBe(before.walletToken - ONE);
    expect((await s.handle.rules.list()).rules.map((r) => r.rulesId)).toEqual([
      s.id,
    ]);
    const retry = await s.handle.rules.update({
      rules: [{ rulesId: s.id, rule: rule() }],
    });
    expect(
      await f.push.readContract({
        address: s.wallet,
        abi: v5.abis.wallet,
        functionName: 'checkpointCount',
      })
    ).toBe(before.checkpointCount + BigInt(6));
    f.evidence('native-multi-second-action-race', {
      wallet: s.wallet,
      oldId: s.id,
      newId: retry.rules[0].rulesId,
      spendHash,
      retryHash: retry.tx.hash,
      stateAfterRace: after,
    });
  });
  it('8. eight unique native allowedCalls are accepted; duplicate, mixed and ninth-action inputs never sign', async () => {
    const allowedCalls = Array.from({ length: 8 }, (_, i) => ({
      target: getAddress(`0x${(0x1000 + i).toString(16).padStart(40, '0')}`),
      selector: 'value-only' as const,
    }));
    const input = {
      agent: f.agentAddress,
      validUntil: inSeconds(3600),
      allowedCalls,
    };
    const made = await f.owner.agentic.create('e2e-native-eight', {
      rules: [input],
    });
    expect(
      (
        (await f.owner.agentic.wallet(made.wallet).rules.get(made.rulesIds[0]))
          .rule as Rule
      ).allowedCalls
    ).toHaveLength(8);
    const invalid = [
      { ...input, allowedCalls: [] },
      {
        ...input,
        allowedCalls: [
          ...allowedCalls,
          {
            target: f.ownerAddress,
            selector: 'value-only',
          },
        ],
      },
      { ...input, allowedCalls: [allowedCalls[0], allowedCalls[0]] },
      { ...input, target: f.ownerAddress },
    ];
    const next = await f.owner.agentic.derive(),
      nonce = await f.push.getTransactionCount({ address: f.ownerAddress });
    for (const rule of invalid)
      await expect(
        f.owner.agentic.create('invalid-native-allowedCalls', {
          rules: [rule as Rule],
        })
      ).rejects.toMatchObject({
        code: expect.stringMatching(/INVALID_RULE|CAPABILITY_UNAVAILABLE/),
      });
    expect(await f.owner.agentic.derive()).toEqual(next);
    expect(await f.push.getTransactionCount({ address: f.ownerAddress })).toBe(
      nonce
    );
    f.evidence('native-multi-eight-boundary', {
      wallet: made.wallet,
      id: made.rulesIds[0],
      hash: made.tx.hash,
      unchangedNextSlot: next.index,
    });
  });
  it('9. one expiry applies to all calls and expired calls move nothing', async () => {
    const input = rule(),
      expiry = inSeconds(60);
    input.validUntil = expiry;
    const s = await fixture(input);
    expect((await s.handle.rules.get(s.id)).validUntil).toBe(expiry);
    const deadline = Date.now() + 120_000;
    while (Number((await f.push.getBlock()).timestamp) <= expiry) {
      if (Date.now() > deadline) throw Error('Donut expiry wait timed out');
      await new Promise((r) => setTimeout(r, 2000));
    }
    await refused(s, () => sendPC(s), 'PolicyCheckReverted(RulesExpired)');
    await refused(s, () => sendToken(s), 'PolicyCheckReverted(RulesExpired)');
    f.evidence('native-multi-shared-expiry', {
      wallet: s.wallet,
      id: s.id,
      expiry,
    });
  }, 300_000);

  it('10. malformed action objects and invalid rule expiry return structured errors before signing', async () => {
    const base = rule(),
      next = await f.owner.agentic.derive(),
      nonce = await f.push.getTransactionCount({ address: f.ownerAddress });
    const invalid = [
      { ...base, allowedCalls: [null] },
      { ...base, allowedCalls: [42] },
      {
        ...base,
        validUntil: undefined,
        allowedCalls: [
          {
            ...base.allowedCalls[0],
          },
        ],
      },
      {
        ...base,
        validUntil: 1,
        allowedCalls: [
          {
            ...base.allowedCalls[0],
          },
        ],
      },
    ];
    for (const input of invalid)
      await expect(
        f.owner.agentic.create('invalid-multi-action', {
          rules: [input as unknown as Rule],
        })
      ).rejects.toMatchObject({ name: 'AgenticError', code: 'INVALID_RULE' });
    expect(await f.owner.agentic.derive()).toEqual(next);
    expect(await f.push.getTransactionCount({ address: f.ownerAddress })).toBe(
      nonce
    );
    f.evidence('native-multi-invalid-input', {
      unchangedNextSlot: next.index,
      ownerNonce: nonce,
    });
  });
});
