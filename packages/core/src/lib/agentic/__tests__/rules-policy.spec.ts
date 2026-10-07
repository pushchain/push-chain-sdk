import { getAddress, type Address } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { MOVEABLE_TOKEN_CONSTANTS } from '../../constants/tokens';
import { getPRC20Address } from '../../universal/prc20-address';
import { encodeUniversalTerms } from '../codec/universal-terms';
import { buildSession, encodeEnvelope, encodeSession } from '../codec/session';
import { prepareRules } from '../codec/rules';
import { validateUniversalRuleShape } from '../codec/universal';
import { V5_CAPABILITIES } from '../deployments';
import { AGENTIC_ERROR_CODE } from '../errors';
import { internalAgenticUtils } from '../utils';
import type { NativeRule, UniversalRule } from '../agentic.types';
import { ADDR, PUSH_NS, SEPOLIA_NS } from './fake-chain';

const NOW = 1_700_000_000;
const ctx = {
  owner: ADDR.owner,
  pushChainNamespace: PUSH_NS,
  validator: ADDR.validator,
  rulesPolicy: ADDR.policy,
  capabilities: V5_CAPABILITIES,
  nowSeconds: NOW,
  forbiddenTargets: [
    ADDR.factory,
    ADDR.engine,
    ADDR.policy,
    ADDR.validator,
    ADDR.gateway,
  ],
};
const native = (over: Partial<NativeRule> = {}): NativeRule => ({
  agent: ADDR.agent,
  target: ADDR.target,
  selector: 'increment()',
  validUntil: NOW + 100,
  ...over,
});
const universal = (over: Partial<UniversalRule> = {}): UniversalRule => ({
  agent: ADDR.agent,
  chainNamespace: SEPOLIA_NS,
  assets: [
    {
      token: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      maxPerCall: BigInt(100),
    },
  ],
  maxGasPerCall: BigInt(10) ** BigInt(18),
  validUntil: NOW + 100,
  allowedCalls: [
    {
      target: ADDR.target,
      selector: 'supply(address,uint256,address,uint16)',
      beneficiary: 2,
    },
  ],
  ...over,
});

describe('prepareRules — spec 1.b checks before any signature', () => {
  it('AGENT_IS_OWNER', () => {
    expect(() => prepareRules([native({ agent: ADDR.owner })], ctx)).toThrow(
      expect.objectContaining({ code: AGENTIC_ERROR_CODE.AGENT_IS_OWNER })
    );
  });

  it('allows multiple rules for the same agent and chain', () => {
    const prepared = prepareRules(
      [native(), native({ target: ADDR.other })],
      ctx
    );
    expect(prepared).toHaveLength(2);
    expect(prepared.map((p) => p.agent)).toEqual([ADDR.agent, ADDR.agent]);
    expect(prepared.map((p) => p.nativeTerms?.target)).toEqual([
      ADDR.target,
      ADDR.other,
    ]);
  });

  it('native and universal rules coexist for the same agent', () => {
    const u = universal();
    const prepared = prepareRules([native(), u], {
      ...ctx,
      gateway: ADDR.gateway,
      universal: new Map([
        [
          u,
          {
            expectedCEA: ADDR.other,
            assets: [
              {
                token: ADDR.target,
                maxPerCall: BigInt(100),
                maxTotal: BigInt(1000),
              },
            ],
          },
        ],
      ]),
    });
    expect(prepared.map((p) => p.chainNamespace)).toEqual([
      PUSH_NS,
      SEPOLIA_NS,
    ]);
  });

  it('removed ref inputs fail explicitly instead of being silently dropped', () => {
    expect(() => prepareRules([{ ...native(), ref: `0x${'99'.repeat(32)}` } as never], ctx))
      .toThrow(expect.objectContaining({ code: AGENTIC_ERROR_CODE.INVALID_RULE }));
  });

  it('refuses infrastructure targets the contracts would reject', () => {
    for (const t of [
      ADDR.gateway,
      ADDR.policy,
      '0x0000000000000000000000000000000000000001' as Address,
    ]) {
      expect(() => prepareRules([native({ target: t })], ctx)).toThrow(
        /infrastructure/
      );
    }
  });

  it('a universal rule naming the Push chain is rejected', () => {
    expect(() =>
      prepareRules(
        [universal({ chainNamespace: PUSH_NS as `eip155:${string}` })],
        ctx
      )
    ).toThrow(/omit chainNamespace/);
  });

  it('valid native rules produce one Session each, agent bound in the validator config', () => {
    const [p] = prepareRules([native()], ctx);
    expect(p.chainNamespace).toBe(PUSH_NS);
    expect(p.session.sessionValidator).toBe(ADDR.validator);
    expect(p.session.actions).toHaveLength(1);
    expect(p.session.actions[0].actionPolicies[0].policy).toBe(ADDR.policy);
    expect(p.session.permitERC4337Paymaster).toBe(false);
  });
});

