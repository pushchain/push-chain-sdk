/**
 * Multi-action native rules against the real pinned v6 contracts: one rule ID
 * allows several Push functions, each metered by its own stored terms.
 * Unified section-6 public shape; the contract support
 * (AGW MAX_NATIVE_ACTIONS = 8) is what these tests exercise.
 */
import {
  encodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { AgenticRevertError, CHAIN, type Rule, type PushChain } from '../src';
import { PUSH_BATCH_EXECUTOR_ADDRESS } from '../src/lib/constants/chain';
import { startHarness, type Harness } from './harness';
const ABI = parseAbi([
  'function increment()',
  'function counter() view returns (uint256)',
  'function deposit(address beneficiary, uint256 amount) payable',
  'function lastBeneficiary() view returns (address)',
  'function received() view returns (uint256)',
]);
const WALLET = parseAbi(['function checkpointCount() view returns (uint64)']);
const beneficiary = getAddress('0x00000000000000000000000000000000000b0b0b');
let h: Harness;
let owner: PushChain;
let previousExecutor: Address | undefined;
beforeAll(async () => {
  h = await startHarness(18553);
  previousExecutor = PUSH_BATCH_EXECUTOR_ADDRESS[CHAIN.PUSH_LOCALNET];
  PUSH_BATCH_EXECUTOR_ADDRESS[CHAIN.PUSH_LOCALNET] = await h.deploy(
    0,
    'HarnessAtomicExecutor',
    'HarnessFixtures.sol'
  );
  owner = await h.client(0);
});
afterAll(async () => {
  if (previousExecutor)
    PUSH_BATCH_EXECUTOR_ADDRESS[CHAIN.PUSH_LOCALNET] = previousExecutor;
  else delete PUSH_BATCH_EXECUTOR_ADDRESS[CHAIN.PUSH_LOCALNET];
  await h?.stop();
});
const now = async () => Number((await h.publicClient.getBlock()).timestamp);
const counter = () =>
  h.publicClient.readContract({
    address: h.addresses.target,
    abi: ABI,
    functionName: 'counter',
  });
const increment = () =>
  encodeFunctionData({ abi: ABI, functionName: 'increment' });
const deposit = (to: Address, amount: bigint) =>
  encodeFunctionData({ abi: ABI, functionName: 'deposit', args: [to, amount] });
async function rule(): Promise<Rule> {
  return {
    agent: h.wallets[1].account!.address,
    validUntil: (await now()) + 3600,
    allowedCalls: [
      {
        target: h.addresses.target,
        selector: 'increment()',
      },
      {
        target: h.addresses.target,
        selector: 'deposit(address,uint256)',
        pins: [
          { arg: 0, expected: beneficiary },
          { arg: 1, max: BigInt(10) },
        ],
      },
    ],
  };
}
describe('multi-action native rules (real v6 contracts)', () => {
  let wallet: Address;
  let rulesId: Hex;
  let agent: PushChain;
  beforeAll(async () => {
    const created = await owner.agentic.create('multi-action', {
      rules: [await rule()],
    });
    wallet = created.wallet;
    rulesId = created.rulesIds[0];
    agent = await h.client(1, { agenticWallet: wallet });
  });
  it('grants both functions under ONE rule ID and reads them back in order', async () => {
    const { rules } = await owner.agentic.wallet(wallet).rules.list();
    expect(rules.map((r) => r.rulesId)).toEqual([rulesId]);
    const decoded = rules[0].rule as Rule;
    expect(decoded.allowedCalls.map((a) => a.selector)).toEqual([
      '0xd09de08a',
      '0x47e7ef24',
    ]);
    expect(rules[0].spent).toMatchObject({
      kind: 'native',
      actions: [
        expect.objectContaining({ callsUsed: 0 }),
        expect.objectContaining({ callsUsed: 0 }),
      ],
    });
    expect(decoded.allowedCalls[1]).toMatchObject({
      pins: [
        {
          arg: 0,
          expected: `0x${'0'.repeat(24)}${beneficiary.slice(2).toLowerCase()}`,
        },
        { arg: 1, max: BigInt(10) },
      ],
    });
  });
  it('the agent can call each allowed function; each is checked against its own terms', async () => {
    const before = await counter();
    const t1 = await agent.universal.sendTransaction({
      to: h.addresses.target,
      data: increment(),
    });
    expect((await t1.wait()).status).toBe(1);
    expect(t1.agentic?.rulesId).toBe(rulesId);
    const t2 = await agent.universal.sendTransaction({
      to: h.addresses.target,
      data: deposit(beneficiary, BigInt(5)),
    });
    expect((await t2.wait()).status).toBe(1);
    expect(t2.agentic?.rulesId).toBe(rulesId);
    expect(await counter()).toBe(before + BigInt(2));
    expect(
      await h.publicClient.readContract({
        address: h.addresses.target,
        abi: ABI,
        functionName: 'lastBeneficiary',
      })
    ).toBe(beneficiary);
  });
  it('per-action limits still apply: a wrong pin and an over-cap amount are rejected on-chain', async () => {
    const wrongPin = await agent.universal
      .sendTransaction({
        to: h.addresses.target,
        data: deposit(h.wallets[3].account!.address, BigInt(5)),
      })
      .catch((e) => e);
    expect(wrongPin).toBeInstanceOf(AgenticRevertError);
    expect(wrongPin.decodedError?.name).toBe(
      'PolicyCheckReverted(ArgPinMismatch)'
    );
    const overCap = await agent.universal
      .sendTransaction({
        to: h.addresses.target,
        data: deposit(beneficiary, BigInt(11)),
      })
      .catch((e) => e);
    expect(overCap).toBeInstanceOf(AgenticRevertError);
  });
  it('a function outside the rule’s actions is rejected on-chain', async () => {
    const err = await agent.universal
      .sendTransaction({
        to: h.addresses.target,
        data: encodeFunctionData({ abi: ABI, functionName: 'received' }),
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AgenticRevertError);
  });
  it('per-action spend is independent across repeated calls', async () => {
    await (
      await agent.universal.sendTransaction({
        to: h.addresses.target,
        data: increment(),
      })
    ).wait();
    await (
      await agent.universal.sendTransaction({
        to: h.addresses.target,
        data: increment(),
      })
    ).wait();
    await (
      await agent.universal.sendTransaction({
        to: h.addresses.target,
        data: deposit(beneficiary, BigInt(5)),
      })
    ).wait();
    expect(
      (await owner.agentic.wallet(wallet).rules.get(rulesId)).spent
    ).toMatchObject({
      kind: 'native',
      actions: [
        { callsUsed: 3, amountSpent: BigInt(0) },
        { callsUsed: 2, amountSpent: BigInt(0) },
      ],
    });
  });
  it('one atomic agent batch can mix functions of the same rule', async () => {
    const created = await owner.agentic.create('multi-action-batch', {
      rules: [await rule()],
    });
    const batchAgent = await h.client(1, { agenticWallet: created.wallet });
    const before = await counter();
    const tx = await batchAgent.universal.sendTransaction({
      to: h.addresses.target,
      data: [
        { to: h.addresses.target, value: BigInt(0), data: increment() },
        {
          to: h.addresses.target,
          value: BigInt(0),
          data: deposit(beneficiary, BigInt(7)),
        },
      ],
    });
    expect((await tx.wait()).status).toBe(1);
    expect(tx.agentic?.rulesId).toBe(created.rulesIds[0]);
    expect(await counter()).toBe(before + BigInt(2));
    // All-or-nothing: an over-cap item reverts the whole batch, including the increment.
    const mid = await counter();
    const bad = await batchAgent.universal
      .sendTransaction({
        to: h.addresses.target,
        data: [
          { to: h.addresses.target, value: BigInt(0), data: increment() },
          {
            to: h.addresses.target,
            value: BigInt(0),
            data: deposit(beneficiary, BigInt(11)),
          },
        ],
      })
      .catch((e) => e);
    expect(bad).toBeInstanceOf(AgenticRevertError);
    expect(await counter()).toBe(mid);
  });
  it('rules.update replaces a multi-action rule atomically, asserting every action’s spend', async () => {
    const before = (await h.publicClient.readContract({
      address: wallet,
      abi: WALLET,
      functionName: 'checkpointCount',
    })) as bigint;
    const replacement: Rule = {
      ...(await rule()),
      allowedCalls: [(await rule()).allowedCalls[0]],
    };
    const res = await owner.agentic
      .wallet(wallet)
      .rules.update({ rules: [{ rulesId, rule: replacement }] });
    // 2 assertions + revoke + grant = 4 OWNER_ACTION, then RULES_REVOKED and RULES_GRANTED.
    expect(
      (await h.publicClient.readContract({
        address: wallet,
        abi: WALLET,
        functionName: 'checkpointCount',
      })) as bigint
    ).toBe(before + BigInt(6));
    const { rules } = await owner.agentic.wallet(wallet).rules.list();
    expect(rules.map((r) => r.rulesId)).toEqual([res.rules[0].rulesId]);
    expect((rules[0].rule as Rule).allowedCalls).toHaveLength(1);
    // The new rule starts with fresh counters: increment() works again.
    expect(
      (
        await (
          await agent.universal.sendTransaction({
            to: h.addresses.target,
            data: increment(),
          })
        ).wait()
      ).status
    ).toBe(1);
  });
});
