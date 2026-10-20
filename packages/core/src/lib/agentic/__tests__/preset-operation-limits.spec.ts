import { getAddress, zeroAddress } from 'viem';
import { agenticPresets } from '../presets';
import { AGENTIC } from '../constants';
import { ADDR } from './fake-chain';
const LINK = getAddress('0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5');
const WBTC = getAddress('0x29f2D40B0605204364af54EC677bD022dA425d03');
const chainNamespace = 'eip155:11155111' as const;
const options = {
  chainNamespace,
  agent: ADDR.agent,
  validUntil: 2_000_000_000,
  maxGasPerCall: BigInt(1),
};
const asset = (token = LINK, limit = BigInt(5)) => ({
  token,
  maxPerCall: limit,
  maxTotal: BigInt(10),
});

it('Aave pins the selected reserve, operation amount and wallet beneficiary for every method', () => {
  const { rules, readiness } = agenticPresets.get('LENDING', {
    ...options,
    assets: [asset(), asset(WBTC, BigInt(7))],
  });
  expect(readiness.chains[0].configurationReady).toBe(true);
  expect(rules).toHaveLength(1);
  for (const [selector, walletArg] of [
    ['supply(address,uint256,address,uint16)', 2],
    ['withdraw(address,uint256,address)', 2],
    ['borrow(address,uint256,uint256,uint16,address)', 4],
    ['repay(address,uint256,uint256,address)', 3],
  ] as const) {
    const calls = rules[0].allowedCalls.filter((c) => c.selector === selector);
    expect(calls).toHaveLength(2);
    for (const [i, token] of [LINK, WBTC].entries()) {
      expect(calls[i].pins).toEqual(
        expect.arrayContaining([
          { arg: 0, expected: token },
          { arg: 1, max: i ? BigInt(7) : BigInt(5) },
          { arg: walletArg, expected: AGENTIC.WALLET },
        ])
      );
      expect(calls[i]).not.toHaveProperty('budget');
    }
  }
});
it('default lending policy needs only the agent to become locally ready', () => {
  const result = agenticPresets.get('LENDING', { chainNamespace });
  expect(result.readiness.ready).toBe(false);
  expect(result.readiness.chains[0].issues.map((i) => i.code)).toEqual(
    expect.arrayContaining(['AGENT_REQUIRED', 'BRIDGE_ASSET_UNAVAILABLE'])
  );
  expect(result.rules[0].assets).toEqual([
    {
      token: LINK,
      maxPerCall: BigInt(10) ** BigInt(18),
      maxTotal: BigInt(10) ** BigInt(19),
    },
  ]);
  expect(result.rules[0].validUntil).toBeGreaterThan(
    Math.floor(Date.now() / 1000)
  );
  expect(result.rules[0].maxGasPerCall).toBe(
    BigInt(20) * BigInt(10) ** BigInt(18)
  );
  expect(result.readiness.chains[0].knownTokens).toContain(LINK);
  expect(
    agenticPresets.get('LENDING', {
      chainNamespace,
      agent: ADDR.agent,
    }).readiness.chains[0].configurationReady
  ).toBe(true);
});
it('zero operation caps remain valid disabled configurations, while zero bridge totals are separately reported', () => {
  const disabled = agenticPresets.get('LENDING', {
    ...options,
    assets: [{ token: LINK }],
  });
  expect(disabled.readiness.ready).toBe(false);
  expect(
    disabled.readiness.chains[0].disabledCalls.every(
      (c) => c.reason === 'ZERO_CAP'
    )
  ).toBe(true);
  const enabled = agenticPresets.get('LENDING', {
    ...options,
    assets: [{ token: LINK, maxPerCall: BigInt(5) }],
  });
  expect(enabled.readiness.chains[0].configurationReady).toBe(true);
  expect(enabled.readiness.chains[0].zeroBridgeLimits).toEqual([LINK]);
  expect(enabled.rules[0].assets?.[0].maxTotal).toBe(BigInt(0));
});
it('does not approve or grant a positive amount for an unlisted Aave asset', () => {
  const { rules, readiness } = agenticPresets.get('LENDING', {
    ...options,
    assets: [asset(ADDR.other)],
  });
  expect(readiness.ready).toBe(false);
  expect(
    rules[0].allowedCalls.some((c) => c.selector.startsWith('approve'))
  ).toBe(false);
  expect(
    rules[0].allowedCalls.every((c) => c.pins?.some((p) => p.max === BigInt(0)))
  ).toBe(true);
});
it('regenerating a token/limit replaces old operation and approval constraints without mutating the old template', () => {
  const first = agenticPresets.get('LENDING', {
    ...options,
    assets: [asset()],
  });
  const next = agenticPresets.get('LENDING', {
    ...options,
    assets: [asset(WBTC, BigInt(2))],
  });
  expect(
    next.rules[0].allowedCalls.some(
      (c) => c.target === LINK || c.pins?.some((p) => p.expected === LINK)
    )
  ).toBe(false);
  expect(
    next.rules[0].allowedCalls.every((c) =>
      c.pins?.some((p) => p.max === BigInt(2))
    )
  ).toBe(true);
  expect(
    first.rules[0].allowedCalls.every((c) =>
      c.pins?.some((p) => p.max === BigInt(5))
    )
  ).toBe(true);
});
it('Moonwell applies underlying units and reports the share-based redeem alternative', () => {
  const token = getAddress('0x4616975f7E6045FD9737e95bC527e9e14c727BD2');
  const { rules, readiness } = agenticPresets.get('LENDING', {
    ...options,
    chainNamespace: 'eip155:84532',
    assets: [asset(token)],
  });
  const calls = rules[0].allowedCalls.filter(
    (c) => c.app === 'Moonwell mUSDbC' && !c.selector.startsWith('approve')
  );
  expect(calls.map((c) => c.selector)).toEqual([
    'mint(uint256)',
    'redeemUnderlying(uint256)',
    'borrow(uint256)',
    'repayBorrow(uint256)',
  ]);
  expect(
    calls.every((c) => c.pins?.some((p) => p.arg === 0 && p.max === BigInt(5)))
  ).toBe(true);
  expect(readiness.chains[0].excludedCalls).toContainEqual(
    expect.objectContaining({
      selector: 'redeem(uint256)',
      reason: 'SHARE_AMOUNT',
      alternative: 'redeemUnderlying(uint256)',
    })
  );
});
it('EigenLayer pins the chosen token and deposit amount', () => {
  const { rules } = agenticPresets.get('STAKING', {
    ...options,
    assets: [asset()],
  });
  const deposit = rules[0].allowedCalls.find((c) =>
    c.selector.startsWith('depositIntoStrategy')
  )!;
  expect(deposit.pins).toEqual([
    { arg: 1, expected: LINK },
    { arg: 2, max: BigInt(5) },
  ]);
});
it('Lido distinguishes stETH, wstETH and native value units', () => {
  const stETH = getAddress('0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'),
    wstETH = getAddress('0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0');
  const { rules } = agenticPresets.get('STAKING', {
    ...options,
    chainNamespace: 'eip155:1',
    assets: [
      asset(stETH, BigInt(2)),
      asset(wstETH, BigInt(3)),
      asset(zeroAddress, BigInt(4)),
    ],
  });
  expect(
    rules[0].allowedCalls.find((c) => c.selector === 'wrap(uint256)')?.pins
  ).toEqual([{ arg: 0, max: BigInt(2) }]);
  expect(
    rules[0].allowedCalls.find((c) => c.selector === 'unwrap(uint256)')?.pins
  ).toEqual([{ arg: 0, max: BigInt(3) }]);
  expect(
    rules[0].allowedCalls.find((c) => c.selector === 'submit(address)')
      ?.maxValue
  ).toBe(BigInt(4));
});
it('readiness is per chain and cannot be mutated to change later results', () => {
  const res = agenticPresets.get('LENDING', {
    agent: options.agent,
    validUntil: options.validUntil,
    maxGasPerCall: options.maxGasPerCall,
    assets: [{ ...asset(), chainNamespace }],
  });
  expect(res.readiness.ready).toBe(false);
  expect(
    res.readiness.chains.find((c) => c.chainNamespace === chainNamespace)
      ?.configurationReady
  ).toBe(true);
  const expected = agenticPresets.get('LENDING', { chainNamespace }).readiness;
  res.readiness.chains.forEach((c) => {
    c.knownTokens.length = 0;
    c.disabledCalls.length = 0;
  });
  expect(agenticPresets.get('LENDING', { chainNamespace }).readiness).toEqual(
    expected
  );
});
it('refuses an overlarge token expansion without dropping restrictions', () => {
  expect(() =>
    agenticPresets.get('LENDING', {
      ...options,
      assets: [
        asset(),
        asset(WBTC),
        asset(getAddress('0x88541670E55cC00bEEFD87eB59EDd1b7C511AC9a')),
      ],
    })
  ).toThrow(/maximum is 32/);
});
