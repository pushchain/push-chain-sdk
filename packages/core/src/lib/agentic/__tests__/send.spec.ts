import { decodeAbiParameters, decodeFunctionData, encodeFunctionData, getAddress, maxUint256, type Address, type Hex } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { UNIVERSAL_GATEWAY_PC, ERC20_EVM } from '../../constants/abi';
import { PushChainExecutionError } from '../../orchestrator/internals/errors';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import { AgenticCapability } from '../capabilities';
import type { AgenticExecutionContext } from '../context';
import { currentGeneration, resetAgenticGenerations } from '../deployments';
import { e704d5b } from '../contracts/e704d5b';
import { actionId } from '../codec/ids';
import { AGENTIC_ERROR_CODE, AgenticRevertError } from '../errors';
import { agenticSend } from '../execution/send';
import { ADDR, FakeChain, SEPOLIA_NS, registerFakeGeneration, ruleId } from './fake-chain';
import { mockRuntime } from './mock-runtime';

const data = '0xd09de08a' as Hex;

function setup(door: 'owner' | 'agent', rules = (f: FakeChain) => [f.nativeRule(ADDR.agent, ruleId(1))]) {
  registerFakeGeneration();
  const fake = new FakeChain();
  const w = fake.addWallet(ADDR.owner, 'w', rules(fake));
  const gen = currentGeneration(PUSH_NETWORK.TESTNET_DONUT);
  const signer = door === 'owner' ? ADDR.owner : ADDR.agent;
  const ctx: AgenticExecutionContext = {
    wallet: w.address,
    door,
    signerPushAccount: signer,
    signerOrigin: { chain: CHAIN.PUSH_TESTNET_DONUT, address: signer },
    generation: gen,
  };
  return { fake, w, gen, ctx, rt: mockRuntime(fake, { signer }) };
}

afterEach(() => resetAgenticGenerations());

describe('guards fail before the signer is ever invoked', () => {
  it.each([
    ['from (Routes 3/4)', { to: ADDR.target, data, from: { chain: CHAIN.ETHEREUM_SEPOLIA } }, AGENTIC_ERROR_CODE.FROM_NOT_ALLOWED],
    ['payGasWith', { to: ADDR.target, data, payGasWith: {} }, AGENTIC_ERROR_CODE.NOT_ALLOWED_IN_AGENTIC_MODE],
    ['migration', { to: { address: ADDR.target, chain: CHAIN.ETHEREUM_SEPOLIA }, migration: true }, AGENTIC_ERROR_CODE.NOT_ALLOWED_IN_AGENTIC_MODE],
    ['funds on a Push send', { to: ADDR.target, funds: { amount: BigInt(1) } }, AGENTIC_ERROR_CODE.NOT_ALLOWED_IN_AGENTIC_MODE],
  ])('%s', async (_name, params, code) => {
    const { rt, ctx } = setup('agent');
    await expect(agenticSend(rt, ctx, params as never)).rejects.toMatchObject({ code });
    expect(rt.executeMock).not.toHaveBeenCalled();
  });

  it('read-only clients never sign', async () => {
    const { fake, ctx } = setup('owner');
    const rt = mockRuntime(fake, { signer: ADDR.owner, readOnly: true });
    await expect(agenticSend(rt, ctx, { to: ADDR.target, data })).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.READ_ONLY,
    });
    expect(rt.executeMock).not.toHaveBeenCalled();
  });

  it('agent native arrays are refused (A02)', async () => {
    const { rt, ctx } = setup('agent');
    await expect(
      agenticSend(rt, ctx, {
        to: ADDR.target,
        data: [
          { to: ADDR.target, value: BigInt(0), data },
          { to: ADDR.target, value: BigInt(0), data },
        ],
      })
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.NOT_ALLOWED_IN_AGENTIC_MODE });
    expect(rt.executeMock).not.toHaveBeenCalled();
  });

  it('NO_RULES_FOR_CHAIN and DUPLICATE_RULE are pre-signature', async () => {
    const none = setup('agent', () => []);
    await expect(agenticSend(none.rt, none.ctx, { to: ADDR.target, data })).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.NO_RULES_FOR_CHAIN,
    });
    const dup = setup('agent', (f) => [f.nativeRule(ADDR.agent, ruleId(1)), f.nativeRule(ADDR.agent, ruleId(2))]);
    await expect(agenticSend(dup.rt, dup.ctx, { to: ADDR.target, data })).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.DUPLICATE_RULE,
    });
    expect(none.rt.executeMock).not.toHaveBeenCalled();
    expect(dup.rt.executeMock).not.toHaveBeenCalled();
  });

  it('an external agent whose deployed UEA cannot pay Push gas fails loudly; an undeployed UEA takes the first-use path', async () => {
    const { fake, ctx } = setup('agent');
    const poor = mockRuntime(fake, {
      signer: ADDR.agent,
      signerIsPushNative: () => false,
      signerAccountDeployed: async () => true,
      signerBalance: async () => BigInt(5),
      getGasPrice: async () => BigInt(1),
    });
    await expect(agenticSend(poor, ctx, { to: ADDR.target, data })).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.AGENT_GAS_INSUFFICIENT,
    });
    expect(poor.executeMock).not.toHaveBeenCalled();
    const firstUse = mockRuntime(fake, {
      signer: ADDR.agent,
      signerIsPushNative: () => false,
      signerAccountDeployed: async () => false,
      signerBalance: async () => BigInt(0),
    });
    await agenticSend(firstUse, ctx, { to: ADDR.target, data });
    expect(firstUse.executeMock).toHaveBeenCalledTimes(1);
  });
});

