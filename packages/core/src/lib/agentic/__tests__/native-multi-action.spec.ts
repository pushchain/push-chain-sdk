/**
 * Multi-action native rules: one rule ID allowing 1..8 Push functions, each
 * with its own limits (AGW _grantRules: MAX_NATIVE_ACTIONS, DuplicateAction,
 * InconsistentChain). PENDING product sign-off — plan/agw/pending-items.md.
 */
import { getAddress, type Hex } from 'viem';
import { PUSH_NETWORK } from '../../constants/enums';
import { actionId } from '../codec/ids';
import {
  MAX_NATIVE_ACTIONS,
  nativeActionTermsToRule,
  nativeRuleToActionTerms,
  nativeRuleToTerms,
} from '../codec/native';
import { prepareRules } from '../codec/rules';
import { decodeEnvelope, decodeSession } from '../codec/session';
import {
  currentGeneration,
  resetAgenticGenerations,
  V6_CAPABILITIES,
} from '../deployments';
import { AGENTIC_ERROR_CODE } from '../errors';
import { decodeActiveRule, readActiveRules } from '../reads/rules';
import { Snapshot } from '../reads/snapshot';
import { agenticUtils, internalAgenticUtils } from '../utils';
import type { NativeMultiRule, NativeRule } from '../agentic.types';
import {
  ADDR,
  FakeChain,
  PUSH_NS,
  registerFakeGeneration,
  ruleId,
} from './fake-chain';

const NOW = 1_700_000_000;
const other = getAddress('0x0000000000000000000000000000000000007b7b');

const multi = (over: Partial<NativeMultiRule> = {}): NativeMultiRule => ({
  agent: ADDR.agent,
  validUntil: NOW + 100,
  actions: [
    { target: ADDR.target, selector: 'increment()', maxCalls: 5 },
    {
      target: other,
      selector: 'deposit(address,uint256)',
      pins: [{ arg: 0, expected: ADDR.other }],
      amount: { arg: 1, maxPerCall: BigInt(10) },
      maxValuePerCall: BigInt(3),
      maxValueTotal: BigInt(9),
    },
  ],
  ...over,
});

const ctx = {
  owner: ADDR.owner,
  pushChainNamespace: PUSH_NS,
  validator: ADDR.validator,
  rulesPolicy: ADDR.policy,
  gateway: ADDR.gateway,
  capabilities: V6_CAPABILITIES,
  nowSeconds: NOW,
  forbiddenTargets: [
    ADDR.factory,
    ADDR.engine,
    ADDR.policy,
    ADDR.validator,
    ADDR.gateway,
  ],
};

