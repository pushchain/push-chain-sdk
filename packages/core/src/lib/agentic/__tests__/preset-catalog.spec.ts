import { encodeFunctionData, parseAbi, getAddress, type Address } from 'viem';
import { agenticPresets } from '../presets';
import { AGENTIC } from '../constants';
import { evmPinOffset, normalizePublicRule, publicRules } from '../public-rule';
import { parseSelector } from '../codec/selectors';
import type { Rule, UniversalRule } from '../agentic.types';
import { FakeChain, ADDR } from './fake-chain';
import { mockRuntime } from './mock-runtime';
const tokenA = ADDR.target,
  tokenB = ADDR.other;
const chain = 'eip155:11155111';
const input: import('../presets/types').ReadyPresetOptions = {
  chainNamespace: chain,
  agent: ADDR.agent,
  validUntil: 2_000_000_000,
  maxGasPerCall: BigInt(1),
  assets: [
    { token: tokenA, maxPerCall: BigInt(5), maxTotal: BigInt(10) },
    { token: tokenB, maxPerCall: BigInt(7), maxTotal: BigInt(14) },
  ],
};
it('expands both token directions and exact-input/output with wallet and amount pins', () => {
  const { rules } = agenticPresets.get('DEXES', input);
  expect(rules).toHaveLength(1);
  expect(rules[0].allowedCalls).toHaveLength(6);
  const swaps = rules[0].allowedCalls.filter((c) =>
    c.selector.startsWith('exact')
  );
  expect(swaps).toHaveLength(4);
  expect(swaps[0].pins).toEqual([
    { arg: [0, 0], expected: tokenA },
    { arg: [0, 1], expected: tokenB },
    { arg: [0, 3], expected: AGENTIC.WALLET },
    { arg: [0, 4], max: BigInt(5) },
  ]);
  expect(swaps[1].pins?.at(-1)).toEqual({ arg: [0, 5], max: BigInt(5) });
  expect(swaps[2].pins?.at(-1)).toEqual({ arg: [0, 4], max: BigInt(7) });
  expect(
    rules[0].allowedCalls.reduce((n, c) => n + (c.pins?.length ?? 0), 0)
  ).toBe(20);
});
it('rejects native-token markers and oversized pin expansion', () => {
  expect(() =>
    agenticPresets.get('DEXES', {
      ...input,
      assets: [...input.assets!, { token: ADDR.owner }],
    })
  ).toThrow(/32 pins/);
  expect(() =>
    agenticPresets.get('DEXES', {
      ...input,
      assets: [
        { token: '0x0000000000000000000000000000000000000000' },
        input.assets![1],
      ],
    })
  ).toThrow(/ERC20/);
});
it('defaults omitted caps to zero without introducing an unlimited approval', () => {
  const r = agenticPresets.get('DEXES', {
    ...input,
    assets: [{ token: tokenA }, { token: tokenB }],
  }).rules[0];
  expect(
    r.assets?.every(
      (a) => a.maxPerCall === BigInt(0) && a.maxTotal === BigInt(0)
    )
  ).toBe(true);
  expect(
    r.allowedCalls.every((c) => c.pins?.some((p) => p.max === BigInt(0)))
  ).toBe(true);
});
it('scopes money-market approvals to their actual underlying token', () => {
  const underlying = '0x4616975f7E6045FD9737e95bC527e9e14c727BD2' as Address;
  const r = agenticPresets.get('LENDING', {
    chainNamespace: 'eip155:84532',
    assets: [{ token: underlying, maxPerCall: BigInt(2) }],
  }).rules[0];
  const approvals = r.allowedCalls.filter(
    (c) => c.selector === 'approve(address,uint256)'
  );
  expect(approvals).toHaveLength(1); // Only mUSDbC: this mock token is not an Aave reserve.
  expect(approvals.flatMap((c) => c.pins ?? [])).not.toContainEqual({
    arg: 0,
    expected: getAddress('0x2F39a349A79492a70E152760ce7123A1933eCf28'),
  });
});
it.each([
  'eip155:1',
  'eip155:8453',
  'eip155:42161',
  'eip155:56',
  'eip155:11155111',
  'eip155:84532',
  'eip155:421614',
  'eip155:97',
] as const)(
  'normalizes every DEX call on %s to the exact ABI bytes',
  async (chainNamespace) => {
    const r = agenticPresets.get('DEXES', { ...input, chainNamespace })
      .rules[0];
    const rt = mockRuntime(new FakeChain());
    const out = (await normalizePublicRule(
      publicRules([r])[0],
      ADDR.owner,
      rt
    )) as UniversalRule;
    const cea = getAddress(
      (await rt.resolveCEA(ADDR.owner, chainNamespace as never)).cea
    );
    for (const call of out.allowedCalls.filter((c) =>
      String(c.selector).startsWith('exact')
    )) {
      const pins = call.pins!;
      const values = [
        `0x${pins[0].value.slice(-40)}`,
        `0x${pins[1].value.slice(-40)}`,
        3000,
        cea,
        BigInt(1),
        BigInt(1),
        BigInt(0),
      ] as const;
      const data = encodeFunctionData({
        abi: parseAbi([`function ${call.selector}`] as string[]),
        functionName: String(call.selector).split('(')[0],
        args: [values],
      });
      for (const pin of pins.filter((p) => p.op === 0))
        expect(
          `0x${data.slice(
            2 + pin.offset * 2,
            2 + (pin.offset + 32) * 2
          )}`.toLowerCase()
        ).toBe(pin.value.toLowerCase());
      expect(pins.map((p) => p.offset)).toEqual([
        4,
        36,
        100,
        String(call.selector).startsWith('exactInput') ? 132 : 164,
      ]);
    }
  }
);
it('supports tuple/fixed-array positions but never descends into dynamic storage', () => {
  const sig =
    'exchange(address[11],uint256[5][5],uint256,uint256,address[5],address)' as const;
  expect(evmPinOffset(sig, 5)).toBe(4 + 43 * 32);
  expect(evmPinOffset(sig, [0, 0])).toBe(4);
  expect(evmPinOffset(sig, [1, 2, 3])).toBe(4 + 24 * 32);
  expect(evmPinOffset('f((address,address,uint256))', [0, 1])).toBe(36);
  expect(() => evmPinOffset('f((bytes,address))', [0, 1])).toThrow(/dynamic/);
  expect(() => evmPinOffset('f(address[])', [0, 0])).toThrow(/dynamic/);
  expect(() => evmPinOffset('f((address,address))', [0, 2])).toThrow(/range/);
  expect(() => evmPinOffset('0x12345678', [0, 1])).toThrow(/scalar/);
});
it('tuple-authored pins re-encode using the raw-selector word indexes returned by reads', async () => {
  const r = agenticPresets.get('DEXES', input).rules[0];
  const rt = mockRuntime(new FakeChain());
  const first = (await normalizePublicRule(
    publicRules([r])[0],
    ADDR.owner,
    rt
  )) as UniversalRule;
  const decoded: Rule = {
    ...r,
    allowedCalls: first.allowedCalls.map((c) => ({
      target: c.target,
      selector: parseSelector(c.selector).selector,
      maxValue: c.maxValue,
      pins: c.pins?.map((p) =>
        p.op === 0
          ? { arg: (p.offset - 4) / 32, expected: p.value }
          : { arg: (p.offset - 4) / 32, max: BigInt(p.value) }
      ),
    })),
  };
  const second = (await normalizePublicRule(
    publicRules([decoded])[0],
    ADDR.owner,
    rt
  )) as UniversalRule;
  expect(second.allowedCalls.map((c) => c.pins)).toEqual(
    first.allowedCalls.map((c) => c.pins)
  );
});
it('mutating a returned tuple path cannot change a later preset', () => {
  const r = agenticPresets.get('DEXES', input).rules[0];
  (r.allowedCalls[0].pins![0].arg as number[])[1] = 99;
  expect(
    agenticPresets.get('DEXES', input).rules[0].allowedCalls[0].pins![0].arg
  ).toEqual([0, 0]);
});