describe('explicit Push destinations', () => {
  it('a ChainTarget on the connected Push chain is a native send, same as a bare address', async () => {
    const { rt, ctx } = setup('agent');
    const tx = await agenticSend(rt, ctx, { to: { address: ADDR.target, chain: CHAIN.PUSH_TESTNET_DONUT }, data });
    expect(e704d5b.decodeWalletCall(rt.executeMock.mock.calls[0][0].data)).toMatchObject({ kind: 'executeAsAgent', rulesId: ruleId(1) });
    expect(tx.route).not.toBe('UOA_TO_CEA');
    expect(tx.to).toBe(ADDR.target);
  });

  it('the owner door treats it the same way', async () => {
    const { rt, ctx } = setup('owner');
    await agenticSend(rt, ctx, { to: { address: ADDR.target, chain: CHAIN.PUSH_TESTNET }, data });
    expect(e704d5b.decodeWalletCall(rt.executeMock.mock.calls[0][0].data)).toMatchObject({ kind: 'execute', calls: [{ target: ADDR.target }] });
  });

  it('another Push network is refused, not routed outbound', async () => {
    const { rt, ctx } = setup('owner');
    await expect(agenticSend(rt, ctx, { to: { address: ADDR.target, chain: CHAIN.PUSH_MAINNET }, data })).rejects.toThrow(
      /other than the connected network/
    );
    expect(rt.executeMock).not.toHaveBeenCalled();
  });
});