describe('native rule codec — multiple actions', () => {
  it('encodes each action with its own limits, in input order, sharing the rule expiry', () => {
    const out = nativeRuleToActionTerms(multi(), { nowSeconds: NOW });
    expect(out.map((o) => o.terms.target)).toEqual([ADDR.target, other]);
    expect(out[0].terms).toMatchObject({
      maxCalls: 5,
      validUntil: NOW + 100,
      maxValuePerCall: BigInt(0),
    });
    expect(out[1].terms).toMatchObject({
      maxValuePerCall: BigInt(3),
      maxValueTotal: BigInt(9),
      validUntil: NOW + 100,
    });
    expect(out[1].terms.pins).toHaveLength(1);
    expect(out[1].terms.amount).toMatchObject({
      enabled: true,
      offset: 36,
      maxPerCall: BigInt(10),
    });
  });

  it('the single-action shorthand is unchanged and equals a one-entry actions list', () => {
    const single: NativeRule = {
      agent: ADDR.agent,
      target: ADDR.target,
      selector: 'increment()',
      validUntil: NOW + 100,
      maxCalls: 2,
    };
    const asList: NativeRule = {
      agent: ADDR.agent,
      validUntil: NOW + 100,
      actions: [{ target: ADDR.target, selector: 'increment()', maxCalls: 2 }],
    };
    expect(
      nativeRuleToActionTerms(asList, { nowSeconds: NOW })[0].terms
    ).toEqual(nativeRuleToTerms(single, { nowSeconds: NOW }).terms);
  });

  it('round-trips: stored terms decode to the actions form and re-encode identically', () => {
    const terms = nativeRuleToActionTerms(multi(), { nowSeconds: NOW }).map(
      (o) => o.terms
    );
    const decoded = nativeActionTermsToRule(terms, ADDR.agent);
    expect(decoded.actions).toHaveLength(2);
    expect(decoded.validUntil).toBe(NOW + 100);
    expect(decoded.actions?.[0]).not.toHaveProperty('validUntil');
    expect(
      nativeRuleToActionTerms(decoded, { nowSeconds: NOW }).map((o) => o.terms)
    ).toEqual(terms);
  });

  it('a single stored action decodes to the shorthand form', () => {
    const terms = nativeRuleToActionTerms(
      multi({ actions: [multi().actions[0]] }),
      { nowSeconds: NOW }
    ).map((o) => o.terms);
    const decoded = nativeActionTermsToRule(terms, ADDR.agent);
    expect(decoded.actions).toBeUndefined();
    expect(decoded).toMatchObject({ target: ADDR.target, maxCalls: 5 });
  });

  it('per-action expiries are kept: the rule shows the earliest, later actions carry their own', () => {
    const rule = multi({
      actions: [
        { ...multi().actions[0], validUntil: NOW + 500 },
        multi().actions[1],
      ],
    });
    const terms = nativeRuleToActionTerms(rule, { nowSeconds: NOW }).map(
      (o) => o.terms
    );
    expect(terms.map((t) => t.validUntil)).toEqual([NOW + 500, NOW + 100]);
    const decoded = nativeActionTermsToRule(terms, ADDR.agent);
    expect(decoded.validUntil).toBe(NOW + 100);
    expect(decoded.actions?.[0].validUntil).toBe(NOW + 500);
    expect(
      nativeRuleToActionTerms(decoded, { nowSeconds: NOW }).map((o) => o.terms)
    ).toEqual(terms);
  });

  it.each([
    [
      'a null action',
      { actions: [null] } as never,
      /actions\[0\] must be an action object/,
    ],
    [
      'a non-object action',
      { actions: [42] } as never,
      /actions\[0\] must be an action object/,
    ],
    [
      'missing rule expiry despite overrides',
      {
        validUntil: undefined,
        actions: [{ ...multi().actions[0], validUntil: NOW + 100 }],
      } as never,
      /rule validUntil/,
    ],
    [
      'expired rule expiry despite overrides',
      {
        validUntil: NOW - 1,
        actions: [{ ...multi().actions[0], validUntil: NOW + 100 }],
      },
      /rule validUntil/,
    ],
    ['an empty actions list', { actions: [] }, /1\.\.8/],
    [
      'more than the contract limit',
      {
        actions: Array.from({ length: MAX_NATIVE_ACTIONS + 1 }, (_, i) => ({
          target: getAddress(`0x${(i + 16).toString(16).padStart(40, '0')}`),
          selector: 'increment()' as const,
        })),
      },
      /1\.\.8/,
    ],
    [
      'a repeated target and selector',
      {
        actions: [
          { target: ADDR.target, selector: 'increment()' as const },
          { target: ADDR.target, selector: '0xd09de08a' as const },
        ],
      },
      /repeats the target and selector of actions\[0\]/,
    ],
    [
      'top-level action fields mixed with actions',
      { target: ADDR.target } as never,
      /cannot be combined with top-level target/,
    ],
    [
      'an invalid action, reported with its index',
      {
        actions: [
          multi().actions[0],
          {
            target: other,
            selector: 'f(bytes)' as const,
            pins: [{ arg: 0, expected: '0x01' as Hex }],
          },
        ],
      },
      /^actions\[1\]: /,
    ],
  ])('rejects %s before signing', (_name, patch, message) => {
    expect(() =>
      nativeRuleToActionTerms(multi(patch as Partial<NativeMultiRule>), {
        nowSeconds: NOW,
      })
    ).toThrow(
      expect.objectContaining({
        code: AGENTIC_ERROR_CODE.INVALID_RULE,
        message: expect.stringMatching(message),
      })
    );
  });

  it('the same function on different targets is allowed (distinct action IDs)', () => {
    expect(() =>
      nativeRuleToActionTerms(
        multi({
          actions: [
            { target: ADDR.target, selector: 'increment()' },
            { target: other, selector: 'increment()' },
          ],
        }),
        { nowSeconds: NOW }
      )
    ).not.toThrow();
  });
});

