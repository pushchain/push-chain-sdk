import { AgenticNamespaceImpl } from '../agentic';
import {
  AgenticError,
  AgenticRevertError,
  AGENTIC_ERROR_CODE,
} from '../errors';
import { agenticPresets } from '../presets';
import { normalizePublicRule, publicRules } from '../public-rule';
import { validateUniversalRuleShape } from '../codec/universal';
import type { UniversalRule } from '../agentic.types';
import { wrapSendError } from '../management/common';
import { ADDR, FakeChain, registerFakeGeneration } from './fake-chain';
import { mockRuntime } from './mock-runtime';
import { resetAgenticGenerations } from '../deployments';

const chainNamespace = 'eip155:11155111' as const;
const options = {
  chainNamespace,
  agent: ADDR.agent,
  validUntil: 2_000_000_000,
};
beforeEach(registerFakeGeneration);
afterEach(resetAgenticGenerations);

it('an edited preset with an unrouted token gives a typed token-route error before any transaction', async () => {
  const cause = new Error(
    'Unable to infer origin chain or token symbol for token'
  );
  const rt = mockRuntime(new FakeChain(), {
    signer: ADDR.owner,
    resolvePrc20: () => {
      throw cause;
    },
  });
  const sdk = new AgenticNamespaceImpl(rt);
  const { rules } = agenticPresets.get('LENDING', options);
  // Aave's faucet LINK has no Push route; presets themselves send only ETH.
  const edited = {
    ...rules[0],
    assets: [
      {
        token: '0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5',
        maxPerCall: BigInt(1),
        maxTotal: BigInt(2),
      },
    ],
  };
  let failure: unknown;
  try {
    await sdk.create('Test', { rules: [edited] });
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(AgenticError);
  expect(failure).toMatchObject({
    code: 'TOKEN_ROUTE_UNAVAILABLE',
    cause,
    details: {
      ruleIndex: 0,
      assetIndex: 0,
      chainNamespace,
      field: 'assets[0].token',
    },
    userMessage: expect.stringContaining(
      'Rule 1: This token cannot be sent from Push to Ethereum Sepolia'
    ),
    hint: expect.stringContaining('verified PRC20 route'),
  });
  expect(rt.executeMock).not.toHaveBeenCalled();
  expect(rt.atomicMock).not.toHaveBeenCalled();
});

it('reports the complete 42-condition count for duplicated DEX entries, without dropping them', async () => {
  const rt = mockRuntime(new FakeChain(), { signer: ADDR.owner });
  const sdk = new AgenticNamespaceImpl(rt);
  const { rules } = agenticPresets.get('DEXES', {
    ...options,
  });
  const calls = rules[0].allowedCalls;
  // The unpinned wrap cannot repeat (a bare alternative is refused first).
  const duplicated = {
    ...rules[0],
    allowedCalls: [...calls, ...calls.filter((c) => c.pins?.length)],
  };
  await expect(
    sdk.create('Test', { rules: [duplicated] })
  ).rejects.toMatchObject({
    code: 'INVALID_RULE',
    details: {
      reason: 'RULE_CONSTRAINT_LIMIT',
      actual: 42,
      limit: 32,
      callCount: 15,
      ruleIndex: 0,
      chainNamespace,
    },
    message: expect.stringContaining('42 conditions'),
    userMessage: expect.stringContaining('Rule 1:'),
  });
  expect(duplicated.allowedCalls).toHaveLength(15);
  expect(rt.executeMock).not.toHaveBeenCalled();
});

it('validates stock DEX rules independently: two 21-condition rules do not become a 42-condition rule', async () => {
  const rt = mockRuntime(new FakeChain());
  for (const chain of ['eip155:11155111', 'eip155:84532'] as const) {
    const { rules } = agenticPresets.get('DEXES', {
      ...options,
      chainNamespace: chain,
    });
    const normalized = (await normalizePublicRule(
      publicRules(rules)[0],
      ADDR.other,
      rt
    )) as UniversalRule;
    expect(
      normalized.allowedCalls.reduce((n, c) => n + (c.pins?.length ?? 0), 0)
    ).toBe(21);
    expect(() =>
      validateUniversalRuleShape(normalized, rt.nowSeconds())
    ).not.toThrow();
  }
});

it('does not misclassify a destination RPC failure as an unavailable token', async () => {
  const cause = new Error('RPC timeout: internal endpoint details');
  const rt = mockRuntime(new FakeChain(), {
    signer: ADDR.owner,
    resolveCEA: async () => {
      throw cause;
    },
  });
  const sdk = new AgenticNamespaceImpl(rt);
  await expect(
    sdk.create('Test', { rules: agenticPresets.get('LENDING', options).rules })
  ).rejects.toMatchObject({
    code: 'RULE_READ_FAILED',
    cause,
    userMessage:
      'Rule 1: The wallet’s destination account could not be loaded. Try again shortly.',
    details: { ruleIndex: 0, chainNamespace, stage: 'destinationAccount' },
  });
  expect(rt.executeMock).not.toHaveBeenCalled();
});

it.each(Object.values(AGENTIC_ERROR_CODE))(
  'provides safe UI copy for %s while retaining diagnostic text',
  (code) => {
    const error = new AgenticError(code, 'raw RPC details: 0x12345678');
    expect(error.userMessage.length).toBeGreaterThan(10);
    expect(error.userMessage).not.toContain('raw RPC');
    expect(error.message).toBe('raw RPC details: 0x12345678');
  }
);

it('keeps submitted hashes and uncertainty visible instead of inviting a blind retry', () => {
  const error = new AgenticError(
    'RECEIPT_UNAVAILABLE',
    'technical receipt diagnostic',
    { details: { txHash: '0x1234' } }
  );
  expect(error.userMessage).toContain('submitted');
  expect(error.userMessage).toContain('Check its status');
  expect(error.details).toEqual({ txHash: '0x1234' });
});

it('explains the create and native action ceilings using the available structured reason', () => {
  expect(
    new AgenticError(
      'INVALID_RULE',
      'create accepts at most eight initial rules'
    ).userMessage
  ).toContain('at most eight rules');
  expect(
    new AgenticError('CAPABILITY_UNAVAILABLE', 'diagnostic', {
      details: { capability: 'nativeActions' },
    }).userMessage
  ).toContain('at most eight functions');
});

it.each([9, 33])(
  'reports the eight-function Push-chain limit for %i functions, not the generic 1..32',
  async (count) => {
    const rt = mockRuntime(new FakeChain(), { signer: ADDR.owner });
    const sdk = new AgenticNamespaceImpl(rt);
    await expect(
      sdk.create('Too many', {
        rules: [
          {
            agent: ADDR.agent,
            validUntil: 2_000_000_000,
            allowedCalls: Array.from({ length: count }, (_, i) => ({
              target: `0x${(i + 16).toString(16).padStart(40, '0')}`,
              selector: 'increment()' as const,
            })),
          },
        ],
      })
    ).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
      details: { capability: 'nativeActions' },
      userMessage: expect.stringContaining('at most eight functions'),
    });
  }
);

