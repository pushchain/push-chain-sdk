/** Unfunded deployment acceptance. No keys, signatures or transaction broadcasts. */
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { createPublicClient, http } from 'viem';
import { DONUT_MARKETPLACE as D } from '../../src/lib/market/deployment';
import { MARKETPLACE_ABI } from '../../src/lib/market/contracts/UniversalMarketplace';
import { JOB_KERNEL_ABI } from '../../src/lib/market/contracts/AgenticCommerce';
describe('marketplace deployed v2 read-only', () => {
  let sdk: PushChain;
  beforeAll(async () => {
    sdk = await PushChain.initialize(
      {
        chain: CHAIN.PUSH_TESTNET_DONUT,
        address: '0x1111111111111111111111111111111111111111',
      },
      { network: PUSH_NETWORK.TESTNET_DONUT }
    );
  });
  it('enumerates registry and jobs through public SDK bindings and confirms the deployment/token', async () => {
    const rpc = createPublicClient({
      transport: http('https://evm.donut.rpc.push.org/'),
    });
    const [cards, jobs, version, count, token] = await Promise.all([
      sdk.market.cards(),
      sdk.job.list(),
      rpc.readContract({
        address: D.marketplace,
        abi: MARKETPLACE_ABI,
        functionName: 'version',
      }),
      rpc.readContract({
        address: D.marketplace,
        abi: MARKETPLACE_ABI,
        functionName: 'agentCardCount',
      }),
      rpc.readContract({
        address: D.kernel,
        abi: JOB_KERNEL_ABI,
        functionName: 'paymentToken',
      }),
    ]);
    expect(version).toBe('2.0.0');
    expect(token.toLowerCase()).toBe(D.paymentToken.toLowerCase());
    expect(BigInt(cards.cards.length)).toBe(count);
    expect(Array.isArray(jobs.jobs)).toBe(true);
  });
  it('returns explicit placeholders for unavailable verification and deposit orchestration', async () => {
    await expect(sdk.job.verify(BigInt(1))).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
    });
    await expect(sdk.market.deposit(BigInt(1))).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
    });
  });
});