it('includes a curated capped token pair and exact pair pins on every DEX chain', () => {
  const { rules, readiness } = agenticPresets.get('DEXES');
  expect(rules.map((r) => r.chainNamespace)).toEqual(
    agenticPresets.list().presets.find((p) => p.constant === 'DEXES')!.chains
  );
  for (const rule of rules) {
    expect(rule).not.toHaveProperty('agent');
    expect(rule.validUntil).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(rule.assets).toHaveLength(2);
    expect(
      rule.assets!.every(
        (a) =>
          a.maxPerCall > BigInt(0) && (a.maxTotal ?? BigInt(0)) >= a.maxPerCall
      )
    ).toBe(true);
    expect(rule.allowedCalls).toHaveLength(6);
    const swaps = rule.allowedCalls.filter((c) =>
      c.selector.startsWith('exact')
    );
    expect(swaps).toHaveLength(4);
    for (const call of swaps) {
      expect(call.pins).toHaveLength(4);
      expect(call.pins).toContainEqual({
        arg: [0, 3],
        expected: AGENTIC.WALLET,
      });
      expect(call.pins?.at(-1)?.max).toBeGreaterThan(BigInt(0));
      expect(call.label).not.toContain('select two tokens');
    }
  }
  expect(readiness.chains.every((c) => c.knownTokens.length >= 2)).toBe(true);
  expect(
    readiness.chains.every(
      (c) => !c.issues.some((i) => i.code === 'TOKEN_PAIR_REQUIRED')
    )
  ).toBe(true);
});
it('keeps single-token swaps disabled and generates approvals only for the supplied asset', () => {
  const rule = agenticPresets.get('DEXES', {
    ...input,
    assets: [input.assets![0]],
  }).rules[0];
  expect(rule.assets).toEqual([input.assets![0]]);
  expect(rule.allowedCalls).toHaveLength(3);
  for (const call of rule.allowedCalls.slice(0, 2)) {
    expect(call.pins).toContainEqual({ arg: [0, 0], expected: tokenA });
    expect(call.pins?.at(-1)?.max).toBe(BigInt(0));
  }
  expect(rule.allowedCalls[2].selector).toBe('approve(address,uint256)');
  expect(rule.allowedCalls[2].target).toBe(tokenA);
});
it('keeps chains without supplied assets discoverable and regenerates complete pairs without disabled alternatives', () => {
  const { rules } = agenticPresets.get('DEXES', {
    assets: input.assets!.map((a) => ({ ...a, chainNamespace: chain })),
  });
  expect(rules).toHaveLength(8);
  expect(
    rules.find((r) => r.chainNamespace === chain)?.allowedCalls
  ).toHaveLength(6);
  for (const r of rules.filter((r) => r.chainNamespace !== chain)) {
    expect(r.assets).toEqual([]);
    expect(r.allowedCalls).toHaveLength(2);
    expect(r.allowedCalls.every((c) => c.pins?.at(-1)?.max === BigInt(0))).toBe(
      true
    );
  }
  const preview = agenticPresets.get('DEXES', {
    chainNamespace: chain,
    assets: [],
  }).rules[0];
  const ready = agenticPresets.get('DEXES', input).rules[0];
  expect(preview.allowedCalls).toHaveLength(2);
  expect(ready.allowedCalls).toHaveLength(6);
  expect(
    ready.allowedCalls.every((c) => !c.label?.includes('select two tokens'))
  ).toBe(true);
});

