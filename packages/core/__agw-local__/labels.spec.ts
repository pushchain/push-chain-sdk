/** Real v5 wallet/factory label state; no bridge or destination simulation. */
import { decodeEventLog, type Address } from 'viem';
import { PushChain } from '../src';
import { v5 } from '../src/lib/agentic/contracts/v5';
import { AGENTIC_ERROR_CODE } from '../src/lib/agentic/errors';
import { startHarness, type Harness } from './harness';

describe('v5 label SDK against real contracts', () => {
  let h: Harness;
  let owner: PushChain;
  beforeAll(async () => {
    h = await startHarness(18565);
    owner = await h.client(0);
  });
  afterAll(async () => {
    await h?.stop();
  });
  const count = (address: Address) =>
    h.publicClient.readContract({
      address,
      abi: v5.abis.wallet,
      functionName: 'checkpointCount',
    });

  it('stores custom deploy labels and defaults empty labels per owner index', async () => {
    const first = await owner.agentic.create('', { rules: [] });
    const second = await owner.agentic.create('custom', { rules: [] });
    const other = await h.client(2);
    const theirs = await other.agentic.create('', { rules: [] });
    expect((await owner.agentic.wallet(first.wallet).info()).label).toBe(
      `AGW ${first.index + 1}`
    );
    expect((await owner.agentic.wallet(second.wallet).info()).label).toBe(
      'custom'
    );
    expect((await other.agentic.wallet(theirs.wallet).info()).label).toBe(
      'AGW 1'
    );
    expect(await count(first.wallet)).toBe(BigInt(0));
  });

  it('renames and resets through public SDK; fresh info/list and checkpoints agree', async () => {
    const made = await owner.agentic.create('before', { rules: [] });
    const w = owner.agentic.wallet(made.wallet);
    const hook = jest.fn();
    const before = await count(made.wallet);
    const tx = await w.setLabel('after', { progressHook: hook });
    const receipt = await tx.wait();
    const labelEvents = receipt.logs.flatMap((log) => {
      if (log.address.toLowerCase() !== made.wallet.toLowerCase()) return [];
      try {
        const ev = decodeEventLog({
          abi: v5.abis.wallet,
          data: log.data,
          topics: log.topics,
        });
        return ev.eventName === 'LabelSet' ? [ev.args.label] : [];
      } catch {
        return [];
      }
    });
    expect(labelEvents).toEqual(['after']);
    expect((await w.info()).label).toBe('after');
    expect(
      (await owner.agentic.list()).wallets.find(
        (x) => x.address === made.wallet
      )?.label
    ).toBe('after');
    expect(await count(made.wallet)).toBe(before + BigInt(1));
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'AGENTIC-TX-199-01' })
    );
    await w.setLabel('');
    expect((await w.info()).label).toBe(`AGW ${made.index + 1}`);
    expect(await count(made.wallet)).toBe(before + BigInt(2));
  });

  it('direct contract rename changes no checkpoint; subsequent SDK reads show it', async () => {
    const made = await owner.agentic.create('before', { rules: [] });
    const before = await count(made.wallet);
    await h.write(0, made.wallet, v5.abis.wallet, 'setLabel', ['direct']);
    expect(await count(made.wallet)).toBe(before);
    expect((await owner.agentic.wallet(made.wallet).info()).label).toBe(
      'direct'
    );
  });

  it('accepts exactly 64 UTF-8 bytes and rejects invalid create/rename without changing count or state', async () => {
    const unicode = '🙂'.repeat(16);
    const made = await owner.agentic.create(unicode, { rules: [] });
    const w = owner.agentic.wallet(made.wallet);
    await w.setLabel('a'.repeat(64));
    const before = await count(made.wallet);
    const next = await owner.agentic.derive();
    for (const invalid of ['a'.repeat(65), '🙂'.repeat(17)]) {
      await expect(w.setLabel(invalid)).rejects.toMatchObject({
        code: AGENTIC_ERROR_CODE.INVALID_RULE,
      });
      await expect(
        owner.agentic.create(invalid, { rules: [] })
      ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.INVALID_RULE });
      await expect(
        h.publicClient.simulateContract({
          address: made.wallet,
          abi: v5.abis.wallet,
          functionName: 'setLabel',
          args: [invalid],
          account: h.wallets[0].account!.address,
        })
      ).rejects.toThrow('LabelTooLong');
    }
    expect(await owner.agentic.derive()).toEqual(next);
    expect(await count(made.wallet)).toBe(before);
    expect((await w.info()).label).toBe('a'.repeat(64));
  });

  it('non-owner and read-only SDK calls cannot rename; actual contract also rejects non-owner', async () => {
    const made = await owner.agentic.create('owner-only', { rules: [] });
    const agent = await h.client(1);
    await expect(
      agent.agentic.wallet(made.wallet).setLabel('attack')
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.NOT_WALLET_OWNER });
    const ro = await h.readOnlyClient(0);
    await expect(
      ro.agentic.wallet(made.wallet).setLabel('attack')
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.READ_ONLY });
    await expect(
      h.publicClient.simulateContract({
        address: made.wallet,
        abi: v5.abis.wallet,
        functionName: 'setLabel',
        args: ['attack'],
        account: h.wallets[1].account!.address,
      })
    ).rejects.toThrow('CallerIsNotOwner');
    expect((await owner.agentic.wallet(made.wallet).info()).label).toBe(
      'owner-only'
    );
    expect(await count(made.wallet)).toBe(BigInt(0));
  });
});