describe('native wrapping and logical identity', () => {
  it('agent door: executeAsAgent(selected rule, exact call); response shows the wallet as from', async () => {
    const { rt, ctx, w } = setup('agent');
    const perCall = jest.fn();
    const tx = await agenticSend(rt, ctx, { to: ADDR.target, data, value: BigInt(3) }, { progressHook: perCall });
    const sent = rt.executeMock.mock.calls[0][0];
    expect(sent.to).toBe(w.address);
    expect(sent.value).toBe(BigInt(0));
    expect(e704d5b.decodeWalletCall(sent.data)).toEqual({
      kind: 'executeAsAgent',
      rulesId: ruleId(1),
      mode: `0x${'00'.repeat(32)}`,
      calls: [{ target: ADDR.target, value: BigInt(3), data }],
    });
    expect(tx).toMatchObject({ from: w.address, to: ADDR.target, data, value: BigInt(3) });
    expect(tx.origin).toContain(ADDR.agent);
    expect(tx.agentic).toMatchObject({ wallet: w.address, door: 'agent', rulesId: ruleId(1), rawTo: w.address });
    const ids = rt.events.map((e) => e.id);
    expect(ids).toEqual([PROGRESS_HOOK.AGENTIC_TX_107, PROGRESS_HOOK.AGENTIC_TX_199_01]);
    expect(perCall).toHaveBeenCalledTimes(2);
    expect(rt.executeMock.mock.calls[0][1]).toMatchObject({ progressHook: perCall });
  });

  it('owner door: arrays become one atomic execute(batch)', async () => {
    const { rt, ctx } = setup('owner');
    await agenticSend(rt, ctx, {
      to: ADDR.target,
      data: [
        { to: ADDR.target, value: BigInt(0), data },
        { to: ADDR.other, value: BigInt(1), data: '0x' },
      ],
    });
    const decoded = e704d5b.decodeWalletCall(rt.executeMock.mock.calls[0][0].data);
    expect(decoded).toMatchObject({ kind: 'execute', mode: `0x01${'00'.repeat(31)}` });
    expect((decoded as { calls: unknown[] }).calls).toHaveLength(2);
  });

  it('wallet waits report the wallet on the receipt too', async () => {
    const { rt, ctx, w } = setup('agent');
    const tx = await agenticSend(rt, ctx, { to: ADDR.target, data });
    expect((await tx.wait()).from).toBe(w.address);
  });

  it('an on-chain policy revert becomes AgenticRevertError with the decoded gate and 199-02', async () => {
    const { fake, ctx } = setup('agent');
    const rt = mockRuntime(fake, {
      signer: ADDR.agent,
      execute: async () => {
        throw new PushChainExecutionError(
          'Execution reverted with reason: custom error 0xf4270752: 8bb88ba100000000000000000000000000000000000000000000000000000000.'
        );
      },
    });
    const err = await agenticSend(rt, ctx, { to: ADDR.target, data }).catch((e) => e);
    expect(err).toBeInstanceOf(AgenticRevertError);
    expect(err).toBeInstanceOf(PushChainExecutionError);
    expect(err.decodedError.name).toBe('PolicyCheckReverted(CallLimitReached)');
    const failed = rt.events.find((e) => e.id === PROGRESS_HOOK.AGENTIC_TX_199_02);
    expect(failed?.response).toMatchObject({ decodedError: { name: 'PolicyCheckReverted(CallLimitReached)' } });
  });
});

