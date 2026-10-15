import { getAddress } from 'viem';
import { PublicKey } from '@solana/web3.js';
import { normalizePublicRule, publicRules, WALLET } from '../public-rule';
import { prepareWalletRules } from '../management/prepare';
import { currentGeneration, resetAgenticGenerations } from '../deployments';
import { PUSH_NETWORK } from '../../constants/enums';
import { Snapshot } from '../reads/snapshot';
import { UINT256_MAX } from '../codec/defaults';
import type {
  Rule,
  NativeMultiRule,
  UniversalRule,
  SolanaRule,
} from '../agentic.types';
import { ADDR, FakeChain, registerFakeGeneration } from './fake-chain';
import { mockRuntime } from './mock-runtime';
import { compileSvmIdlRule } from '../codec/svm-idl';
const now = 1_700_000_000;
const wallet = getAddress('0x000000000000000000000000000000000000aaaa');
const base = (): Rule => ({
  agent: ADDR.agent,
  validUntil: now + 100,
  allowedCalls: [
    {
      target: ADDR.target,
      selector: 'transfer(address,uint256)',
      pins: [
        { arg: 0, expected: WALLET },
        { arg: 1, max: BigInt(5) },
      ],
    },
  ],
});
const fake = () => new FakeChain();
async function normalize(rule: Rule) {
  return normalizePublicRule(
    publicRules([rule])[0],
    wallet,
    mockRuntime(fake())
  );
}
beforeEach(registerFakeGeneration);
afterEach(resetAgenticGenerations);
it('normalizes unified native calls into exact EQ/MAX words with zero PC default', async () => {
  const out = (await normalize(base())) as NativeMultiRule;
  expect(out.actions).toEqual([
    expect.objectContaining({
      maxValuePerCall: BigInt(0),
      maxValueTotal: UINT256_MAX,
      maxCalls: 0xffffffff,
      wirePins: [
        { offset: 4, op: 0, value: `0x${wallet.slice(2).padStart(64, '0')}` },
        { offset: 36, op: 1, value: `0x${'0'.repeat(63)}5` },
      ],
    }),
  ]);
  const rt = mockRuntime(fake());
  const [p] = await prepareWalletRules(
    rt,
    currentGeneration(PUSH_NETWORK.TESTNET_DONUT),
    ADDR.owner,
    wallet,
    publicRules([base()]),
    await Snapshot.at(rt.reader)
  );
  expect(p.nativeTerms?.[0].pins[1]).toMatchObject({
    op: 1,
    value: `0x${'0'.repeat(63)}5`,
  });
});
it.each(['actions', 'target', 'amount', 'maxCalls', 'maxValueTotal', 'ref'])(
  'rejects retired top-level %s before signing',
  async (field) => {
    await expect(normalize({ ...base(), [field]: null })).rejects.toMatchObject(
      { code: 'INVALID_RULE' }
    );
  }
);
it('supports multiple native MAX pins', async () => {
  const r = base();
  r.allowedCalls[0].pins = [
    { arg: 0, max: BigInt(1) },
    { arg: 1, max: BigInt(2) },
  ];
  expect(
    ((await normalize(r)) as NativeMultiRule).actions[0].wirePins
  ).toHaveLength(2);
});
it('compiles the existing EVM WALLET beneficiary and defaults asset total to zero', async () => {
  const r = base();
  r.chainNamespace = 'eip155:11155111';
  r.assets = [{ token: ADDR.other, maxPerCall: BigInt(1) }];
  r.allowedCalls[0].pins = [{ arg: 0, expected: WALLET }];
  const out = (await normalize(r)) as UniversalRule;
  expect(out.allowedCalls[0]).toMatchObject({
    pins: [expect.objectContaining({ offset: 4, op: 0 })],
    maxValue: BigInt(0),
  });
  expect(out.assets[0].maxTotal).toBe(BigInt(0));
});
it('supports general destination EQ/MAX pins', async () => {
  const out = (await normalize({
    ...base(),
    chainNamespace: 'eip155:11155111',
  })) as UniversalRule;
  expect(out.allowedCalls[0].pins?.map((p) => p.op)).toEqual([0, 1]);
});
it('computes top-level offsets after static arrays and preserves a raw-word round trip', async () => {
  const r = base();
  r.allowedCalls[0] = {
    target: ADDR.target,
    selector: 'f(uint256[2],uint256)',
    pins: [{ arg: 1, max: BigInt(1) }],
  };
  const out = (await normalize(r)) as NativeMultiRule;
  expect(out.actions[0].wirePins?.[0].offset).toBe(68);
});
it('compiles numeric Solana arg/account pins without a caller IDL', async () => {
  const program = new PublicKey(Buffer.alloc(32, 3)).toBase58();
  const gateway = new PublicKey(Buffer.alloc(32, 4)).toBase58();
  const rt = mockRuntime(fake(), {
    svmMetadata: {
      gateway: async (chain) => ({ chainNamespace: chain, program: gateway }),
      mint: async () => {
        throw Error('unused');
      },
    },
  });
  const rule: Rule = {
    agent: ADDR.agent,
    chainNamespace: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    validUntil: now + 100,
    allowedCalls: [
      {
        target: program,
        selector: 'receive_sol(u64)',
        pins: [
          { account: 0, expected: WALLET },
          { arg: 0, max: BigInt(5) },
        ],
      },
    ],
  };
  const out = (await normalizePublicRule(
    publicRules([rule])[0],
    wallet,
    rt
  )) as SolanaRule;
  const cea = `0x${'01'.repeat(32)}` as const;
  const terms = compileSvmIdlRule(
    out,
    {
      expectedCEA: cea,
      gatewayProgram: `0x${'04'.repeat(32)}`,
      assets: [
        { token: ADDR.other, maxPerCall: BigInt(1), maxTotal: BigInt(1) },
      ],
      ceaAccounts: [cea],
      tokenAccounts: new Map(),
    },
    now
  );
  expect(terms.programs[0].maxAccounts).toBe(255);
  expect(terms.pins).toEqual([
    { ruleIndex: 0, accountIndex: 0, expected: cea },
  ]);
  expect(terms.dataPins[0]).toMatchObject({ offset: 8, len: 8, mode: 2 });
});

