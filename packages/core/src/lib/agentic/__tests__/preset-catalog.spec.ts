import {
  encodeFunctionData,
  parseAbi,
  parseUnits,
  getAddress,
  zeroAddress,
} from 'viem';
import { agenticPresets } from '../presets';
import { AGENTIC } from '../constants';
import { evmPinOffset, normalizePublicRule, publicRules } from '../public-rule';
import { parseSelector } from '../codec/selectors';
import type { Rule, UniversalRule } from '../agentic.types';
import { FakeChain, ADDR } from './fake-chain';
import { mockRuntime } from './mock-runtime';

const TESTNETS = ['eip155:11155111', 'eip155:84532', 'eip155:421614'] as const;
const DEX = {
  'eip155:11155111': {
    router: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
    weth: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  },
  'eip155:84532': {
    router: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
    weth: '0x4200000000000000000000000000000000000006',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  },
  'eip155:421614': {
    router: '0x101F443B4d1b059569D643917553c771E1b9663E',
    weth: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  },
} as const;
const AAVE = {
  'eip155:11155111': {
    pool: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951',
    weth: '0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c',
  },
  'eip155:84532': {
    pool: '0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27',
    weth: '0x4200000000000000000000000000000000000006',
  },
  'eip155:421614': {
    pool: '0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff',
    weth: '0x1dF462e2712496373A347f8ad10802a5E95f053D',
  },
} as const;
const cap = parseUnits('0.002', 18);
const input = (chainNamespace: (typeof TESTNETS)[number]) => ({
  chainNamespace,
  agent: ADDR.agent,
  validUntil: 2_000_000_000,
  assets: [{ token: zeroAddress, maxPerCall: cap, maxTotal: cap * BigInt(5) }],
});
const pinTotal = (r: { allowedCalls: { pins?: unknown[] }[] }) =>
  r.allowedCalls.reduce((n, c) => n + (c.pins?.length ?? 0), 0);

