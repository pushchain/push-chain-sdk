/**
 * Scenario 1 — create: bare wallet and wallet with rules. Strictly gated on a
 * verified AGW deployment manifest (see _manifest.ts); beforeAll throws when
 * it is missing so a selected run cannot pass vacuously.
 */
import { getAddress, type Address } from 'viem';
import { v4 } from '../../src/lib/agentic/contracts/v4';
import {
  AGW_E2E_ENABLED,
  inSeconds,
  setupAgw,
  type AgwFixture,
} from './_fixture';

const d = AGW_E2E_ENABLED ? describe : describe.skip;

d('agw create', () => {
  let f: AgwFixture;
  beforeAll(async () => {
    f = await setupAgw();
  }, 300_000);
  afterAll(() => f?.teardown());

  it('1. bare wallet: factory records the owner and index, no rules, no implicit funding', async () => {
    const before = await f.owner.agentic.derive();
    const created = await f.owner.agentic.create('e2e-bare', { rules: [] });
    expect(created.wallet).toBe(before.address);
    expect(created.index).toBe(before.index);
    expect(created.rulesIds).toEqual([]);
    const factoryAbi = v4.abis.factory;
    const [ownerOf, indexOf, balance] = await Promise.all([
      f.push.readContract({
        address: f.manifest.addresses.factory,
        abi: factoryAbi,
        functionName: 'ownerOf',
        args: [created.wallet],
      }),
      f.push.readContract({
        address: f.manifest.addresses.factory,
        abi: factoryAbi,
        functionName: 'indexOf',
        args: [created.wallet],
      }),
      f.push.getBalance({ address: created.wallet }),
    ]);
    expect(getAddress(ownerOf as Address)).toBe(f.ownerAddress);
    expect(Number(indexOf)).toBe(created.index);
    expect(balance).toBe(BigInt(0));
    const info = await f.owner.agentic.wallet(created.wallet).info();
    expect(info).toMatchObject({
      label: 'e2e-bare',
      deployed: true,
      rulesCount: 0,
      owner: f.ownerAddress,
    });
    f.evidence('create-bare', {
      wallet: created.wallet,
      index: created.index,
      tx: created.tx.hash,
      block: created.tx.blockNumber,
    });
  });

  it('2. wallet with a native rule returns the receipt-confirmed rule ID', async () => {
    const created = await f.owner.agentic.create('e2e-rules', {
      rules: [
        {
          agent: f.agentAddress,
          target: f.ownerAddress,
          selector: 'value-only',
          validUntil: inSeconds(3600),
          maxValuePerCall: BigInt(1),
        },
      ],
    });
    expect(created.rulesIds).toHaveLength(1);
    const { rules } = await f.owner.agentic.wallet(created.wallet).rules.list();
    expect(rules.map((r) => r.rulesId)).toEqual(created.rulesIds);
    expect(rules[0].agent).toBe(getAddress(f.agentAddress));
    f.evidence('create-with-rule', {
      wallet: created.wallet,
      rulesIds: created.rulesIds,
      tx: created.tx.hash,
      atomic: created.tx.atomic,
    });
  });
});
