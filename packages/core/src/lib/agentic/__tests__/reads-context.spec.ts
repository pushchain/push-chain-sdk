import { getAddress } from 'viem';
import { PUSH_NETWORK } from '../../constants/enums';
import { resolveAgenticContext } from '../context';
import { resetAgenticGenerations, currentGeneration } from '../deployments';
import { AGENTIC_ERROR_CODE } from '../errors';
import { readCheckpoints, validateSequence } from '../reads/checkpoints';
import { getRule, listRules, selectRuleForSend } from '../reads/rules';
import { Snapshot, scanLogs } from '../reads/snapshot';
import { deriveForOwner, listForOwner, walletInfo } from '../reads/wallets';
import {
  ADDR,
  FakeChain,
  PUSH_NS,
  SEPOLIA_NS,
  checkpointLog,
  log,
  registerFakeGeneration,
  ruleId,
} from './fake-chain';
import { mockRuntime } from './mock-runtime';
import { v5 } from '../contracts/v5';
import { readOriginToken } from '../contracts/prc20-metadata';

describe('generation registry', () => {
  afterEach(() => resetAgenticGenerations());

  it('ships Donut v5 only; other networks are unsupported', () => {
    resetAgenticGenerations();
    expect(currentGeneration(PUSH_NETWORK.TESTNET_DONUT)).toMatchObject({
      id: 'v5',
      advertised: true,
    });
    for (const n of Object.values(PUSH_NETWORK).filter(
      (n) => n !== PUSH_NETWORK.TESTNET_DONUT
    )) {
      expect(() => currentGeneration(n)).toThrow(
        expect.objectContaining({
          code: AGENTIC_ERROR_CODE.GENERATION_UNSUPPORTED,
        })
      );
    }
  });

  it('initialize against any wallet fails before signing when no generation is registered', async () => {
    resetAgenticGenerations();
    const fake = new FakeChain();
    await expect(
      resolveAgenticContext(
        mockRuntime(fake, { network: PUSH_NETWORK.MAINNET }),
        ADDR.target
      )
    ).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.GENERATION_UNSUPPORTED,
    });
  });
});

describe('Donut log-range limit', () => {
  it('covers the full range in contiguous pages of at most 1,000 blocks', async () => {
    const fake = new FakeChain();
    const getLogs = jest.spyOn(fake, 'getLogs');
    await scanLogs(
      fake,
      { address: ADDR.factory, event: v5.events.walletDeployed },
      BigInt(10),
      BigInt(2010)
    );
    expect(getLogs.mock.calls.map(([a]) => [a.fromBlock, a.toBlock])).toEqual([
      [BigInt(10), BigInt(1009)],
      [BigInt(1010), BigInt(2009)],
      [BigInt(2010), BigInt(2010)],
    ]);
  });
});

describe('native PRC20 metadata', () => {
  it('accepts a zero address word only for the registered gas token', async () => {
    const fake = new FakeChain(),
      gas = getAddress('0x0000000000000000000000000000000000007070');
    const original = fake.readContract.bind(fake);
    jest.spyOn(fake, 'readContract').mockImplementation(async (args) => {
      if (args.functionName === 'SOURCE_TOKEN_ADDRESS') {
        const abi = args.abi as readonly {
          outputs?: readonly { type: string }[];
        }[];
        if (abi[0].outputs?.[0].type === 'address')
          return '0x0000000000000000000000000000000000000000';
        throw new Error('native precompile returns a static word');
      }
      return original(args);
    });
    const snap = await Snapshot.at(fake);
    expect(await readOriginToken(snap, gas, SEPOLIA_NS)).toBe(
      '0x0000000000000000000000000000000000000000'
    );
    await expect(
      readOriginToken(snap, ADDR.target, SEPOLIA_NS)
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.RULE_READ_FAILED });
  });
});

