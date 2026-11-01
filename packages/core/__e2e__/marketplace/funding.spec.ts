/** Opt-in acceptance with bounded tokens owned by the configured test master. No public impersonation. */
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  parseAbi,
  parseEther,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from 'viem';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { PushChain } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { JOB_KERNEL_ABI } from '../../src/lib/market/contracts/AgenticCommerce';
import { DONUT_MARKETPLACE as D } from '../../src/lib/market/deployment';
import { setupAgw, evmClient, type AgwFixture } from '../agw/_fixture';
const d =
  process.env['MARKETPLACE_FUNDING_E2E'] === '1' ? describe : describe.skip;
const principalToken = '0x731aF1Da5365259d27528557EE4aFBA4baC90ef2' as Address;
const budget = BigInt(10000); // 0.01 eUSD per paid job, returned to the master after payout.
d('marketplace funding', () => {
  let f: AgwFixture;
  let owner: PushChain;
  let provider: PushChain;
  let evaluator: PushChain;
  let ownerKey: Hex;
  let cardId: bigint;
  const additionalOwners: PushChain[] = [];
  const recoveryPath = join(
    process.cwd(),
    'node_modules/.cache',
    `marketplace-recovery-${Date.now()}.json`
  );
  const recovery: Record<string, string> = {};
  const saveKey = (name: string, key: Hex) => {
    recovery[name] = key;
    mkdirSync(join(process.cwd(), 'node_modules/.cache'), { recursive: true });
    writeFileSync(recoveryPath, JSON.stringify(recovery), { mode: 0o600 });
  };
  const wallets: { key: Hex; origin: CHAIN; wallet: Address }[] = [];
  const jobs: { jobId: bigint; market: boolean; client: PushChain }[] = [];
  const sendToken = async (
    client: PushChain,
    token: Address,
    to: Address,
    amount: bigint
  ) => {
    const tx = await client.universal.sendTransaction({
      to: token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [to, amount],
      }),
    });
    await tx.wait();
    return tx;
  };
  const balance = (token: Address, account: Address) =>
    f.push.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    });
  const complete = async (jobId: bigint) => {
    const tx = await evaluator.universal.sendTransaction({
      to: D.kernel,
      data: encodeFunctionData({
        abi: JOB_KERNEL_ABI,
        functionName: 'complete',
        args: [jobId, zeroHash, '0x'],
      }),
    });
    await tx.wait();
    return tx;
  };
  beforeAll(async () => {
    f = await setupAgw({ deferAgentFunding: true });
    if (
      (await balance(principalToken, f.ownerAddress)) < BigInt(1) ||
      (await balance(D.paymentToken, f.ownerAddress)) < budget * BigInt(4)
    )
      throw new Error(
        'Configured Push master needs 1 pUSDT.bnb unit and 0.04 eUSD for this bounded acceptance'
      );
    await f.fundAgent();
    ownerKey = generatePrivateKey();
    saveKey('owner', ownerKey);
    saveKey('provider', f.agentKey);
    owner = await evmClient(
      ownerKey,
      CHAIN.PUSH_TESTNET_DONUT,
      f.manifest.network
    );
    provider = await evmClient(
      f.agentKey,
      CHAIN.PUSH_TESTNET_DONUT,
      f.manifest.network
    );
    const evaluatorKey = generatePrivateKey();
    saveKey('evaluator', evaluatorKey);
    evaluator = await evmClient(
      evaluatorKey,
      CHAIN.PUSH_TESTNET_DONUT,
      f.manifest.network
    );
    await f.fundPC(owner.universal.account as Address, parseEther('0.3'));
    await f.fundPC(evaluator.universal.account as Address, parseEther('0.1'));
    const token = PushChain.CONSTANTS.MOVEABLE.TOKEN.BNB_TESTNET.USDT
      .address as Address;
    const template = PushChain.utils.job.prePost.buildJobSpecTemplate({
      reads: [
        PushChain.utils.job.prepareRead({
          chain: CHAIN.BNB_TESTNET,

          target: token,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: ['agentic:wallet'],
        }),
      ],
      checks: [
        {
          left: [0],
          right: [],
          evaluation: 'COMPARE',
          operation: 'GREATER_OR_EQUAL',
          target: BigInt(0),
        },
      ],
      logic: 'ALL',
    });
    // Measure a real pre/post delta; this case validates evaluator plumbing,
    // rather than claiming an agent strategy executed on the destination.
    template.reads = [
      { ...template.reads[0], at: 'PRE_EXECUTION' },
      { ...template.reads[0], at: 'POST_EXECUTION' },
    ];
    template.checks = [
      {
        left: [1],
        right: [0],
        evaluation: 'NUMBER',
        operation: 'GREATER_OR_EQUAL',
        target: BigInt(0),
      },
    ];
    const registered = await provider.market.agent.register(
      {
        jobType: 'SDK_FUNDING_ACCEPTANCE',
        metadataURI: 'https://example.invalid/sdk-funding-acceptance',
        metadataHash: ('0x' + '56'.repeat(32)) as Hex,

        providerFee: budget,
        paymentToken: D.paymentToken,

        minDuration: 3600,
        maxDuration: 86400,
      },
      {
        rules: [
          {
            chain: CHAIN.BNB_TESTNET,
            assets: [
              {
                token: { prc20: principalToken },
                maxPerCall: 'agentic:principal',
                maxTotal: 'agentic:principal',
              },
            ],

            maxGasPerCall: BigInt(0),
            allowedCalls: [
              {
                target: token,
                selector: 'balanceOf(address)',
                pins: [{ arg: 0, expected: 'agentic:wallet' }],
              },
            ],
          },
        ],
        jobSpecTemplate: template,
      }
    );
    cardId = registered.cardId;
    f.evidence('marketplace-funding-register', {
      cardId,
      txHash: registered.tx.hash,
    });
  }, 300000);
  afterAll(async () => {
    try {
      for (const j of jobs) {
        let status = (await j.client.job.status(j.jobId)).status;
        if (status === 'Open')
          await (await j.client.job.cancel(j.jobId)).wait();
        if (!j.market && status === 'Funded') {
          await (
            await provider.job.submit(j.jobId, {
              deliverable: 'SDK acceptance cleanup',
            })
          ).wait();
          status = 'Submitted';
        }
        if (!j.market && status === 'Submitted') await complete(j.jobId);
      }
      for (const w of wallets) {
        const client = await evmClient(
          w.key,
          w.origin,
          f.manifest.network,
          w.wallet
        );
        for (const token of [principalToken, D.paymentToken]) {
          const held = await balance(token, w.wallet);
          if (held) await sendToken(client, token, f.ownerAddress, held);
        }
      }
      for (const client of [provider, evaluator, owner, ...additionalOwners]) {
        if (!client) continue;
        const held = await balance(
          D.paymentToken,
          client.universal.account as Address
        );
        if (held) await sendToken(client, D.paymentToken, f.ownerAddress, held);
      }
      if (cardId && (await provider.market.card(cardId)).active)
        await (await provider.market.agent.setActive(cardId, false)).wait();
      f?.evidence('marketplace-funding-cleanup', {
        cardId,
        jobs: await Promise.all(
          jobs.map(async (j) => ({
            jobId: j.jobId,
            status: (await j.client.job.status(j.jobId)).status,
          }))
        ),
      });
    } finally {
      f?.teardown();
    }
  }, 300000);
  it('1. deposits real principal and fee, cancels the market job, then pays an AGW plain job through a controlled manual evaluator', async () => {
    await sendToken(
      f.owner,
      principalToken,
      owner.universal.account as Address,
      BigInt(1)
    );
    await sendToken(
      f.owner,
      D.paymentToken,
      owner.universal.account as Address,
      budget
    );
    const now = Number((await f.push.getBlock()).timestamp);
    const plan = await owner.market.preview(cardId, {
      principal: BigInt(1),

      expiredAt: now + 7200,
    });
    const opened = await owner.market.openJob(plan);
    jobs.push({ jobId: opened.jobId, market: true, client: owner });
    wallets.push({
      key: ownerKey,
      origin: CHAIN.PUSH_TESTNET_DONUT,
      wallet: opened.wallet,
    });
    const deposited = await owner.market.deposit(opened.jobId, {
      pcAmount: parseEther('0.001'),
    });
    expect(await balance(principalToken, opened.wallet)).toBe(BigInt(1));
    expect(await balance(D.paymentToken, opened.wallet)).toBe(budget);
    const recovered = await owner.market.openJob(plan, { resume: opened.tx });
    expect(recovered.jobId).toBe(opened.jobId);
    await (await owner.job.cancel(opened.jobId)).wait();
    const client = await evmClient(
      ownerKey,
      CHAIN.PUSH_TESTNET_DONUT,
      f.manifest.network,
      opened.wallet
    );
    const plain = await client.job.create({
      provider: provider.universal.account as Address,
      evaluator: evaluator.universal.account as Address,
      hook: zeroAddress,
      expiredAt: now + 7200,
      paymentToken: D.paymentToken,
      description: 'SDK live escrow and manual evaluator acceptance',
    });
    jobs.push({ jobId: plain.jobId, market: false, client });
    await (await provider.job.setBudget(plain.jobId, budget)).wait();
    const before = await balance(
      D.paymentToken,
      provider.universal.account as Address
    );
    const funded = await client.job.fund(plain.jobId, {
      expectedBudget: budget,
    });
    await funded.wait();
    expect((await client.job.status(plain.jobId)).status).toBe('Funded');
    expect(await balance(D.paymentToken, opened.wallet)).toBe(BigInt(0));
    await (
      await provider.job.submit(plain.jobId, {
        deliverable: 'SDK live manual evaluator proof',
      })
    ).wait();
    const completed = await complete(plain.jobId);
    expect((await client.job.status(plain.jobId)).status).toBe('Completed');
    expect(
      await balance(D.paymentToken, provider.universal.account as Address)
    ).toBeGreaterThan(before);
    f.evidence('marketplace-funding-agw-paid', {
      cardId,
      marketJobId: opened.jobId,
      plainJobId: plain.jobId,
      wallet: opened.wallet,
      depositHashes: deposited.txs.map((t) => t.tx.hash),
      fundingHash: funded.hash,
      completionHash: completed.hash,
      budget,
    });
  }, 600000);
  it('2. funds a native plain job with an atomic token approval and pays out on live Donut', async () => {
    await sendToken(
      f.owner,
      D.paymentToken,
      owner.universal.account as Address,
      budget
    );
    const now = Number((await f.push.getBlock()).timestamp);
    const created = await owner.job.create({
      provider: provider.universal.account as Address,
      evaluator: evaluator.universal.account as Address,
      hook: zeroAddress,
      expiredAt: now + 7200,
      paymentToken: D.paymentToken,
      description: 'SDK live native escrow acceptance',
    });
    jobs.push({ jobId: created.jobId, market: false, client: owner });
    await (await provider.job.setBudget(created.jobId, budget)).wait();
    const funded = await owner.job.fund(created.jobId, {
      expectedBudget: budget,
    });
    await funded.wait();
    expect(funded.atomic).toBe(true);
    expect((await owner.job.status(created.jobId)).status).toBe('Funded');
    await (
      await provider.job.submit(created.jobId, {
        deliverable: 'SDK native acceptance',
      })
    ).wait();
    const completed = await complete(created.jobId);
    expect((await owner.job.status(created.jobId)).status).toBe('Completed');
    f.evidence('marketplace-funding-native-paid', {
      jobId: created.jobId,
      fundingHash: funded.hash,
      completionHash: completed.hash,
      budget,
    });
  }, 600000);
  it('3. bridges principal from a fresh BSC origin into the opened wallet and recovers its funds after cancellation', async () => {
    const sourceKey = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!sourceKey)
      throw new Error('EVM_PRIVATE_KEY is required for owned BSC test funding');
    const info = CHAIN_INFO[CHAIN.BNB_TESTNET];
    const bsc = createPublicClient({ transport: http(info.defaultRPC[0]) });
    const master = createWalletClient({
      account: privateKeyToAccount(sourceKey),
      transport: http(info.defaultRPC[0]),
    });
    if (
      (await bsc.getBalance({ address: master.account.address })) <
      parseEther('0.01')
    ) {
      const gas = await f.owner.universal.sendTransaction({
        to: { address: master.account.address, chain: CHAIN.BNB_TESTNET },
        value: parseEther('0.01'),
      });
      await gas.wait();
      f.evidence('marketplace-funding-bsc-gas', {
        txHash: gas.hash,
        amount: parseEther('0.01'),
      });
    }
    const key = generatePrivateKey();
    saveKey('externalOwner', key);
    const address = privateKeyToAccount(key).address;
    const gasHash = await master.sendTransaction({
      to: address,
      value: parseEther('0.005'),
      chain: null,
    });
    await bsc.waitForTransactionReceipt({ hash: gasHash });
    const tokenHash = await master.writeContract({
      address: PushChain.CONSTANTS.MOVEABLE.TOKEN.BNB_TESTNET.USDT
        .address as Address,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [address, BigInt(10000)],
      chain: null,
    });
    await bsc.waitForTransactionReceipt({ hash: tokenHash });
    const external = await evmClient(
      key,
      CHAIN.BNB_TESTNET,
      f.manifest.network
    );
    const uea = external.universal.account as Address;
    const deploy = await f.owner.universal.sendTransaction({
      to: '0x00000000000000000000000000000000000000eA',
      data: encodeFunctionData({
        abi: parseAbi([
          'function deployUEA((string chainNamespace,string chainId,bytes owner) id) returns (address)',
        ]),
        functionName: 'deployUEA',
        args: [{ chainNamespace: 'eip155', chainId: '97', owner: address }],
      }),
    });
    await deploy.wait();
    await f.fundPC(uea, parseEther('0.2'));
    const now = Number((await f.push.getBlock()).timestamp);
    const plan = await external.market.preview(cardId, {
      principal: BigInt(10000),

      expiredAt: now + 7200,
    });
    const opened = await external.market.openJob(plan);
    jobs.push({ jobId: opened.jobId, market: true, client: external });
    wallets.push({ key, origin: CHAIN.BNB_TESTNET, wallet: opened.wallet });
    await sendToken(f.owner, D.paymentToken, opened.wallet, budget);
    const deposited = await external.market.deposit(opened.jobId, {
      funding: 'origin',
      pcAmount: BigInt(0),
    });
    expect(await balance(principalToken, opened.wallet)).toBe(BigInt(10000));
    expect(deposited.txs.map((t) => t.step)).toEqual(['PRINCIPAL']);
    await (await external.job.cancel(opened.jobId)).wait();
    f.evidence('marketplace-funding-origin', {
      cardId,
      jobId: opened.jobId,
      wallet: opened.wallet,
      uea,
      depositHashes: deposited.txs.map((t) => t.tx.hash),
      principal: BigInt(10000),
      origin: CHAIN.BNB_TESTNET,
    });
  }, 900000);
  it('4. funds a marketplace job and receives a live UniversalEvaluator verdict and payout', async () => {
    // Native atomic funding above delegates its EOA with EIP-7702. Keep this
    // OwnerIntent case independent of that account's contract signature policy.
    const ownerKey = generatePrivateKey();
    saveKey('automaticOwner', ownerKey);
    const owner = await evmClient(
      ownerKey,
      CHAIN.PUSH_TESTNET_DONUT,
      f.manifest.network
    );
    additionalOwners.push(owner);
    await f.fundPC(owner.universal.account as Address, parseEther('0.1'));

    await sendToken(
      f.owner,
      principalToken,
      owner.universal.account as Address,
      BigInt(1)
    );
    await sendToken(
      f.owner,
      D.paymentToken,
      owner.universal.account as Address,
      budget
    );
    const now = Number((await f.push.getBlock()).timestamp);
    const plan = await owner.market.preview(cardId, {
      principal: BigInt(1),
      expiredAt: now + 7200,
    });
    const opened = await owner.market.openJob(plan);
    jobs.push({ jobId: opened.jobId, market: true, client: owner });
    wallets.push({
      key: ownerKey,
      origin: CHAIN.PUSH_TESTNET_DONUT,
      wallet: opened.wallet,
    });
    f.evidence('marketplace-automatic-open', {
      jobId: opened.jobId,
      wallet: opened.wallet,
      txHash: opened.tx.hash,
      recoveryPath,
    });
    await owner.market.deposit(opened.jobId, { pcAmount: parseEther('0.03') });
    await (await provider.job.setBudget(opened.jobId, budget)).wait();
    const quote = await owner.job.quoteEvaluation(opened.jobId);
    const before = await balance(
      D.paymentToken,
      provider.universal.account as Address
    );
    const funded = await owner.job.fund(opened.jobId, {
      expectedBudget: budget,
      evaluation: {
        expectedSpecHash: quote.specHash,
        maxReadFee: parseEther('0.02'),
        prefundAmount: quote.topUp + parseEther('0.001'),
      },
    });
    await funded.wait();
    f.evidence('marketplace-automatic-funded', {
      jobId: opened.jobId,
      txHash: funded.hash,
      quote,
    });
    let snapshotStatus = await owner.job.status(opened.jobId);
    const snapshotDeadline = Date.now() + 150000;
    while (
      snapshotStatus.evaluation.available &&
      !snapshotStatus.evaluation.ready &&
      Date.now() < snapshotDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      snapshotStatus = await owner.job.status(opened.jobId);
    }
    expect(snapshotStatus.evaluation).toMatchObject({
      available: true,
      ready: true,
    });
    f.evidence('marketplace-automatic-snapshot', {
      jobId: opened.jobId,
      evaluation: snapshotStatus.evaluation,
    });
    const submitted = await provider.job.submit(opened.jobId, {
      deliverable:
        'SDK live evaluator plumbing: observed POST minus PRE balance >= 0',
    });
    await submitted.wait();
    let status = await owner.job.status(opened.jobId);
    if (
      status.evaluation.available &&
      !status.evaluation.started &&
      status.status === 'Submitted'
    )
      await (await provider.job.verify(opened.jobId)).wait();
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      status = await owner.job.status(opened.jobId);
      if (status.status === 'Completed' || status.status === 'Rejected') break;
      if (
        status.evaluation.available &&
        status.evaluation.done &&
        !status.evaluation.applied
      )
        await (
          await owner.job.verify(opened.jobId, { action: 'settle' })
        ).wait();
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    f.evidence('marketplace-automatic-verdict', {
      jobId: opened.jobId,
      status: status.status,
      evaluation: status.evaluation,
      submittedHash: submitted.hash,
    });
    expect(status.status).toBe('Completed');
    expect(status.evaluation).toMatchObject({
      available: true,
      verdict: 'PASS',
      applied: true,
    });
    expect(
      await balance(D.paymentToken, provider.universal.account as Address)
    ).toBeGreaterThan(before);
    await (await owner.job.claimReadFees(opened.jobId)).wait();
    await (
      await owner.agentic.wallet(opened.wallet).rules.delete(opened.rulesIds)
    ).wait();
  }, 600000);
});