describe('prepareRules — one session, one rule ID, several actions', () => {
  it('builds one session action per native action, each with its own URP envelope on the Push chain', () => {
    const [p] = prepareRules([multi()], ctx);
    expect(p.session.actions.map((a) => a.actionTarget)).toEqual([
      ADDR.target,
      other,
    ]);
    expect(
      p.session.actions.every(
        (a) =>
          a.actionPolicies.length === 1 &&
          a.actionPolicies[0].policy === ADDR.policy
      )
    ).toBe(true);
    expect(
      p.session.actions.map(
        (a) => decodeEnvelope(a.actionPolicies[0].initData).chainNamespace
      )
    ).toEqual([PUSH_NS, PUSH_NS]);
    expect(p.nativeTerms).toHaveLength(2);
  });

  it('refuses an infrastructure target in any action, naming it', () => {
    expect(() =>
      prepareRules(
        [
          multi({
            actions: [
              multi().actions[0],
              { target: ADDR.gateway, selector: 'increment()' },
            ],
          }),
        ],
        ctx
      )
    ).toThrow(/rules\[0\]\.actions\[1\]\.target/);
  });

  it('one multi-action rule is one rule per agent on Push, so it never collides with itself', () => {
    expect(prepareRules([multi()], ctx)).toHaveLength(1);
  });
});

describe('utils.agentic.decodeRules — several actions', () => {
  it('decodes a multi-action session into the actions form', () => {
    const [bytes] = internalAgenticUtils.encodeRules([multi()], {
      pushChainNamespace: PUSH_NS,
      validator: ADDR.validator,
      rulesPolicy: ADDR.policy,
      nowSeconds: NOW,
    });
    expect(decodeSession(bytes).actions).toHaveLength(2);
    const back = agenticUtils.decodeRules(bytes, {
      pushChainNamespace: PUSH_NS,
    }) as NativeMultiRule;
    expect(back.actions.map((a) => a.target)).toEqual([ADDR.target, other]);
    expect(back.actions[1]).toMatchObject({
      maxValuePerCall: BigInt(3),
      amount: { offset: 36, maxPerCall: BigInt(10) },
    });
  });
});

describe('rules.get / rules.list — reading several stored actions', () => {
  afterEach(() => resetAgenticGenerations());

  it('decodes every action in engine order at one block', async () => {
    registerFakeGeneration();
    const fake = new FakeChain();
    const a0 = actionId(ADDR.target, '0xd09de08a');
    const a1 = actionId(other, '0x47e7ef24');
    const w = fake.addWallet(ADDR.owner, 'w', [
      {
        ...fake.nativeRule(ADDR.agent, ruleId(1)),
        actionIds: [a0, a1],
        nativeByAction: {
          [a0.toLowerCase()]: {
            target: ADDR.target,
            selector: '0xd09de08a',
            maxCalls: 0xffffffff,
            callsUsed: 5,
          },
          [a1.toLowerCase()]: {
            target: other,
            selector: '0x47e7ef24',
            maxValuePerCall: BigInt(3),
          },
        },
      },
    ]);
    const gen = currentGeneration(PUSH_NETWORK.TESTNET_DONUT);
    const snap = await Snapshot.at(fake);
    const [active] = await readActiveRules(snap, gen, w.address);
    const record = await decodeActiveRule(
      snap,
      gen,
      w.address,
      active,
      PUSH_NS
    );
    const rule = record.rule as import('../agentic.types').Rule;
    expect(rule.allowedCalls.map((a) => [a.target, a.selector])).toEqual([
      [ADDR.target, '0xd09de08a'],
      [other, '0x47e7ef24'],
    ]);
    expect(record.spent).toMatchObject({
      kind: 'native',
      actions: [
        expect.objectContaining({ callsUsed: 5 }),
        expect.objectContaining({ callsUsed: 0 }),
      ],
    });
    expect(rule.allowedCalls[1].maxValue).toBe(BigInt(3));
    expect(new Set(fake.calls.map((c) => c.blockNumber))).toEqual(
      new Set([fake.block])
    );
  });
});
