import { zeroAddress, zeroHash, type Address } from 'viem';
import { MarketNamespaceImpl } from '../market';
import { JobNamespaceImpl } from '../../job/job';
import { mockRuntime } from '../../agentic/__tests__/mock-runtime';
import { FakeChain } from '../../agentic/__tests__/fake-chain';
import type { StackRuntime } from '../runtime';
const owner = '0x1111111111111111111111111111111111111111';
const provider = '0x2222222222222222222222222222222222222222';
function runtime(signer: Address = owner) {
  const base = mockRuntime(new FakeChain(), { signer });
  const read = jest.fn(async (args: { functionName: string }) => {
    switch (args.functionName) {
      case 'getJob':
        return {
          client: owner,
          provider,
          hook: zeroAddress,
          evaluator: provider,
          status: 0,
          expiredAt: 2000000000,
          budget: BigInt(5),
          description: '0x',
        };
      case 'agentCardCount':
        return BigInt(1);
      case 'getAgentCard':
        return {
          card: {
            provider,
            chainNamespace: 'eip155:11155111',
            jobType: zeroHash,
            metadataURI: 'invalid template example',
            metadataHash: zeroHash,
            active: true,
            providerFee: BigInt(5),
          },
          version: BigInt(1),
          verified: false,
          disabled: false,
          rules: '0xdead',
          jobSpecTemplate: '0xdead',
        };
      case 'getAgentRating':
        return BigInt(0);
      case 'cardOfJob':
        return BigInt(0);
      case 'isWallet':
        return false;
      default:
        throw new Error(`unexpected read ${args.functionName}`);
    }
  });
  const rt: StackRuntime = {
    agw: {
      ...base,
      reader: {
        ...base.reader,
        readContract: read,
        getBlockNumber: async () => BigInt(10),
      },
    },
    account: () => owner as Address,
    wallet: () => undefined,
    signTypedData: jest.fn(),
    send: jest.fn(),
  };
  return { rt, read, execute: base.executeMock };
}
it('a provider’s malformed unverified template cannot break registry summary enumeration', async () => {
  const { rt } = runtime();
  const market = new MarketNamespaceImpl(rt);
  expect((await market.cards()).cards[0]).toMatchObject({
    provider,
    cardId: BigInt(1),
    verified: false,
  });
  await expect(market.card(BigInt(1))).rejects.toMatchObject({
    code: 'INVALID_AGENT_CARD_RULES',
  });
});
it('lets a provider deactivate a malformed card without decoding its broken template', async () => {
  const { rt, execute } = runtime(provider);
  await new MarketNamespaceImpl(rt).agent.setActive(BigInt(1), false);
  expect(execute).toHaveBeenCalledTimes(1);
});
it('delivers the correct terminal family to the per-call hook once when waiting repeatedly', async () => {
  const { rt } = runtime(provider);
  const events: string[] = [];
  const tx = await new JobNamespaceImpl(rt).setBudget(BigInt(1), BigInt(5), {
    progressHook: (e) => events.push(e.id),
  });
  await tx.wait();
  await tx.wait();
  expect(events.filter((id) => id === 'JOB-TX-199-01')).toHaveLength(1);
  expect(events).not.toContain('MARKET-TX-199-01');
});
it('plain jobs require an explicitly reviewed budget rather than silently adopting a re-quote', async () => {
  const { rt, execute } = runtime();
  const job = new JobNamespaceImpl(rt);
  await expect(job.fund(BigInt(1))).rejects.toMatchObject({
    code: 'EXPECTED_BUDGET_REQUIRED',
  });
  await expect(
    job.fund(BigInt(1), { expectedBudget: BigInt(4) })
  ).rejects.toMatchObject({ code: 'BUDGET_MISMATCH' });
  expect(execute).not.toHaveBeenCalled();
});
it('placeholder methods and replacement proposals fail before any reads or signatures', async () => {
  const { rt, read } = runtime();
  const job = new JobNamespaceImpl(rt);
  const market = new MarketNamespaceImpl(rt);
  await expect(job.verify(BigInt(1))).rejects.toMatchObject({
    code: 'CAPABILITY_UNAVAILABLE',
  });
  await expect(
    job.setBudget(BigInt(1), BigInt(5), { jobSpec: '0x00' })
  ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
  await expect(market.deposit(BigInt(1))).rejects.toMatchObject({
    code: 'CAPABILITY_UNAVAILABLE',
  });
  expect(read).not.toHaveBeenCalled();
  expect(rt.signTypedData).not.toHaveBeenCalled();
});
