import { readNativeCounters } from '../__e2e__/shared/agw-state';
/**
 * Real-contract checks of the AGW SDK against the pinned e704d5b contracts on a
 * local anvil chain (see harness.ts for scope and limits). Every assertion
 * about authorization, atomicity, counters and checkpoints is decided by the
 * real contracts; the only stubbed component is the gateway.
 */
import { encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from 'viem';
import { AgenticError, AgenticRevertError, CHAIN, type PushChain } from '../src';
import { AGENTIC_ERROR_CODE } from '../src/lib/agentic/errors';
import { startHarness, type Harness } from './harness';

const TARGET_ABI = parseAbi([
  'function increment()',
  'function counter() view returns (uint256)',
  'function deposit(address beneficiary, uint256 amount) payable',
  'function lastBeneficiary() view returns (address)',
]);
const WALLET_ABI = parseAbi([
  'function checkpointCount() view returns (uint64)',
  'function agentOf(bytes32) view returns (address)',
  'function owner() view returns (address)',
]);

const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

describe('AGW SDK against real e704d5b contracts (local anvil)', () => {
  let h: Harness;
  let owner: PushChain;
  let ownerAddr: Address;
  let agentAddr: Address;

  beforeAll(async () => {
    h = await startHarness();
    owner = await h.client(0);
    ownerAddr = h.wallets[0].account!.address;
    agentAddr = h.wallets[1].account!.address;
  });
  afterAll(async () => {
    await h?.stop();
  });

  const counter = () =>
    h.publicClient.readContract({ address: h.addresses.target, abi: TARGET_ABI, functionName: 'counter' });
  const checkpointCount = (wallet: Address) =>
    h.publicClient.readContract({ address: wallet, abi: WALLET_ABI, functionName: 'checkpointCount' });

  it('derive() predicts slot 0 from the signer identity and matches the factory', async () => {
    const d = await owner.agentic.derive();
    expect(d.index).toBe(0);
    expect(d.deployed).toBe(false);
    const [predicted] = (await h.publicClient.readContract({
      address: h.addresses.factory,
      abi: h.generation.contracts.abis.factory,
      functionName: 'predictWallet',
      args: [ownerAddr, BigInt(0)],
    })) as readonly [Address, boolean];
    expect(d.address).toBe(getAddress(predicted));
  });

  let bare: Address;
  it('create(label, { rules: [] }) deploys a bare wallet without funding it', async () => {
    const created = await owner.agentic.create('scratch', { rules: [] });
    bare = created.wallet;
    expect(created.index).toBe(0);
    expect(created.rulesIds).toEqual([]);
    expect(await h.publicClient.getBalance({ address: bare })).toBe(BigInt(0));
    const info = await owner.agentic.wallet(bare).info();
    expect(info).toMatchObject({ label: 'scratch', index: 0, owner: ownerAddr, deployed: true, rulesCount: 0 });
  });

  let wallet: Address;
  let rule1: Hex;
  it('create with a native rule returns the receipt-confirmed ID; grant order and IDs match the contract', async () => {
    const created = await owner.agentic.create('ops', {
      rules: [
        { agent: agentAddr, target: h.addresses.target, selector: 'increment()', validUntil: inAnHour(), maxCalls: 2 },
      ],
    });
    wallet = created.wallet;
    rule1 = created.rulesIds[0];
    expect(created.index).toBe(1);
    expect(created.rulesIds).toHaveLength(1);
    const agentOf = await h.publicClient.readContract({
      address: wallet,
      abi: WALLET_ABI,
      functionName: 'agentOf',
      args: [rule1],
    });
    expect(agentOf).toBe(agentAddr);
    // Sequential fallback on a 7702-less localnet is reported honestly.
    expect(typeof created.tx.atomic).toBe('boolean');
  });

  it('list() returns both deployed wallets plus the next undeployed slot', async () => {
    const { wallets } = await owner.agentic.list();
    expect(wallets.map((w) => [w.index, w.label, w.deployed, w.rulesCount])).toEqual([
      [0, 'scratch', true, 0],
      [1, 'ops', true, 1],
      [2, '', false, 0],
    ]);
  });

  it('rules.get / rules.list decode active terms without exposing internal spend', async () => {
    const rec = await owner.agentic.wallet(wallet).rules.get(rule1);
    expect(rec.agent).toBe(agentAddr);
    expect(rec.rule).toMatchObject({ target: h.addresses.target, maxCalls: 2, maxValuePerCall: BigInt(0) });
    expect(rec).not.toHaveProperty('spent');
    expect(await readNativeCounters(h.publicClient, h.generation.addresses, wallet, rule1)).toEqual({ valueSpent: BigInt(0), amountSpent: BigInt(0), callsUsed: 0 });
    const { rules } = await owner.agentic.wallet(wallet).rules.list();
    expect(rules.map((r) => r.rulesId)).toEqual([rule1]);
  });

  let agent: PushChain;
  it('agent client: universal.account is the wallet, origin stays the signer, sends go through executeAsAgent', async () => {
    agent = await h.client(1, { agenticWallet: wallet });
    expect(agent.universal.account).toBe(wallet);
    expect(agent.universal.origin.address.toLowerCase()).toBe(agentAddr.toLowerCase());
    const before = await counter();
    const tx = await agent.universal.sendTransaction({
      to: h.addresses.target,
      data: encodeFunctionData({ abi: TARGET_ABI, functionName: 'increment' }),
    });
    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);
    expect(await counter()).toBe(before + BigInt(1));
    expect(tx.from).toBe(wallet);
    expect(receipt.from).toBe(wallet);
    expect(tx.to).toBe(h.addresses.target);
    expect(tx.agentic).toMatchObject({ wallet, door: 'agent', rulesId: rule1 });
    expect(tx.agentic?.rawTo?.toLowerCase()).toBe(wallet.toLowerCase());
  });

  it('agent sends do not tick checkpoints; the policy enforces maxCalls on-chain', async () => {
    const cpBefore = await checkpointCount(wallet);
    await (
      await agent.universal.sendTransaction({
        to: h.addresses.target,
        data: encodeFunctionData({ abi: TARGET_ABI, functionName: 'increment' }),
      })
    ).wait();
    expect(await checkpointCount(wallet)).toBe(cpBefore);
    const rec = await owner.agentic.wallet(wallet).rules.get(rule1);
    expect(rec).not.toHaveProperty('spent');
    expect(await readNativeCounters(h.publicClient, h.generation.addresses, wallet, rule1)).toMatchObject({ callsUsed: 2 });
    const err = await agent.universal
      .sendTransaction({
        to: h.addresses.target,
        data: encodeFunctionData({ abi: TARGET_ABI, functionName: 'increment' }),
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AgenticRevertError);
    expect(err.decodedError?.name).toBe('PolicyCheckReverted(CallLimitReached)');
  });

  it('a stranger cannot initialize against the wallet', async () => {
    await expect(h.client(2, { agenticWallet: wallet })).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.NOT_OWNER_OR_AGENT,
    });
  });

  it('owner client goes through execute and ticks one OWNER_ACTION checkpoint per call', async () => {
    const ownerAgw = await h.client(0, { agenticWallet: wallet });
    const before = await checkpointCount(wallet);
    const data = encodeFunctionData({ abi: TARGET_ABI, functionName: 'increment' });
    const tx = await ownerAgw.universal.sendTransaction({
      to: h.addresses.target,
      data: [
        { to: h.addresses.target, value: BigInt(0), data },
        { to: h.addresses.target, value: BigInt(0), data },
      ],
    });
    await tx.wait();
    expect(await checkpointCount(wallet)).toBe(before + BigInt(2));
    expect(tx.agentic?.door).toBe('owner');
    const { checkpoints } = await owner.agentic.wallet(wallet).checkpoints({ sinceBlock: tx.blockNumber });
    expect(checkpoints.map((c) => c.kind)).toEqual(['OWNER_ACTION', 'OWNER_ACTION']);
  });

  it('native agent arrays require an available atomic executor instead of sequential fallback', async () => {
    const data = encodeFunctionData({ abi: TARGET_ABI, functionName: 'increment' });
    await expect(
      agent.universal.sendTransaction({
        to: h.addresses.target,
        data: [
          { to: h.addresses.target, value: BigInt(0), data },
          { to: h.addresses.target, value: BigInt(0), data },
        ],
      })
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.CAPABILITY_UNAVAILABLE });
  });

  let rule2: Hex;
  it('rules.update replaces atomically: five checkpoints, old disabled, new usable with reset counters', async () => {
    const before = await checkpointCount(wallet);
    const res = await owner.agentic.wallet(wallet).rules.update({
      rules: [
        {
          rulesId: rule1,
          rule: { agent: agentAddr, target: h.addresses.target, selector: 'increment()', validUntil: inAnHour(), maxCalls: 1 },
        },
      ],
    });
    rule2 = res.rules[0].rulesId;
    expect(res.rules[0].replaced).toBe(rule1);
    expect(await checkpointCount(wallet)).toBe(before + BigInt(5));
    const { checkpoints } = await owner.agentic.wallet(wallet).checkpoints({ sinceBlock: res.tx.blockNumber });
    expect(checkpoints.map((c) => c.kind)).toEqual([
      'OWNER_ACTION',
      'OWNER_ACTION',
      'RULES_REVOKED',
      'OWNER_ACTION',
      'RULES_GRANTED',
    ]);
    const rec = await owner.agentic.wallet(wallet).rules.get(rule2);
    expect(rec).not.toHaveProperty('spent');
    expect(await readNativeCounters(h.publicClient, h.generation.addresses, wallet, rule2)).toMatchObject({ callsUsed: 0 });
    await expect(owner.agentic.wallet(wallet).rules.get(rule1)).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.RULE_NOT_FOUND,
    });
    const tx = await agent.universal.sendTransaction({
      to: h.addresses.target,
      data: encodeFunctionData({ abi: TARGET_ABI, functionName: 'increment' }),
    });
    expect(tx.agentic?.rulesId).toBe(rule2);
  });

  it('full checkpoint history is contiguous and matches checkpointCount()', async () => {
    const { checkpoints } = await owner.agentic.wallet(wallet).checkpoints();
    expect(checkpoints.map((c) => c.seq)).toEqual(checkpoints.map((_, i) => i + 1));
    expect(BigInt(checkpoints.length)).toBe(await checkpointCount(wallet));
    expect(checkpoints[0].kind).toBe('RULES_GRANTED');
  });

  it('bare revoke is refused; revoke({ all: true }) disables every rule', async () => {
    await expect(
      owner.agentic.wallet(wallet).rules.revoke(undefined as unknown as Hex[])
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.REVOKE_NEEDS_TARGET });
    await expect(owner.agentic.wallet(wallet).rules.revoke([])).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.REVOKE_NEEDS_TARGET,
    });
    await (await owner.agentic.wallet(wallet).rules.revoke({ all: true })).wait();
    const { rules } = await owner.agentic.wallet(wallet).rules.list();
    expect(rules).toEqual([]);
    await expect(
      agent.universal.sendTransaction({
        to: h.addresses.target,
        data: encodeFunctionData({ abi: TARGET_ABI, functionName: 'increment' }),
      })
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.NO_RULES_FOR_CHAIN });
  });

  it('a non-owner cannot write rules (fails before signing)', async () => {
    const stranger = await h.client(2);
    await expect(
      stranger.agentic.wallet(wallet).rules.add([
        { agent: agentAddr, target: h.addresses.target, selector: 'increment()', validUntil: inAnHour() },
      ])
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.NOT_WALLET_OWNER });
  });

  it('a read-only client can read but never sign, even with the owner address', async () => {
    const ro = await h.readOnlyClient(0, { agenticWallet: wallet });
    expect(ro.universal.account).toBe(wallet);
    expect((await ro.agentic.wallet(wallet).owner()).owner).toBe(ownerAddr);
    await expect(
      ro.agentic.wallet(wallet).rules.add([
        { agent: agentAddr, target: h.addresses.target, selector: 'increment()', validUntil: inAnHour() },
      ])
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.READ_ONLY });
    expect(() =>
      ro.universal.sendTransaction({ to: h.addresses.target, data: '0x' })
    ).toThrow(/Read only/);
  });

  it('reinitialize without agenticWallet returns an ordinary client', async () => {
    const ownerAgw = await h.client(0, { agenticWallet: wallet });
    const plain = await ownerAgw.reinitialize(
      await import('../src').then((m) =>
        m.PushChain.utils.signer.toUniversalFromKeypair(h.wallets[0], {
          chain: m.CHAIN.PUSH_LOCALNET,
          library: m.PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        })
      )
    );
    expect(plain.universal.account.toLowerCase()).toBe(ownerAddr.toLowerCase());
  });

  it('signer-level and cascade entry points are closed in agentic mode', async () => {
    const ownerAgw = await h.client(0, { agenticWallet: wallet });
    const code = AGENTIC_ERROR_CODE.NOT_ALLOWED_IN_AGENTIC_MODE;
    expect(() => ownerAgw.universal.prepareTransaction({ to: h.addresses.target, data: '0x' })).toThrow(
      expect.objectContaining({ code })
    );
    await expect(ownerAgw.universal.executeTransactions([])).rejects.toMatchObject({ code });
    expect(() => ownerAgw.universal.migrateCEA(CHAIN.ETHEREUM_SEPOLIA)).toThrow(expect.objectContaining({ code }));
    expect(() =>
      ownerAgw.universal.rescueFunds({ universalTxId: `0x${'00'.repeat(32)}`, prc20: h.addresses.target })
    ).toThrow(expect.objectContaining({ code }));
    await expect(
      ownerAgw.universal.sendTransaction({ to: h.addresses.target, data: '0x', payGasWith: {} })
    ).rejects.toMatchObject({ code });
    await expect(
      ownerAgw.universal.sendTransaction({
        to: { address: h.addresses.target, chain: CHAIN.PUSH_LOCALNET },
        from: { chain: CHAIN.ETHEREUM_SEPOLIA },
      })
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.FROM_NOT_ALLOWED });
  });

  it('getAccountStatus stays signer-scoped in agentic mode', async () => {
    const ownerAgw = await h.client(0, { agenticWallet: wallet });
    const status = await ownerAgw.getAccountStatus();
    expect(status.mode).toBe('signer');
    expect(ownerAgw.universal.account).toBe(wallet);
  });

  it('errors from the agentic surface are typed', () => {
    expect(new AgenticError(AGENTIC_ERROR_CODE.DUPLICATE_RULE, 'x')).toBeInstanceOf(Error);
  });
});