describe('EVM outbound composition from the wallet', () => {
  const token = getAddress('0x0000000000000000000000000000000000007070');
  const universalSetup = () => {
    const s = setup('agent', (f) => [
      {
        ...f.nativeRule(ADDR.agent, ruleId(5)),
        mode: 0,
        chain: SEPOLIA_NS,
        actionIds: [],
        universal: { asset: token, expectedCEA: getAddress('0x000000000000000000000000000000000000cea1'), maxPCPerCall: BigInt(5000) },
      },
    ]);
    // universal action id is (gateway, sendUniversalTxOutbound)
    s.w.rules[0].actionIds = [actionId(ADDR.gateway, '0x77b86bec')];
    s.fake.balances.set(`pc:${s.w.address.toLowerCase()}`, BigInt(10) ** BigInt(18));
    s.fake.balances.set(`balanceOf:${token.toLowerCase()}`, BigInt(1000));
    s.fake.balances.set(`allowance:${token.toLowerCase()}`, BigInt(500));
    return s;
  };
  const send = (amount?: bigint) => ({
    to: { address: ADDR.target, chain: CHAIN.ETHEREUM_SEPOLIA },
    data,
    ...(amount ? { funds: { amount, token: { symbol: 'USDC', decimals: 6, address: token, mechanism: 'approve' as const } } } : {}),
  });

  it('builds the policy-compatible request: empty recipient, wallet refund, nonzero gas cap, multicall payload, CEA of the wallet', async () => {
    const s = universalSetup();
    const resolveCEA = jest.fn(async () => ({ cea: getAddress('0x000000000000000000000000000000000000cea1'), isDeployed: true }));
    const rt = mockRuntime(s.fake, { signer: ADDR.agent, resolveCEA, resolvePrc20: () => token });
    const tx = await agenticSend(rt, s.ctx, send(BigInt(100)));
    expect(resolveCEA).toHaveBeenCalledWith(s.w.address, CHAIN.ETHEREUM_SEPOLIA);
    const outer = e704d5b.decodeWalletCall(rt.executeMock.mock.calls[0][0].data) as { kind: string; rulesId: Hex; calls: { target: Address; value: bigint; data: Hex }[] };
    expect(outer.kind).toBe('executeAsAgent');
    expect(outer.rulesId).toBe(ruleId(5));
    expect(outer.calls[0].target).toBe(ADDR.gateway);
    expect(outer.calls[0].value).toBe(BigInt(1100));
    const { args } = decodeFunctionData({ abi: UNIVERSAL_GATEWAY_PC, data: outer.calls[0].data });
    expect(args[0]).toMatchObject({
      recipient: '0x',
      token,
      amount: BigInt(100),
      maxPCForGas: BigInt(1000),
      revertRecipient: s.w.address,
    });
    expect((args[0] as { payload: Hex }).payload.startsWith('0x2cc2842d')).toBe(true);
    expect(tx).toMatchObject({ from: s.w.address, to: token, data: encodeFunctionData({ abi: ERC20_EVM, functionName: 'transfer', args: [ADDR.target, BigInt(100)] }), route: 'UOA_TO_CEA', chain: CHAIN.ETHEREUM_SEPOLIA });
    expect(tx.agentic?.destinationCalls).toHaveLength(2);
    expect(tx.agentic?.destinationAccount).toBe(getAddress('0x000000000000000000000000000000000000cea1'));
  });

  it('never injects an approval into the agent path; missing allowance fails before signing', async () => {
    const s = universalSetup();
    s.fake.balances.set(`allowance:${token.toLowerCase()}`, BigInt(10));
    const rt = mockRuntime(s.fake, { signer: ADDR.agent, resolvePrc20: () => token });
    await expect(agenticSend(rt, s.ctx, send(BigInt(100)))).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.GATEWAY_ALLOWANCE_INSUFFICIENT,
    });
    expect(rt.executeMock).not.toHaveBeenCalled();
  });

  it('wallet PC below protocol fee + gas cap, or over the rule PC cap, fails before signing', async () => {
    const s = universalSetup();
    s.fake.balances.set(`pc:${s.w.address.toLowerCase()}`, BigInt(10));
    const rt = mockRuntime(s.fake, { signer: ADDR.agent, resolvePrc20: () => token });
    await expect(agenticSend(rt, s.ctx, send())).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.WALLET_BALANCE_INSUFFICIENT });
    const s2 = universalSetup();
    const pricey = mockRuntime(s2.fake, {
      signer: ADDR.agent,
      resolvePrc20: () => token,
      quoteOutbound: async () => ({ protocolFee: BigInt(100), nativeValueForGas: BigInt(10_000), gasLimitUsed: BigInt(1) }),
    });
    await expect(agenticSend(pricey, s2.ctx, send())).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.RULE_LIMIT_EXCEEDED });
  });

  it('a committed destination account that no longer matches derivation is drift, not a send', async () => {
    const s = universalSetup();
    const rt = mockRuntime(s.fake, {
      signer: ADDR.agent,
      resolvePrc20: () => token,
      resolveCEA: async () => ({ cea: getAddress('0x000000000000000000000000000000000000dead'), isDeployed: true }),
    });
    await expect(agenticSend(rt, s.ctx, send())).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.INCONSISTENT_READ });
  });

  it('a zero gas quote is refused (URP rejects an uncapped gas swap)', async () => {
    const s = universalSetup();
    const rt = mockRuntime(s.fake, {
      signer: ADDR.agent,
      resolvePrc20: () => token,
      quoteOutbound: async () => ({ protocolFee: BigInt(1), nativeValueForGas: BigInt(0), gasLimitUsed: BigInt(1) }),
    });
    await expect(agenticSend(rt, s.ctx, send())).rejects.toThrow(/uncapped gas swap/);
  });

  it('SVM destinations are capability-gated', async () => {
    const s = universalSetup();
    const rt = mockRuntime(s.fake, { signer: ADDR.agent });
    await expect(
      agenticSend(rt, { ...s.ctx, door: 'owner' }, { to: { address: ADDR.target, chain: CHAIN.SOLANA_DEVNET }, data })
    ).rejects.toMatchObject({ details: { capability: AgenticCapability.UNIVERSAL_SVM_RULES } });
  });

  it('owner door never writes an allowance: it sends only the outbound and consumes the existing allowance', async () => {
    const s = universalSetup();
    s.ctx.door = 'owner';
    s.ctx.signerPushAccount = ADDR.owner;
    const rt = mockRuntime(s.fake, { signer: ADDR.owner, resolvePrc20: () => token });
    await agenticSend(rt, s.ctx, send(BigInt(100)));
    const outer = e704d5b.decodeWalletCall(rt.executeMock.mock.calls[0][0].data) as { kind: string; calls: { target: Address; data: Hex }[] };
    expect(outer.kind).toBe('execute');
    expect(outer.calls.map((c) => c.target)).toEqual([ADDR.gateway]);
  });

  it('owner door with too small an allowance fails before signing (no implicit approval)', async () => {
    const s = universalSetup();
    s.ctx.door = 'owner';
    s.ctx.signerPushAccount = ADDR.owner;
    s.fake.balances.set(`allowance:${token.toLowerCase()}`, BigInt(10));
    const rt = mockRuntime(s.fake, { signer: ADDR.owner, resolvePrc20: () => token });
    await expect(agenticSend(rt, s.ctx, send(BigInt(100)))).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.GATEWAY_ALLOWANCE_INSUFFICIENT,
    });
    expect(rt.executeMock).not.toHaveBeenCalled();
  });

  it('an existing unlimited allowance is consumed as-is', async () => {
    const s = universalSetup();
    s.ctx.door = 'owner';
    s.ctx.signerPushAccount = ADDR.owner;
    s.fake.balances.set(`allowance:${token.toLowerCase()}`, maxUint256);
    const rt = mockRuntime(s.fake, { signer: ADDR.owner, resolvePrc20: () => token });
    await expect(agenticSend(rt, s.ctx, send(BigInt(100)))).resolves.toBeDefined();
  });

  it('a transfer-only ERC-20 outbound instructs a transfer to the requested recipient', async () => {
    const s = universalSetup();
    s.ctx.door = 'owner';
    s.ctx.signerPushAccount = ADDR.owner;
    const rt = mockRuntime(s.fake, { signer: ADDR.owner, resolvePrc20: () => token });
    const recipient = getAddress('0x00000000000000000000000000000000000ab0b0');
    const usdc = { symbol: 'USDC', decimals: 6, address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', mechanism: 'approve' as const };
    const tx = await agenticSend(rt, s.ctx, { to: { address: recipient, chain: CHAIN.ETHEREUM_SEPOLIA }, funds: { amount: BigInt(100), token: usdc } });
    const outer = e704d5b.decodeWalletCall(rt.executeMock.mock.calls[0][0].data) as { calls: { data: Hex }[] };
    const { args } = decodeFunctionData({ abi: UNIVERSAL_GATEWAY_PC, data: outer.calls[0].data });
    const payload = (args[0] as { payload: Hex }).payload;
    const [calls] = decodeAbiParameters(
      [{ type: 'tuple[]', components: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }] }],
      `0x${payload.slice(10)}`
    );
    expect(calls).toHaveLength(1);
    expect(getAddress(calls[0].to)).toBe(getAddress(usdc.address));
    expect(decodeFunctionData({ abi: ERC20_EVM, data: calls[0].data }).args).toEqual([recipient, BigInt(100)]);
    expect(tx.to).toBe(getAddress(usdc.address));
    expect(tx.data).toBe(calls[0].data);
    expect(tx.agentic?.destinationCalls).toEqual(calls.map((c) => ({ ...c, to: getAddress(c.to) })));
  });

  it('a value-only outbound burns the native PRC20 for that value and forwards it to the recipient', async () => {
    const s = universalSetup();
    s.ctx.door = 'owner';
    s.ctx.signerPushAccount = ADDR.owner;
    const native = getAddress('0x0000000000000000000000000000000000000e7e');
    s.fake.balances.set(`balanceOf:${native.toLowerCase()}`, BigInt(1000));
    s.fake.balances.set(`allowance:${native.toLowerCase()}`, BigInt(1000));
    const rt = mockRuntime(s.fake, { signer: ADDR.owner, resolvePrc20: () => native });
    await agenticSend(rt, s.ctx, { to: { address: ADDR.other, chain: CHAIN.ETHEREUM_SEPOLIA }, value: BigInt(7) });
    const outer = e704d5b.decodeWalletCall(rt.executeMock.mock.calls[0][0].data) as { calls: { data: Hex }[] };
    const req = decodeFunctionData({ abi: UNIVERSAL_GATEWAY_PC, data: outer.calls[0].data }).args[0] as { amount: bigint; payload: Hex };
    expect(req.amount).toBe(BigInt(7));
    expect(req.payload.toLowerCase()).toContain(ADDR.other.slice(2).toLowerCase());
  });

  it('an outbound with no destination call (parking in the CEA) is refused before signing', async () => {
    const s = universalSetup();
    s.ctx.door = 'owner';
    s.ctx.signerPushAccount = ADDR.owner;
    const cea = getAddress('0x000000000000000000000000000000000000cea1');
    const rt = mockRuntime(s.fake, { signer: ADDR.owner, resolvePrc20: () => token, resolveCEA: async () => ({ cea, isDeployed: true }) });
    await expect(
      agenticSend(rt, s.ctx, { to: { address: cea, chain: CHAIN.ETHEREUM_SEPOLIA }, value: BigInt(1) })
    ).rejects.toThrow(/no destination call/);
    expect(rt.executeMock).not.toHaveBeenCalled();
  });

  it('an agent value-only destination call is refused before signing (the policy admits only allow-listed calls)', async () => {
    const s = universalSetup();
    const rt = mockRuntime(s.fake, { signer: ADDR.agent, resolvePrc20: () => token });
    await expect(
      agenticSend(rt, s.ctx, { to: { address: ADDR.other, chain: CHAIN.ETHEREUM_SEPOLIA }, funds: { amount: BigInt(1), token: { symbol: 'X', decimals: 6, address: token, mechanism: 'native' } } })
    ).rejects.toThrow(/no function selector/);
  });

  it('more than 10 destination calls are refused', async () => {
    const s = universalSetup();
    const rt = mockRuntime(s.fake, { signer: ADDR.agent, resolvePrc20: () => token });
    await expect(
      agenticSend(rt, s.ctx, {
        to: { address: ADDR.target, chain: CHAIN.ETHEREUM_SEPOLIA },
        data: Array.from({ length: 11 }, () => ({ to: ADDR.target, value: BigInt(0), data })),
      })
    ).rejects.toThrow(/at most 10/);
  });
});

