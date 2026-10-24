import { getAddress, parseUnits, zeroAddress } from 'viem';
import { CHAIN } from '../../constants/enums';
import {
  MOVEABLE_TOKEN_CONSTANTS,
  MOVEABLE_TOKENS,
} from '../../constants/tokens';
import { Utils } from '../../utils';
import { allRoutableAssets, prepareRuleInput } from '../management/rule-inputs';
import { normalizePublicRule, publicRules } from '../public-rule';
import type { AuthoredRule, RuleInput, UniversalRule } from '../agentic.types';
import type { Snapshot } from '../reads/snapshot';
import { ADDR, FakeChain } from './fake-chain';
import { mockRuntime } from './mock-runtime';

const SEPOLIA = MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA;
const CIRCLE_SEPOLIA = getAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');
const snap = {} as Snapshot;
const base = (over: Partial<AuthoredRule> = {}): AuthoredRule => ({
  agent: ADDR.agent,
  chainNamespace: 'eip155:11155111',
  validUntil: 2_000_000_000,
  maxGasPerCall: BigInt(1),
  ...over,
});
const prepare = (
  rule: RuleInput,
  rt = mockRuntime(new FakeChain(), { signer: ADDR.owner })
) =>
  prepareRuleInput(
    publicRules([rule])[0],
    rt,
    ADDR.owner,
    snap
  ) as unknown as Promise<AuthoredRule>;
const addressOf = (token: unknown) =>
  typeof token === 'string' ? token : (token as { address: string }).address;

describe('MOVEABLE ALL', () => {
  it('lists every token Push can send to Sepolia, .old Circle USDC separately', () => {
    const assets = allRoutableAssets('eip155:11155111');
    expect(assets.map((a) => addressOf(a.token))).toEqual([
      zeroAddress,
      SEPOLIA.USDT.address,
      SEPOLIA.USDC.address,
      SEPOLIA.WETH.address,
      SEPOLIA.stETH.address,
      CIRCLE_SEPOLIA,
    ]);
    expect(assets[0]).toMatchObject({
      maxPerCall: parseUnits('0.001', 18),
      maxTotal: parseUnits('0.01', 18),
    });
    expect(assets[5]).toEqual({
      token: CIRCLE_SEPOLIA,
      maxPerCall: parseUnits('10', 6),
      maxTotal: parseUnits('100', 6),
    });
  });
  it.each(
    Object.keys(MOVEABLE_TOKENS).filter(
      (c) => c !== CHAIN.PUSH_TESTNET_DONUT && c !== CHAIN.ETHEREUM_MAINNET
    )
  )('expands %s within eight routable tokens, each with a default', (chain) => {
    const assets = allRoutableAssets(chain);
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.length).toBeLessThanOrEqual(8);
    expect(
      assets.every((a) => a.maxPerCall > BigInt(0) && a.maxTotal! > BigInt(0))
    ).toBe(true);
  });
  it('leaves out registry tokens without a Push route', () => {
    const base = allRoutableAssets('eip155:84532').map((a) =>
      addressOf(a.token).toLowerCase()
    );
    // Base Sepolia WETH is in the registry but has no PRC20.
    expect(base).not.toContain('0x4200000000000000000000000000000000000006');
    expect(base).toHaveLength(4);
  });
  it('is the public helper and the marker comes from the token constants', () => {
    expect(Utils.agentic.assets.all('eip155:421614')).toEqual(
      allRoutableAssets('eip155:421614')
    );
    expect(SEPOLIA.ALL).toEqual({ kind: 'ALL', chain: CHAIN.ETHEREUM_SEPOLIA });
    expect(Object.isFrozen(SEPOLIA.ALL)).toBe(true);
  });
  it('expands in a rule, and a listed token replaces its default', async () => {
    const usdc = {
      token: SEPOLIA.USDC,
      maxPerCall: BigInt(3),
      maxTotal: BigInt(9),
    };
    const out = await prepare(
      base({
        assets: [{ token: SEPOLIA.ALL }, usdc],
        allowedCalls: [{ target: ADDR.target, selector: 'increment()' }],
      })
    );
    expect(out.assets).toHaveLength(6);
    expect(out.assets![2]).toBe(usdc);
    expect(out.allowedCalls).toHaveLength(1);
  });
  it.each([
    [
      { assets: [{ token: SEPOLIA.ALL, maxPerCall: BigInt(1) }] },
      { code: 'INVALID_RULE', details: { reason: 'ALL_WITH_LIMITS' } },
    ],
    [
      {
        chainNamespace: 'eip155:84532' as const,
        assets: [{ token: SEPOLIA.ALL }],
      },
      { code: 'ASSET_CHAIN_MISMATCH' },
    ],
  ])(
    'refuses ALL with limits or for another chain (case %#)',
    async (over, error) => {
      await expect(
        prepare(base({ allowedCalls: [], ...over } as never))
      ).rejects.toMatchObject(error);
    }
  );
  it('refuses an unexpanded marker if normalization is reached directly', async () => {
    await expect(
      normalizePublicRule(
        publicRules([
          base({
            assets: [{ token: SEPOLIA.ALL }],
            allowedCalls: [{ target: ADDR.target, selector: 'increment()' }],
          }),
        ])[0],
        ADDR.other,
        mockRuntime(new FakeChain())
      )
    ).rejects.toThrow(/expand MOVEABLE ALL/);
  });
});

