/** Opt-in funded Donut smoke. Only PC gas/fresh provider funding moves; principal and escrow stay zero. */
import { encodeFunctionData, parseAbi, parseEther, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
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
  let externalOwner: PushChain | undefined;
  let externalOpened: { jobId: bigint; wallet: Address } | undefined;
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
    owner = await evmClient(
      ownerKey,
      CHAIN.PUSH_TESTNET_DONUT,
      f.manifest.network
    );
    await f.fundPC(owner.universal.account as Address, parseEther('0.1'));
  }, 300000);
  afterAll(async () => {
    // Best-effort cleanup after failures, restricted to this run's own fresh card and wallet.
    if (opened && (await owner.job.status(opened.jobId)).status === 'Open')
      await (await owner.job.cancel(opened.jobId)).wait();
    if (
      externalOwner &&
      externalOpened &&
      (await externalOwner.job.status(externalOpened.jobId)).status === 'Open'
    )
      await (await externalOwner.job.cancel(externalOpened.jobId)).wait();
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
  it('2. paid JobSpec preview reaches live validator consensus through the registry', async () => {
    const spec = PushChain.utils.job.buildJobSpec({
      reads: [
        PushChain.utils.job.prepareRead({
          chain: CHAIN.BNB_TESTNET,
          target: PushChain.CONSTANTS.MOVEABLE.TOKEN.BNB_TESTNET.USDT
            .address as Address,
          abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
          functionName: 'balanceOf',
          args: [owner.universal.account],
        }),
      ],
      checks: [
        {
          read: 0,
          evaluation: 'COMPARE',
          operation: 'GREATER_OR_EQUAL',
          target: BigInt(0),
        },
      ],
      logic: 'ALL',
      executeBy: Math.floor(Date.now() / 1000) + 600,
      failFinalAt: Math.floor(Date.now() / 1000) + 660,
    });
    const result = await PushChain.utils.job.previewJobSpec(spec, {
      client: owner,
      maxTotalFee: parseEther('0.01'),
      advanced: { timeout: 120000, pollingIntervalMs: 1000 },
    });
    f.evidence('marketplace-paid-preview', {
      pass: result.pass,
      fees: result.fees,
      reads: result.reads.map((r) => ({
        decoded: r.decoded,
        error: r.error,
        requestId: r.response.requestId,
        txHash: r.response.txHash,
        outcome: r.response.outcome,
      })),
    });
    expect(result.pass).toBe(true);
    expect(result.reads[0].decoded).not.toBeNull();
  });
  it('3. external EVM owner opens and cancels through its real Push UEA transport', async () => {
    if (!cardId) throw new Error('The fresh test card was not registered');
    const key = generatePrivateKey();
    externalOwner = await evmClient(
      key,
      CHAIN.ETHEREUM_SEPOLIA,
      f.manifest.network
    );
    const uea = externalOwner.universal.account as Address;
    const deployed = await owner.universal.sendTransaction({
      to: '0x00000000000000000000000000000000000000eA',
      data: encodeFunctionData({
        abi: parseAbi([
          'function deployUEA((string chainNamespace,string chainId,bytes owner) id) returns (address)',
        ]),
        functionName: 'deployUEA',
        args: [
          {
            chainNamespace: 'eip155',
            chainId: '11155111',
            owner: privateKeyToAccount(key).address,
          },
        ],
      }),
    });
    await deployed.wait();
    await f.fundPC(uea, parseEther('0.1'));
    await (await provider.market.agent.setActive(cardId, true)).wait();
    const now = Number((await f.push.getBlock()).timestamp);
    const plan = await externalOwner.market.preview(cardId, {
      principal: BigInt(1),
      executeBy: now + 600,
      expiredAt: now + 7200,
    });
    externalOpened = await externalOwner.market.openJob(plan);
    f.evidence('marketplace-external-open', {
      jobId: externalOpened.jobId,
      wallet: externalOpened.wallet,
      uea,
      signerChainId: plan.intent.signerChainId,
    });
    await (await externalOwner.job.cancel(externalOpened.jobId)).wait();
    expect((await externalOwner.job.status(externalOpened.jobId)).status).toBe(
      'Rejected'
    );
    await (await provider.market.agent.setActive(cardId, false)).wait();
    f.evidence('marketplace-external-cleanup', {
      jobId: externalOpened.jobId,
      cardId,
    });
  });
});