it('ships only the testnet presets that ran live: Uniswap V3 and Aave V3 on three chains', () => {
  expect(Object.values(AGENTIC.PRESETS.CATEGORY)).toEqual([
    'DEXES',
    'LENDING',
    'STAKING',
  ]);
  expect(
    agenticPresets.list().presets.map((p) => [p.constant, p.chains])
  ).toEqual([
    ['DEXES', [...TESTNETS]],
    ['LENDING', [...TESTNETS]],
    ['STAKING', []],
  ]);
  expect(agenticPresets.get('STAKING')).toEqual({ rules: [] });
  for (const category of ['DEXES', 'LENDING'] as const)
    for (const rule of agenticPresets.get(category).rules) {
      expect(rule.assets).toEqual([
        {
          token: zeroAddress,
          maxPerCall: parseUnits('0.001', 18),
          maxTotal: parseUnits('0.01', 18),
        },
      ]);
      expect(rule.maxGasPerCall).toBe(parseUnits('20', 18));
      expect(rule).not.toHaveProperty('readiness');
    }
});
it.each(TESTNETS)(
  'DEXES %s wraps ETH and swaps WETH and Circle USDC with wallet-pinned recipients',
  (chainNamespace) => {
    const { router, weth, usdc } = DEX[chainNamespace];
    const r = agenticPresets.get('DEXES', input(chainNamespace)).rules[0];
    const W = getAddress(weth),
      U = getAddress(usdc),
      R = getAddress(router);
    expect(
      r.allowedCalls.map((c) => [getAddress(c.target), c.selector])
    ).toEqual([
      [W, 'deposit()'],
      [W, 'approve(address,uint256)'],
      [R, expect.stringMatching(/^exactInputSingle\(/)],
      [R, expect.stringMatching(/^exactOutputSingle\(/)],
      [U, 'approve(address,uint256)'],
      [R, expect.stringMatching(/^exactInputSingle\(/)],
      [R, expect.stringMatching(/^exactOutputSingle\(/)],
      [W, 'withdraw(uint256)'],
    ]);
    const [wrap, approveWeth, sellIn, sellOut, approveUsdc, buyIn, buyOut] =
      r.allowedCalls;
    expect(wrap.maxValue).toBe(cap);
    expect(approveWeth.pins).toEqual([
      { arg: 0, expected: R },
      { arg: 1, max: cap },
    ]);
    expect(sellIn.pins).toEqual([
      { arg: [0, 0], expected: W },
      { arg: [0, 1], expected: U },
      { arg: [0, 3], expected: AGENTIC.WALLET },
      { arg: [0, 4], max: cap },
    ]);
    expect(sellOut.pins?.at(-1)).toEqual({ arg: [0, 5], max: cap });
    const usdcCap = parseUnits('10', 6);
    expect(approveUsdc.pins).toEqual([
      { arg: 0, expected: R },
      { arg: 1, max: usdcCap },
    ]);
    expect(buyIn.pins).toEqual([
      { arg: [0, 0], expected: U },
      { arg: [0, 1], expected: W },
      { arg: [0, 3], expected: AGENTIC.WALLET },
      { arg: [0, 4], max: usdcCap },
    ]);
    expect(buyOut.pins?.at(-1)).toEqual({ arg: [0, 5], max: usdcCap });
    expect(r.allowedCalls.at(-1)?.pins).toEqual([{ arg: 0, max: cap }]);
    expect(pinTotal(r)).toBeLessThanOrEqual(32);
  }
);
it.each(TESTNETS)(
  'LENDING %s wraps ETH into the Aave WETH reserve and pins every position to the wallet',
  (chainNamespace) => {
    const { pool, weth } = AAVE[chainNamespace];
    const r = agenticPresets.get('LENDING', input(chainNamespace)).rules[0];
    const W = getAddress(weth),
      P = getAddress(pool);
    expect(
      r.allowedCalls.map((c) => [getAddress(c.target), c.selector, c.pins])
    ).toEqual([
      [W, 'deposit()', undefined],
      [
        W,
        'approve(address,uint256)',
        [
          { arg: 0, expected: P },
          { arg: 1, max: cap },
        ],
      ],
      ...(
        [
          ['supply(address,uint256,address,uint16)', 2],
          ['withdraw(address,uint256,address)', 2],
          ['borrow(address,uint256,uint256,uint16,address)', 4],
          ['repay(address,uint256,uint256,address)', 3],
        ] as const
      ).map(([selector, beneficiary]) => [
        P,
        selector,
        [
          { arg: 0, expected: W },
          { arg: beneficiary, expected: AGENTIC.WALLET },
          { arg: 1, max: cap },
        ],
      ]),
      [W, 'withdraw(uint256)', [{ arg: 0, max: cap }]],
    ]);
    expect(r.allowedCalls[0].maxValue).toBe(cap);
  }
);
it.each(
  TESTNETS.flatMap((chain) =>
    (['DEXES', 'LENDING'] as const).map((p) => [p, chain] as const)
  )
)(
  '%s %s compiles with the deployed v6 policy within its limits',
  async (preset, chainNamespace) => {
    const r = agenticPresets.get(preset, input(chainNamespace)).rules[0];
    const out = (await normalizePublicRule(
      publicRules([r])[0],
      ADDR.owner,
      mockRuntime(new FakeChain())
    )) as UniversalRule;
    expect(out.allowedCalls).toHaveLength(r.allowedCalls.length);
    expect(out.allowedCalls[0].maxValue).toBe(cap);
    expect(out.allowedCalls.slice(1).every((c) => !c.maxValue)).toBe(true);
  }
);
it.each(TESTNETS)(
  'normalizes every DEX swap on %s to the exact ABI bytes',
  async (chainNamespace) => {
    const r = agenticPresets.get('DEXES', input(chainNamespace)).rules[0];
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
  const r = agenticPresets.get('DEXES', input('eip155:11155111')).rules[0];
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
it('mutating a returned rule cannot change a later preset', () => {
  const r = agenticPresets.get('DEXES', input('eip155:84532')).rules[0];
  (r.allowedCalls[2].pins![0].arg as number[])[1] = 99;
  r.allowedCalls[0].maxValue = BigInt(0);
  r.assets![0].maxPerCall = BigInt(0);
  const again = agenticPresets.get('DEXES', {
    chainNamespace: 'eip155:84532',
  }).rules[0];
  expect(again.allowedCalls[2].pins![0].arg).toEqual([0, 0]);
  expect(again.allowedCalls[0].maxValue).toBe(parseUnits('0.001', 18));
  expect(again.assets![0].maxPerCall).toBe(parseUnits('0.001', 18));
});