it('preserves decoded contract failures and cancellation causes with UI messages', () => {
  const decodedError = {
    name: 'PolicyCheckReverted(ArgPinAboveMax)',
    selector: '0x12345678',
  };
  const cause = new Error('provider detail');
  const error = new AgenticRevertError('technical revert', {
    decodedError,
    cause,
  });
  expect(error.userMessage).toContain('exceeds');
  expect(error.decodedError).toEqual(decodedError);
  expect(error.cause).toBe(cause);
  const rejected = { code: 4001, message: 'User rejected request' };
  expect(wrapSendError(rejected)).toMatchObject({
    code: 'REQUEST_REJECTED',
    cause: rejected,
    userMessage: expect.stringContaining('cancelled'),
  });
});

it.each([
  ['OwnerSigExpired', 'approval has expired'],
  ['RulesExpired', 'rule has expired'],
  ['ERC20InsufficientAllowance', 'spending approval'],
  ['ERC20InsufficientBalance', 'not enough funds'],
  ['TooManyAllowedCallPins', 'more than 32 conditions'],
])(
  'explains %s without confusing approvals, rules and balances',
  (name, text) => {
    expect(
      new AgenticRevertError('diagnostic', { decodedError: { name } })
        .userMessage
    ).toContain(text);
  }
);

it.each([
  ['a Push-chain rule', {}],
  ['an EVM rule without tokens', { chainNamespace, assets: [] as never[] }],
])(
  'rejects %s without allowed functions before signing',
  async (_name, shape) => {
    const rt = mockRuntime(new FakeChain(), { signer: ADDR.owner });
    const sdk = new AgenticNamespaceImpl(rt);
    for (const allowedCalls of [undefined, []])
      await expect(
        sdk.create('No functions', {
          rules: [
            {
              agent: ADDR.agent,
              validUntil: 2_000_000_000,
              ...shape,
              allowedCalls,
            },
          ],
        })
      ).rejects.toMatchObject({
        code: 'INVALID_RULE',
        details: {
          reason: 'ALLOWED_FUNCTION_REQUIRED',
          field: 'allowedCalls',
        },
        userMessage: expect.stringContaining(
          'allow transfers back to the owner'
        ),
      });
    expect(rt.executeMock).not.toHaveBeenCalled();
    expect(rt.atomicMock).not.toHaveBeenCalled();
  }
);