it('public create rejects missing options asynchronously, and update rejects malformed pairs before reads', async () => {
  const { AgenticNamespaceImpl } = await import('../agentic');
  const { AgenticWalletHandle } = await import('../wallet');
  const rt = mockRuntime(fake(), { signer: ADDR.owner });
  const ns = new AgenticNamespaceImpl(rt);
  await expect(ns.create('invalid', undefined as never)).rejects.toMatchObject({
    code: 'INVALID_RULE',
  });
  const handle = new AgenticWalletHandle(rt, wallet);
  for (const params of [
    undefined,
    {},
    { rules: [] },
    { rules: [null] },
    { rules: [{ rulesId: '0x', rule: base() }] },
  ]) {
    await expect(handle.rules.update(params as never)).rejects.toMatchObject({
      code: 'INVALID_RULE',
    });
  }
  expect(rt.fake.calls).toEqual([]);
  expect(rt.executeMock).not.toHaveBeenCalled();
});

it('does not silently discard a token qualifier on an argument pin', async () => {
  const r = base();
  r.allowedCalls[0].pins = [
    { arg: 0, expected: WALLET, token: ADDR.other } as never,
  ];
  await expect(normalize(r)).rejects.toMatchObject({ code: 'INVALID_RULE' });
});

it('reads native wallet equality as WALLET and re-encodes its exact word', async () => {
  const { getRule } = await import('../reads/rules');
  const { ruleId } = await import('./fake-chain');
  const chain = fake();
  const w = chain.addWallet(ADDR.owner, 'wallet-pin');
  const word = `0x${w.address
    .slice(2)
    .toLowerCase()
    .padStart(64, '0')}` as const;
  w.rules.push(
    chain.nativeRule(ADDR.agent, ruleId(1), {
      pins: [{ offset: 4, op: 0, value: word }],
    })
  );
  const rt = mockRuntime(chain);
  const rec = await getRule(
    await Snapshot.at(chain),
    currentGeneration(PUSH_NETWORK.TESTNET_DONUT),
    w.address,
    ruleId(1),
    rt.pushChainNamespace
  );
  expect(rec.rule).toMatchObject({
    allowedCalls: [{ pins: [{ arg: 0, expected: WALLET }] }],
  });
  const normalized = (await normalizePublicRule(
    publicRules([rec.rule])[0],
    w.address,
    rt
  )) as NativeMultiRule;
  expect(normalized.actions[0].wirePins).toEqual([
    { offset: 4, op: 0, value: word },
  ]);
});