describe('tokens-only rules', () => {
  const usdc = {
    token: SEPOLIA.USDC,
    maxPerCall: BigInt(5),
    maxTotal: BigInt(9),
  };
  it('allows each ERC20 only back to the owner, capped per transfer', async () => {
    for (const allowedCalls of [undefined, []]) {
      const out = await prepare(base({ assets: [usdc], allowedCalls }));
      expect(out.allowedCalls).toEqual([
        {
          target: getAddress(SEPOLIA.USDC.address),
          selector: 'transfer(address,uint256)',
          pins: [
            { arg: 0, expected: ADDR.owner },
            { arg: 1, max: BigInt(5) },
          ],
          app: 'Token transfer',
          label: 'Transfer to owner',
        },
      ]);
      expect(out).not.toHaveProperty('transferTo');
    }
  });
  it('adds named recipients as opt-in alternatives and compiles for the v6 policy', async () => {
    const out = await prepare(
      base({
        assets: [usdc, { token: CIRCLE_SEPOLIA, maxPerCall: BigInt(2) }],
        transferTo: [ADDR.other, ADDR.owner.toLowerCase() as never],
      })
    );
    expect(
      out.allowedCalls!.map((c) => [c.target, c.pins![0].expected, c.label])
    ).toEqual([
      [getAddress(SEPOLIA.USDC.address), ADDR.owner, 'Transfer to owner'],
      [
        getAddress(SEPOLIA.USDC.address),
        ADDR.other,
        'Transfer to named recipient',
      ],
      [CIRCLE_SEPOLIA, ADDR.owner, 'Transfer to owner'],
      [CIRCLE_SEPOLIA, ADDR.other, 'Transfer to named recipient'],
    ]);
    const wire = (await normalizePublicRule(
      out as never,
      ADDR.other,
      mockRuntime(new FakeChain())
    )) as UniversalRule;
    expect(wire.allowedCalls.map((c) => c.pins?.map((p) => p.op))).toEqual([
      [0, 1],
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
  });
  it('with ALL and no apps, every routable ERC20 can go back to the owner', async () => {
    const out = await prepare(base({ assets: [{ token: SEPOLIA.ALL }] }));
    // Native ETH cannot be moved by a transfer rule, so ALL leaves it out here.
    expect(out.assets!.map((a) => addressOf(a.token))).toEqual([
      SEPOLIA.USDT.address,
      SEPOLIA.USDC.address,
      SEPOLIA.WETH.address,
      SEPOLIA.stETH.address,
      CIRCLE_SEPOLIA,
    ]);
    expect(out.allowedCalls!.map((c) => getAddress(c.target))).toEqual(
      out.assets!.map((a) => getAddress(addressOf(a.token)))
    );
    expect(
      out.allowedCalls!.every((c) => c.pins![0].expected === ADDR.owner)
    ).toBe(true);
  });
  it('uses the UEA origin as the owner address, and needs a recipient for a Solana owner', async () => {
    const origin = getAddress('0x00000000000000000000000000000000000000cc');
    const evm = mockRuntime(new FakeChain(), {
      signer: ADDR.owner,
      signerIsPushNative: () => false,
      signerOrigin: () => ({ chain: CHAIN.ETHEREUM_SEPOLIA, address: origin }),
    });
    expect(
      (await prepare(base({ assets: [usdc] }), evm)).allowedCalls![0].pins![0]
    ).toEqual({ arg: 0, expected: origin });
    const sol = mockRuntime(new FakeChain(), {
      signer: ADDR.owner,
      signerIsPushNative: () => false,
      signerOrigin: () => ({
        chain: CHAIN.SOLANA_DEVNET,
        address: '11111111111111111111111111111111',
      }),
    });
    await expect(prepare(base({ assets: [usdc] }), sol)).rejects.toMatchObject({
      details: { reason: 'TRANSFER_RECIPIENT_REQUIRED' },
    });
    const named = await prepare(
      base({ assets: [usdc], transferTo: [ADDR.other] }),
      sol
    );
    expect(named.allowedCalls!.map((c) => c.label)).toEqual([
      'Transfer to named recipient',
    ]);
  });
  it.each([
    [
      base({ assets: [{ token: zeroAddress, maxPerCall: BigInt(1) }] }),
      'TOKENS_ONLY_NATIVE',
    ],
    [
      base({
        assets: [usdc],
        transferTo: [ADDR.other],
        allowedCalls: [{ target: ADDR.target, selector: 'increment()' }],
      }),
      'TRANSFER_TO_WITH_CALLS',
    ],
    [
      base({ assets: [usdc], transferTo: [zeroAddress] }),
      'TRANSFER_RECIPIENT_INVALID',
    ],
    [
      base({
        chainNamespace: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
        assets: [
          {
            token: 'So11111111111111111111111111111111111111112',
            maxPerCall: BigInt(1),
          },
        ],
      }),
      'TOKENS_ONLY_UNSUPPORTED',
    ],
  ])(
    'refuses what a transfer rule cannot express (case %#)',
    async (rule, reason) => {
      await expect(prepare(rule)).rejects.toMatchObject({
        code: 'INVALID_RULE',
        details: { reason },
      });
    }
  );
  it('only the connected owner can author one', async () => {
    await expect(
      prepare(
        base({ assets: [usdc] }),
        mockRuntime(new FakeChain(), { signer: ADDR.agent })
      )
    ).rejects.toMatchObject({ code: 'NOT_WALLET_OWNER' });
  });
  it('leaves rules with allowed functions and decoded rules unchanged', async () => {
    const rule = publicRules([
      base({
        assets: [usdc],
        allowedCalls: [{ target: ADDR.target, selector: 'increment()' }],
      }),
    ])[0];
    expect(
      await prepareRuleInput(
        rule,
        mockRuntime(new FakeChain(), { signer: ADDR.owner }),
        ADDR.owner,
        snap
      )
    ).toBe(rule);
  });
});
