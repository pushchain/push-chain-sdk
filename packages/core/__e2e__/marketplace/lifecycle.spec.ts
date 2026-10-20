/** Opt-in funded Donut smoke. Only PC gas/fresh provider funding moves; principal and escrow stay zero. */
import { parseAbi, parseEther, type Address } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { PushChain } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';
import { setupAgw, evmClient, type AgwFixture } from '../agw/_fixture';
import { DONUT_MARKETPLACE as D } from '../../src/lib/market/deployment';
const d =
  process.env['MARKETPLACE_LIVE_E2E'] === '1' ? describe : describe.skip;
d('marketplace live', () => {
  let f: AgwFixture;
  let provider: PushChain;
  let owner: PushChain;
  let cardId: bigint | undefined;
  let opened:
    | { jobId: bigint; wallet: Address; rulesId: `0x${string}` }
    | undefined;
  beforeAll(async () => {
    f = await setupAgw();
    provider = await evmClient(
      f.agentKey,
      CHAIN.PUSH_TESTNET_DONUT,
      f.manifest.network
    );
    const ownerKey = generatePrivateKey();
    owner = await evmClient(ownerKey, CHAIN.PUSH_TESTNET_DONUT, f.manifest.network);
    await f.fundPC(owner.universal.account as Address, parseEther('0.1'));
  }, 300000);
  afterAll(async () => {
    // Best-effort cleanup after failures, restricted to this run's own fresh card and wallet.
    if (opened && (await owner.job.status(opened.jobId)).status === 'Open')
      await (await owner.job.cancel(opened.jobId)).wait();
    if (cardId && (await provider.market.card(cardId)).active)
      await (await provider.market.agent.setActive(cardId, false)).wait();
    f?.teardown();
  });
  it('1. native provider registration, reviewed open and atomic cancel/revoke on BSC Testnet', async () => {
    const target = PushChain.CONSTANTS.MOVEABLE.TOKEN.BNB_TESTNET.USDT
      .address as Address;
    const read = PushChain.utils.job.prepareRead({
      chain: CHAIN.BNB_TESTNET,
      target,
      abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
      functionName: 'balanceOf',
      args: [PushChain.CONSTANTS.AGENTIC.WALLET],
    });
    const template = PushChain.utils.job.buildJobSpecTemplate({
      reads: [read],
      checks: [
        {
          read: 0,
          evaluation: 'COMPARE',
          operation: 'GREATER_OR_EQUAL',
          target: BigInt(0),
        },
      ],
      logic: 'ALL',
    });
    const registered = await provider.market.agent.register(
      {
        jobType: 'SDK_MARKETPLACE_SMOKE',
        metadataURI: 'https://example.invalid/push-sdk-test',
        metadataHash: ('0x' + '34'.repeat(32)) as `0x${string}`,
        chain: CHAIN.BNB_TESTNET,
        providerFee: BigInt(0),
        paymentToken: D.paymentToken,
        principalMin: BigInt(1),
        principalMax: BigInt(1),
        minDuration: 3600,
        maxDuration: 86400,
        minExecuteWindow: 0,
        settleWindow: 60,
      },
      {
        rules: {
          assets: [
            {
              token: { prc20: '0x731aF1Da5365259d27528557EE4aFBA4baC90ef2' },
              maxPerCall: PushChain.CONSTANTS.AGENTIC.PRINCIPAL,
              maxTotal: PushChain.CONSTANTS.AGENTIC.PRINCIPAL,
            },
          ],
          principalAsset: 0,
          maxGasPerCall: BigInt(0),
          allowedCalls: [
            {
              target,
              selector: 'balanceOf(address)',
              pins: [{ arg: 0, expected: PushChain.CONSTANTS.AGENTIC.WALLET }],
            },
          ],
        },
        jobSpecTemplate: template,
      }
    );
    cardId = registered.cardId;
    f.evidence('marketplace-register', { cardId, txHash: registered.tx.hash });
    const now = Number((await f.push.getBlock()).timestamp);
    const plan = await owner.market.preview(cardId, {
      principal: BigInt(1),
      executeBy: now + 600,
      expiredAt: now + 7200,
      label: 'marketplace-e2e',
    });
    const result = await owner.market.openJob(plan);
    opened = result;
    f.evidence('marketplace-open', {
      jobId: result.jobId,
      wallet: result.wallet,
      rulesId: result.rulesId,
      txHash: result.tx.hash,
    });
    const status = await owner.job.status(opened.jobId);
    expect(status.status).toBe('Open');
    expect(status.description).toBe(plan.jobSpec.bytes);
    const cancelled = await owner.job.cancel(opened.jobId);
    await cancelled.wait();
    expect((await owner.job.status(opened.jobId)).status).toBe('Rejected');
    await expect(
      owner.agentic.wallet(opened.wallet).rules.get(opened.rulesId)
    ).rejects.toMatchObject({ code: 'RULE_NOT_FOUND' });
    await (await provider.market.agent.setActive(cardId, false)).wait();
    expect((await provider.market.card(cardId)).active).toBe(false);
    f.evidence('marketplace-cancel-cleanup', {
      cardId,
      wallet: opened.wallet,
      jobId: opened.jobId,
      txHash: cancelled.hash,
    });
  });
});