describe('universal rules — validated, then capability-gated (A01, A05)', () => {
  it('structural validation runs before the capability gate', () => {
    expect(() =>
      validateUniversalRuleShape(universal({ allowedCalls: [] }), NOW)
    ).toThrow(/1\.\.32/);
    expect(() =>
      validateUniversalRuleShape(universal({ maxGasPerCall: BigInt(0) }), NOW)
    ).toThrow(/maxGasPerCall/);
    expect(() =>
      validateUniversalRuleShape(
        universal({ chainNamespace: 'eip155:abc' as `eip155:${string}` }),
        NOW
      )
    ).toThrow(/CAIP-2/);
    expect(() =>
      validateUniversalRuleShape(
        universal({
          assets: Array.from({ length: 9 }, (_, i) => ({
            token: getAddress(`0x${(i + 1).toString(16).padStart(40, '0')}`),
            maxPerCall: BigInt(1),
          })),
        }),
        NOW
      )
    ).toThrow(/at most 8/);
    expect(() =>
      validateUniversalRuleShape(
        universal({
          assets: [
            { token: ADDR.target, maxPerCall: BigInt(1) },
            { token: ADDR.target, maxPerCall: BigInt(2) },
          ],
        }),
        NOW
      )
    ).toThrow(/duplicates/);
  });

  it('approval policy belongs to UI/marketplace; structurally valid approval calls are accepted', () => {
    for (const selector of [
      'approve(address,uint256)',
      'increaseAllowance(address,uint256)',
    ] as const) {
      expect(() =>
        validateUniversalRuleShape(
          universal({ allowedCalls: [{ target: ADDR.target, selector }] }),
          NOW
        )
      ).not.toThrow();
    }
  });

  it('a beneficiary must be an address argument of a known signature', () => {
    expect(() =>
      validateUniversalRuleShape(
        universal({
          allowedCalls: [
            {
              target: ADDR.target,
              selector: 'supply(address,uint256,address,uint16)',
              beneficiary: 1,
            },
          ],
        }),
        NOW
      )
    ).toThrow(/address argument/);
    expect(() =>
      validateUniversalRuleShape(
        universal({
          allowedCalls: [
            { target: ADDR.target, selector: '0x617ba037', beneficiary: 2 },
          ],
        }),
        NOW
      )
    ).toThrow(/signature/);
  });

  it('requires resolved wallet/token context and named SVM IDL inputs', () => {
    expect(() => prepareRules([universal()], ctx)).toThrow(
      expect.objectContaining({
        code: AGENTIC_ERROR_CODE.INVALID_RULE,
      })
    );
    expect(() =>
      prepareRules(
        [
          universal({
            chainNamespace: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as never,
          }),
        ],
        ctx
      )
    ).toThrow(
      expect.objectContaining({
        code: AGENTIC_ERROR_CODE.INVALID_RULE,
      })
    );
  });
});

describe('internal generation codecs (pure)', () => {
  const u = internalAgenticUtils;

  it('encodeRules → decodeRules round-trips a native rule', () => {
    const rule = native({
      selector: 'deposit(address,uint256)',
      pins: [{ arg: 0, expected: ADDR.other }],
      maxCalls: 4,
    });
    const [bytes] = u.encodeRules([rule], {
      pushChainNamespace: PUSH_NS,
      validator: ADDR.validator,
      rulesPolicy: ADDR.policy,
      nowSeconds: NOW,
    });
    const back = u.decodeRules(bytes, { pushChainNamespace: PUSH_NS });
    expect(back).toMatchObject({
      agent: ADDR.agent,
      target: ADDR.target,
      maxCalls: 4,
      validUntil: NOW + 100,
    });
    expect((back as NativeRule).pins).toEqual([
      {
        offset: 4,
        expected: `0x${'0'.repeat(24)}${ADDR.other.slice(2).toLowerCase()}`,
      },
    ]);
  });

  it('decodeRules rejects a foreign-chain envelope carrying native terms', () => {
    const [bytes] = u.encodeRules([native()], {
      pushChainNamespace: SEPOLIA_NS,
      validator: ADDR.validator,
      rulesPolicy: ADDR.policy,
      nowSeconds: NOW,
    });
    expect(() => u.decodeRules(bytes, { pushChainNamespace: PUSH_NS })).toThrow(
      expect.objectContaining({
        code: AGENTIC_ERROR_CODE.RULE_READ_FAILED,
      })
    );
  });

  it('pure decoding resolves known v5 assets and preserves the exact beneficiary offset', () => {
    const inputToken = MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.USDC;
    const prc20 = getPRC20Address(inputToken, {
      network: PUSH_NETWORK.TESTNET_DONUT,
    }).address;
    const bytes = encodeSession(
      buildSession({
        validator: ADDR.validator,
        agent: ADDR.agent,
        rulesPolicy: ADDR.policy,
        actions: [
          {
            target: ADDR.gateway,
            selector: '0x77b86bec',
            initData: encodeEnvelope(
              CHAIN.ETHEREUM_SEPOLIA,
              encodeUniversalTerms({
                validUntil: NOW + 100,
                expectedCEA: ADDR.other,
                assets: [
                  {
                    token: prc20,
                    maxPerCall: BigInt(10),
                    maxTotal: BigInt(100),
                  },
                ],
                maxGasPerCall: BigInt(20),
                allowedCalls: [
                  {
                    target: ADDR.target,
                    selector: '0x617ba037',
                    beneficiaryOffset: 68,
                    hasBeneficiary: true,
                    maxValue: BigInt(0),
                  },
                ],
              })
            ),
          },
        ],
      })
    );
    expect(u.decodeRules(bytes)).toMatchObject({
      chainNamespace: CHAIN.ETHEREUM_SEPOLIA,
      assets: [
        {
          token: getAddress(inputToken.address),
          maxPerCall: BigInt(10),
          maxTotal: BigInt(100),
        },
      ],
      allowedCalls: [{ beneficiaryOffset: 68 }],
    });
  });

  it('actionId accepts signatures and hex alike', () => {
    expect(u.actionId(ADDR.target, 'increment()')).toBe(
      u.actionId(ADDR.target, '0xd09de08a')
    );
  });
});