describe('initialize with agenticWallet — door resolution', () => {
  let fake: FakeChain;
  beforeEach(() => {
    registerFakeGeneration();
    fake = new FakeChain();
  });
  afterEach(() => resetAgenticGenerations());

  it('owner → owner door; universal account context keeps signer identity separate', async () => {
    const w = fake.addWallet(ADDR.owner, 'w');
    const ctx = await resolveAgenticContext(
      mockRuntime(fake, { signer: ADDR.owner }),
      w.address
    );
    expect(ctx).toMatchObject({
      wallet: w.address,
      door: 'owner',
      signerPushAccount: ADDR.owner,
    });
  });

  it('agent named in an enabled rule → agent door, even when that rule is expired', async () => {
    const w = fake.addWallet(ADDR.owner, 'w', [
      fake.nativeRule(ADDR.agent, ruleId(1), { validUntil: 1 }),
    ]);
    const ctx = await resolveAgenticContext(mockRuntime(fake), w.address);
    expect(ctx.door).toBe('agent');
  });

  it('anyone else → NOT_OWNER_OR_AGENT', async () => {
    const w = fake.addWallet(ADDR.owner, 'w', [
      fake.nativeRule(ADDR.agent, ruleId(1)),
    ]);
    await expect(
      resolveAgenticContext(
        mockRuntime(fake, { signer: ADDR.other }),
        w.address
      )
    ).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.NOT_OWNER_OR_AGENT,
    });
  });

  it('no code → WALLET_NOT_DEPLOYED; a contract that is not an AGW → NOT_AGENTIC_WALLET', async () => {
    await expect(
      resolveAgenticContext(mockRuntime(fake), ADDR.target)
    ).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.WALLET_NOT_DEPLOYED,
    });
    await expect(
      resolveAgenticContext(mockRuntime(fake), 'not-an-address')
    ).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.NOT_AGENTIC_WALLET,
    });
  });

  it('wiring that does not match the registered generation is refused', async () => {
    const w = fake.addWallet(ADDR.owner, 'w');
    w.accountId = 'push.agentwallet.1.0.0';
    await expect(
      resolveAgenticContext(
        mockRuntime(fake, { signer: ADDR.owner }),
        w.address
      )
    ).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.GENERATION_UNSUPPORTED,
    });
  });
});

describe('per-send rule selection', () => {
  let fake: FakeChain;
  beforeEach(() => {
    registerFakeGeneration();
    fake = new FakeChain();
  });
  afterEach(() => resetAgenticGenerations());
  const gen = () => currentGeneration(PUSH_NETWORK.TESTNET_DONUT);

  it('exactly one enabled (agent, chain) match is selected, at one block', async () => {
    const w = fake.addWallet(ADDR.owner, 'w', [
      fake.nativeRule(ADDR.agent, ruleId(1)),
      fake.nativeRule(ADDR.other, ruleId(2)),
      { ...fake.nativeRule(ADDR.agent, ruleId(3)), mode: 0, chain: SEPOLIA_NS },
    ]);
    const snap = await Snapshot.at(fake);
    const r = await selectRuleForSend(
      snap,
      gen(),
      w.address,
      ADDR.agent,
      PUSH_NS
    );
    expect(r.rulesId).toBe(ruleId(1));
    const u = await selectRuleForSend(
      snap,
      gen(),
      w.address,
      ADDR.agent,
      SEPOLIA_NS
    );
    expect(u.rulesId).toBe(ruleId(3));
    expect(new Set(fake.calls.map((c) => c.blockNumber))).toEqual(
      new Set([fake.block])
    );
  });

  it('zero matches → NO_RULES_FOR_CHAIN', async () => {
    const w = fake.addWallet(ADDR.owner, 'w', [
      fake.nativeRule(ADDR.other, ruleId(2)),
    ]);
    await expect(
      selectRuleForSend(
        await Snapshot.at(fake),
        gen(),
        w.address,
        ADDR.agent,
        PUSH_NS
      )
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.NO_RULES_FOR_CHAIN });
  });

  it('direct-grant duplicates → AMBIGUOUS_RULE listing every candidate, never an arbitrary pick', async () => {
    const w = fake.addWallet(ADDR.owner, 'w', [
      fake.nativeRule(ADDR.agent, ruleId(1)),
      fake.nativeRule(ADDR.agent, ruleId(2)),
    ]);
    await expect(
      selectRuleForSend(
        await Snapshot.at(fake),
        gen(),
        w.address,
        ADDR.agent,
        PUSH_NS
      )
    ).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.AMBIGUOUS_RULE,
      details: { rulesIds: [ruleId(1), ruleId(2)] },
    });
  });

  it('a revoked rule is not a candidate; lookups are not cached between sends', async () => {
    const w = fake.addWallet(ADDR.owner, 'w', [
      fake.nativeRule(ADDR.agent, ruleId(1)),
    ]);
    expect(
      (
        await selectRuleForSend(
          await Snapshot.at(fake),
          gen(),
          w.address,
          ADDR.agent,
          PUSH_NS
        )
      ).rulesId
    ).toBe(ruleId(1));
    w.rules = [];
    await expect(
      selectRuleForSend(
        await Snapshot.at(fake),
        gen(),
        w.address,
        ADDR.agent,
        PUSH_NS
      )
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.NO_RULES_FOR_CHAIN });
  });

  it('an RPC failure is an error, never an empty rule set', async () => {
    const w = fake.addWallet(ADDR.owner, 'w', [
      fake.nativeRule(ADDR.agent, ruleId(1)),
    ]);
    fake.failOn.add('getPermissionIDs');
    await expect(
      selectRuleForSend(
        await Snapshot.at(fake),
        gen(),
        w.address,
        ADDR.agent,
        PUSH_NS
      )
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.RULE_READ_FAILED });
  });
});