it.each(['eip155:1', 'eip155:8453', 'eip155:42161', 'eip155:56'] as const)(
  'mainnet %s templates preserve one rule per chain, selectors and wallet pins',
  (chainNamespace) => {
    for (const category of ['DEXES', 'LENDING'] as const) {
      const { rules } = agenticPresets.get(category, { chainNamespace });
      expect(rules).toHaveLength(1);
      expect(rules[0].chainNamespace).toBe(chainNamespace);
      expect(rules[0].allowedCalls.length).toBeLessThanOrEqual(32);
      expect(rules[0].allowedCalls.every((c) => c.selector.includes('('))).toBe(
        true
      );
      expect(
        rules[0].allowedCalls.some((c) =>
          c.pins?.some((p) => p.expected === AGENTIC.WALLET)
        )
      ).toBe(true);
      expect(rules[0]).not.toHaveProperty('agent');
    }
  }
);

it('mainnet Lido uses the selected token units and excludes unbounded withdrawal/claim methods', () => {
  const stETH = getAddress('0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84');
  const { rules, readiness } = agenticPresets.get('STAKING', {
    chainNamespace: 'eip155:1',
    assets: [{ token: stETH, maxPerCall: BigInt(5), maxTotal: BigInt(10) }],
  });
  const calls = rules[0].allowedCalls;
  expect(
    calls.find((c) => c.selector === 'wrap(uint256)')?.pins
  ).toContainEqual({ arg: 0, max: BigInt(5) });
  expect(calls.some((c) => c.selector === 'submit(address)')).toBe(false);
  expect(
    calls.some(
      (c) =>
        c.selector.startsWith('requestWithdrawals') ||
        c.selector.startsWith('claimWithdraw')
    )
  ).toBe(false);
  expect(readiness.chains[0].excludedCalls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        selector: 'requestWithdrawals(uint256[],address)',
        reason: 'DYNAMIC_AMOUNT',
      }),
      expect.objectContaining({
        selector: 'claimWithdrawal(uint256)',
        reason: 'POSITION_AMOUNT',
      }),
    ])
  );
  expect(
    calls.filter((c) => c.selector === 'approve(address,uint256)')
  ).toHaveLength(2);
});