describe('rules.list / rules.get', () => {
  let fake: FakeChain;
  beforeEach(() => {
    registerFakeGeneration();
    fake = new FakeChain();
  });
  afterEach(() => resetAgenticGenerations());
  const gen = () => currentGeneration(PUSH_NETWORK.TESTNET_DONUT);

  it('decodes active native records without exposing internal spend', async () => {
    const w = fake.addWallet(ADDR.owner, 'w', [
      fake.nativeRule(ADDR.agent, ruleId(1), {
        callsUsed: 3,
        valueSpent: BigInt(5),
        maxCalls: 9,
      }),
    ]);
    const rules = await listRules(
      await Snapshot.at(fake),
      gen(),
      w.address,
      PUSH_NS
    );
    expect(rules).toEqual([
      expect.objectContaining({
        rulesId: ruleId(1),
        enabled: true,
        chainNamespace: PUSH_NS,
        agent: ADDR.agent,
        rule: expect.objectContaining({ maxCalls: 9, selector: '0xd09de08a' }),
      }),
    ]);
  });

  it('public records contain no spent field', async () => {
    const w = fake.addWallet(ADDR.owner, 'w', [
      fake.nativeRule(ADDR.agent, ruleId(1)),
    ]);
    const record = await getRule(
      await Snapshot.at(fake),
      gen(),
      w.address,
      ruleId(1),
      PUSH_NS
    );
    expect(record).not.toHaveProperty('spent');
  });

  it('lists native and universal rules without truncating', async () => {
    const w = fake.addWallet(ADDR.owner, 'w', [
      fake.nativeRule(ADDR.agent, ruleId(1)),
      { ...fake.nativeRule(ADDR.other, ruleId(2)), mode: 0, chain: SEPOLIA_NS },
    ]);
    const records = await listRules(
      await Snapshot.at(fake),
      gen(),
      w.address,
      PUSH_NS
    );
    expect(records.map((r) => r.chainNamespace)).toEqual([PUSH_NS, SEPOLIA_NS]);
  });
  it('an empty source-token address is native only for the chain registry gas token', async () => {
    const token = getAddress('0x0000000000000000000000000000000000007070');
    fake.sourceTokens.set(token.toLowerCase(), '');
    const w = fake.addWallet(ADDR.owner, 'native-gas', [
      {
        ...fake.nativeRule(ADDR.agent, ruleId(1)),
        mode: 0,
        chain: SEPOLIA_NS,
        universal: {
          expectedCEA: ADDR.other,
          maxGasPerCall: BigInt(1),
          assets: [{ token }],
        },
      },
    ]);
    const record = await getRule(
      await Snapshot.at(fake),
      gen(),
      w.address,
      ruleId(1),
      PUSH_NS
    );
    expect(record.rule).toMatchObject({
      assets: [{ token: '0x0000000000000000000000000000000000000000' }],
    });
    fake.sourceTokens.set(ADDR.target.toLowerCase(), '');
    w.rules[0].universal!.assets = [{ token: ADDR.target }];
    await expect(
      getRule(await Snapshot.at(fake), gen(), w.address, ruleId(1), PUSH_NS)
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.RULE_READ_FAILED });
  });

  it('unknown and revoked IDs both return RULE_NOT_FOUND without history reconstruction', async () => {
    const w = fake.addWallet(ADDR.owner, 'w');
    const snap = await Snapshot.at(fake);
    await expect(
      getRule(snap, gen(), w.address, ruleId(9), PUSH_NS)
    ).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.RULE_NOT_FOUND,
    });
    fake.extraLogs.push(
      log(
        w.address,
        v5.events.rulesRevoked,
        { rulesId: ruleId(9) },
        {},
        BigInt(50)
      )
    );
    await expect(
      getRule(snap, gen(), w.address, ruleId(9), PUSH_NS)
    ).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.RULE_NOT_FOUND,
    });
  });
});

describe('wallet reads', () => {
  let fake: FakeChain;
  beforeEach(() => {
    registerFakeGeneration();
    fake = new FakeChain();
  });
  afterEach(() => resetAgenticGenerations());
  const gen = () => currentGeneration(PUSH_NETWORK.TESTNET_DONUT);

  it('derive defaults to the next unused index; beyond it is refused', async () => {
    fake.addWallet(ADDR.owner, 'a');
    expect(await deriveForOwner(fake, gen(), ADDR.owner)).toMatchObject({
      index: 1,
      deployed: false,
    });
    expect(await deriveForOwner(fake, gen(), ADDR.owner, 0)).toMatchObject({
      index: 0,
      deployed: true,
    });
    await expect(deriveForOwner(fake, gen(), ADDR.owner, 2)).rejects.toThrow(
      /beyond/
    );
  });

  it('derivation drift between the factory and the SDK mirror is detected (obligation 13)', async () => {
    fake.predictOverride = () =>
      getAddress('0x0000000000000000000000000000000000000bad');
    await expect(deriveForOwner(fake, gen(), ADDR.owner)).rejects.toMatchObject(
      {
        code: AGENTIC_ERROR_CODE.INCONSISTENT_READ,
      }
    );
  });

  it('list returns deployed slots with labels and rule counts plus the next undeployed slot', async () => {
    fake.addWallet(ADDR.owner, 'first', [
      fake.nativeRule(ADDR.agent, ruleId(1)),
    ]);
    fake.addWallet(ADDR.owner, '');
    const wallets = await listForOwner(fake, gen(), ADDR.owner);
    expect(
      wallets.map((w) => [w.index, w.label, w.deployed, w.rulesCount])
    ).toEqual([
      [0, 'first', true, 1],
      [1, 'AGW 2', true, 0],
      [2, '', false, 0],
    ]);
  });

  it('an empty owner lists only slot 0, undeployed', async () => {
    expect(await listForOwner(fake, gen(), ADDR.other)).toEqual([
      expect.objectContaining({
        index: 0,
        deployed: false,
        rulesCount: 0,
        label: '',
      }),
    ]);
  });

  it('reads current labels without depending on deployment logs', async () => {
    const w = fake.addWallet(ADDR.owner, 'original');
    w.label = 'renamed';
    fake.extraLogs = [];
    expect(await walletInfo(fake, gen(), w.address)).toMatchObject({ label: 'renamed' });
    expect((await listForOwner(fake, gen(), ADDR.owner))[0].label).toBe('renamed');
    expect(fake.calls.filter((c) => c.functionName === 'label')).toHaveLength(2);
    w.label = '';
    expect(await walletInfo(fake, gen(), w.address)).toMatchObject({ label: 'AGW 1' });
  });

  it('info of the signer’s next slot describes it as undeployed; other undeployed addresses are refused', async () => {
    const next = await deriveForOwner(fake, gen(), ADDR.owner);
    expect(
      await walletInfo(fake, gen(), next.address, ADDR.owner)
    ).toMatchObject({ deployed: false, index: 0, owner: ADDR.owner });
    await expect(
      walletInfo(fake, gen(), next.address, ADDR.other)
    ).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.WALLET_NOT_DEPLOYED,
    });
  });
});

describe('checkpoints', () => {
  let fake: FakeChain;
  beforeEach(() => {
    registerFakeGeneration();
    fake = new FakeChain();
  });
  afterEach(() => resetAgenticGenerations());
  const gen = () => currentGeneration(PUSH_NETWORK.TESTNET_DONUT);

  it('orders by block, tx and log index and counts five ticks for a replacement in one block', async () => {
    const w = fake.addWallet(ADDR.owner, 'w');
    // A grant (seq 1), then a replacement batch (seq 2..6) in one tx; logs arrive reversed.
    fake.checkpointLogs = [1, 2, 3, 4, 5, 6]
      .map((seq) =>
        checkpointLog(
          w.address,
          seq,
          [1, 0, 0, 2, 0, 1][seq - 1],
          seq === 1 ? BigInt(20) : BigInt(60)
        )
      )
      .reverse();
    w.checkpointCount = BigInt(6);
    const { checkpoints } = await readCheckpoints(fake, gen(), w.address);
    expect(checkpoints.map((c) => c.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(checkpoints.slice(1).map((c) => c.kind)).toEqual([
      'OWNER_ACTION',
      'OWNER_ACTION',
      'RULES_REVOKED',
      'OWNER_ACTION',
      'RULES_GRANTED',
    ]);
    const since = await readCheckpoints(fake, gen(), w.address, BigInt(60));
    expect(since.checkpoints).toHaveLength(5);
    expect(since.checkpoints.every((c) => c.blockNumber === BigInt(60))).toBe(
      true
    );
  });

  it('a count/event mismatch is reported (after one retry) rather than returned', async () => {
    const w = fake.addWallet(ADDR.owner, 'w');
    fake.checkpointLogs = [checkpointLog(w.address, 1, 1, BigInt(20))];
    w.checkpointCount = BigInt(2);
    await expect(readCheckpoints(fake, gen(), w.address)).rejects.toMatchObject(
      {
        code: AGENTIC_ERROR_CODE.INCONSISTENT_READ,
      }
    );
  });

  it('validateSequence checks contiguity and the count', () => {
    expect(validateSequence([1, 2, 3], BigInt(3), true)).toBeNull();
    expect(validateSequence([1, 3], BigInt(3), true)).toMatch(/gap/);
    expect(validateSequence([2, 3], BigInt(3), false)).toBeNull();
    expect(validateSequence([2, 3], BigInt(4), false)).toMatch(
      /does not match/
    );
    expect(validateSequence([], BigInt(0), true)).toBeNull();
  });
});
