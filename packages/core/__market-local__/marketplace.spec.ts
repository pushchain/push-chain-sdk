/** Public SDK → real deployed v2/AGW v6 on an isolated Anvil Donut fork. No keys or writes to public RPC. */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  keccak256,
  http,
  parseAbi,
  stringToHex,
  zeroAddress,
  zeroHash,
  type Address,
  type PublicClient,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { PushChain } from '../src';
import { CHAIN, PUSH_NETWORK, LIBRARY } from '../src/lib/constants/enums';
import { DONUT_MARKETPLACE as D } from '../src/lib/market/deployment';
import { JOB_KERNEL_ABI } from '../src/lib/market/contracts/AgenticCommerce';
import { currentGeneration } from '../src/lib/agentic/deployments';
import type { AgentCardRules } from '../src/lib/market/rules';
import type { JobSpecTemplate } from '../src/lib/job-spec/types';
import { MarketNamespaceImpl } from '../src/lib/market/market';
import type { StackRuntime } from '../src/lib/market/runtime';
import type { AgenticRuntime } from '../src/lib/agentic/runtime';

let node: ChildProcess;
let rpc: string;
let push: PublicClient;
let owner: PushChain;
let provider: PushChain;
let cardId: bigint;
let opened: { jobId: bigint; wallet: Address; rulesId: `0x${string}` };
let template: JobSpecTemplate;
let rules: AgentCardRules;
let stopWatch: (() => void) | undefined;
const accounts = [0, 1].map((addressIndex) =>
  mnemonicToAccount(
    'test test test test test test test test test test test junk',
    { addressIndex }
  )
);
const token = '0x731aF1Da5365259d27528557EE4aFBA4baC90ef2';
const tokenOnSepolia = '0xE935d9c9C24D02E61186c640cc01d713C876d40F';
beforeAll(async () => {
  const port = await new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const p = (server.address() as { port: number }).port;
      server.close(() => resolve(p));
    });
  });
  rpc = `http://127.0.0.1:${port}`;
  node = spawn(
    'anvil',
    [
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--chain-id',
      '42101',
      '--fork-url',
      process.env['MARKET_FORK_RPC'] ?? 'https://evm.donut.rpc.push.org/',
      '--fork-block-number',
      '24447347',
      '--timeout',
      '120000',
      '--retries',
      '2',
      '--silent',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  let logs = '';
  node.stderr?.on('data', (c) => {
    logs += String(c);
  });
  const chain = defineChain({
    id: 42101,
    name: 'Local marketplace fork',
    nativeCurrency: { name: 'PC', symbol: 'PC', decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  push = createPublicClient({
    chain,
    transport: http(rpc, { timeout: 120000, retryCount: 0 }),
    pollingInterval: 25,
  }) as PublicClient;
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (node.exitCode !== null) throw new Error(`Anvil stopped: ${logs}`);
    try {
      await push.getBlockNumber();
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!ready) throw new Error(`Anvil did not start: ${logs}`);
  await push.request({
    method: 'evm_setNextBlockTimestamp' as never,
    params: [Math.floor(Date.now() / 1000)] as never,
  });
  const clients = await Promise.all(
    accounts.map(async (account) => {
      const wallet = createWalletClient({
        account,
        chain,
        transport: http(rpc, { timeout: 120000 }),
        pollingInterval: 25,
      });
      const signer = await PushChain.utils.signer.toUniversalFromKeypair(
        wallet,
        { chain: CHAIN.PUSH_TESTNET_DONUT, library: LIBRARY.ETHEREUM_VIEM }
      );
      return PushChain.initialize(signer, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        rpcUrls: { [CHAIN.PUSH_TESTNET_DONUT]: [rpc] },
      });
    })
  );
  [owner, provider] = clients;
  const read = PushChain.utils.job.prepareRead({
    chain: CHAIN.BNB_TESTNET,
    target: tokenOnSepolia,
    abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
    functionName: 'balanceOf',
    args: ['agentic:wallet'],
  });
  template = PushChain.utils.job.buildJobSpecTemplate({
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
  rules = {
    assets: [
      {
        token: { prc20: token },
        maxPerCall: PushChain.CONSTANTS.AGENTIC.PRINCIPAL,
        maxTotal: PushChain.CONSTANTS.AGENTIC.PRINCIPAL,
      },
    ],
    principalAsset: 0,
    maxGasPerCall: BigInt(0),
    allowedCalls: [
      {
        target: tokenOnSepolia,
        selector: 'balanceOf(address)',
        pins: [{ arg: 0, expected: PushChain.CONSTANTS.AGENTIC.WALLET }],
      },
    ],
  };
}, 180000);
afterAll(async () => {
  stopWatch?.();
  node?.kill('SIGTERM');
});

it('registers and discovers a real v2 provider card through the public namespace', async () => {
  const response = await provider.market.agent.register(
    {
      jobType: 'SDK_FORK_TEST',
      metadataURI: 'https://example.invalid/sdk-marketplace-test',
      metadataHash: ('0x' + '12'.repeat(32)) as `0x${string}`,
      chain: CHAIN.BNB_TESTNET,
      providerFee: BigInt(5000000),
      paymentToken: D.paymentToken,
      principalMin: BigInt(1),
      principalMax: BigInt(100),
      minDuration: 3600,
      maxDuration: 90 * 86400,
      minExecuteWindow: 0,
      settleWindow: 60,
    },
    { rules, jobSpecTemplate: template }
  );
  cardId = response.cardId;
  expect(response.version).toBe(BigInt(1));
  expect(cardId).toBeGreaterThan(BigInt(0));
  const card = await owner.market.card(cardId);
  expect(card.provider).toBe(accounts[1].address);
  expect(card.jobSpecTemplate.allowedMutability).toBe('NONE');
  expect(
    (await owner.market.cards({ provider: accounts[1].address })).cards[0]
      .cardId
  ).toBe(cardId);
  expect((await provider.market.agent.card())?.cardId).toBe(cardId);
});
it('previews and signs the exact on-chain JobSpec, opens on real AGW v6, and preserves binary bytes', async () => {
  const now = Number((await push.getBlock()).timestamp);
  const plan = await owner.market.preview(cardId, {
    principal: BigInt(10),
    executeBy: now + 600,
    expiredAt: now + 7200,
  });
  const response = await owner.market.openJob(plan);
  opened = response;
  expect((await owner.market.activeJob(opened.wallet)).jobId).toBe(
    opened.jobId
  );
  const status = await owner.job.status(opened.jobId);
  expect(status.description).toBe(plan.jobSpec.bytes);
  expect(status.jobSpec?.spec.origin).toBe(plan.jobSpec.spec.origin);
  expect(status.evaluation.available).toBe(false);
});
it('updates a decoded card without losing rule constraints or template wire bytes', async () => {
  const before = await provider.market.card(cardId);
  const updated = await provider.market.agent.update(
    cardId,
    { ...before, metadataURI: 'https://example.invalid/updated-sdk-test' },
    { rules: before.rules, jobSpecTemplate: before.jobSpecTemplate }
  );
  expect(updated.version).toBe(BigInt(2));
  const after = await owner.market.card(cardId);
  expect(after.rulesBytes).toBe(before.rulesBytes);
  expect(after.jobSpecTemplateBytes).toBe(before.jobSpecTemplateBytes);
  expect(after.verified).toBe(false);
});
it('deposits original principal, fee and PC after a card update and recovers history in a fresh client', async () => {
  await (await provider.job.setBudget(opened.jobId, BigInt(5000000))).wait();
  await expect(
    owner.job.fund(opened.jobId, { expectedBudget: BigInt(5000000) })
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  // These are real existing assets borrowed on localhost, not public-chain transfers.
  const source = '0x0A16CBa65FfCAa4C2282b27b027Ab4A2fE46E0Bf';
  await push.request({
    method: 'anvil_impersonateAccount' as never,
    params: [source] as never,
  });
  const funder = createWalletClient({
    account: source,
    chain: push.chain,
    transport: http(rpc),
  });
  for (const [asset, amount] of [
    [token, BigInt(10)],
    [D.paymentToken, BigInt(5000000)],
  ] as const) {
    const hash = await funder.writeContract({
      chain: push.chain,
      address: asset,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [accounts[0].address, amount],
    });
    await push.waitForTransactionReceipt({ hash });
  }
  const deposited = await owner.market.deposit(opened.jobId, {
    pcAmount: BigInt(10) ** BigInt(15),
  });
  expect(deposited.cardVersion).toBe(BigInt(1));
  expect(deposited.txs.map((t) => t.step)).toEqual([
    'PRINCIPAL',
    'PROVIDER_FEE',
    'PC',
  ]);
  expect((await owner.job.status(opened.jobId)).status).toBe('Open');
  expect(
    await push.readContract({
      address: D.paymentToken,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [opened.wallet, D.kernel],
    })
  ).toBe(BigInt(0));
  const wallet = createWalletClient({
    account: accounts[0],
    chain: push.chain,
    transport: http(rpc),
  });
  const signer = await PushChain.utils.signer.toUniversalFromKeypair(wallet, {
    chain: CHAIN.PUSH_TESTNET_DONUT,
    library: LIBRARY.ETHEREUM_VIEM,
  });
  const reconnected = await PushChain.initialize(signer, {
    network: PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls: { [CHAIN.PUSH_TESTNET_DONUT]: [rpc] },
  });
  const recovered = await reconnected.market.deposit(opened.jobId, {
    pcAmount: BigInt(10) ** BigInt(15),
  });
  expect(recovered.cardVersion).toBe(BigInt(1));
  expect(recovered.txs).toEqual([]);
});
it('funds through the real rules hook and submits as the provider; manual evaluator completes locally', async () => {
  const events: string[] = [];
  stopWatch = owner.job.watch(opened.jobId, (e) => events.push(e.kind), {
    fromBlock: (await push.getBlockNumber({ cacheTime: 0 })) + BigInt(1),
    pollIntervalMs: 25,
  });
  await (await provider.job.setBudget(opened.jobId, BigInt(6000000))).wait();
  await expect(owner.job.fund(opened.jobId)).rejects.toMatchObject({
    code: 'EXPECTED_BUDGET_REQUIRED',
  });
  await expect(
    owner.job.fund(opened.jobId, { expectedBudget: BigInt(5000000) })
  ).rejects.toMatchObject({ code: 'BUDGET_MISMATCH' });
  await (await provider.job.setBudget(opened.jobId, BigInt(5000000))).wait();
  const before = await push.readContract({
    address: D.paymentToken,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [accounts[1].address],
  });
  await (
    await owner.job.fund(opened.jobId, { expectedBudget: BigInt(5000000) })
  ).wait();
  expect((await owner.job.status(opened.jobId)).status).toBe('Funded');
  await (
    await provider.job.submit(opened.jobId, { deliverable: 'fork-only proof' })
  ).wait();
  const submitted = await owner.job.status(opened.jobId);
  expect(submitted.status).toBe('Submitted');
  expect(submitted.deliverable).toBe(keccak256(stringToHex('fork-only proof')));
  await push.request({
    method: 'anvil_impersonateAccount' as never,
    params: [D.evaluator] as never,
  });
  await push.request({
    method: 'anvil_setBalance' as never,
    params: [D.evaluator, '0x8ac7230489e80000'] as never,
  });
  const evaluator = createWalletClient({
    account: D.evaluator,
    chain: push.chain,
    transport: http(rpc),
  });
  const hash = await evaluator.sendTransaction({
    chain: push.chain,
    to: D.kernel,
    data: encodeFunctionData({
      abi: JOB_KERNEL_ABI,
      functionName: 'complete',
      args: [opened.jobId, zeroHash, '0x'],
    }),
  });
  await push.waitForTransactionReceipt({ hash });
  expect((await owner.job.status(opened.jobId)).status).toBe('Completed');
  const after = await push.readContract({
    address: D.paymentToken,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [accounts[1].address],
  });
  expect(after - before).toBe(BigInt(5000000));
  await new Promise((resolve) => setTimeout(resolve, 300));
  stopWatch();
  stopWatch = undefined;
  expect(events).toEqual(
    expect.arrayContaining(['BudgetSet', 'Funded', 'Submitted', 'Completed'])
  );
  expect(events).not.toContain('Error');
  await expect(owner.job.verify(opened.jobId)).rejects.toMatchObject({
    code: 'CAPABILITY_UNAVAILABLE',
  });
});
it('creates a plain job and allows third-party refund while the kernel is paused', async () => {
  const expiredAt = Number((await push.getBlock()).timestamp) + 600;
  const plain = await owner.job.create({
    provider: accounts[1].address,
    evaluator: D.evaluator,
    hook: zeroAddress,
    expiredAt,
    paymentToken: D.paymentToken,
    description: 'plain SDK fork job',
  });
  await (
    await owner.job.fund(plain.jobId, { expectedBudget: BigInt(0) })
  ).wait();
  await push.request({
    method: 'anvil_impersonateAccount' as never,
    params: [D.evaluator] as never,
  });
  await push.request({
    method: 'anvil_setBalance' as never,
    params: [D.evaluator, '0x8ac7230489e80000'] as never,
  });
  const admin = createWalletClient({
    account: D.evaluator,
    chain: push.chain,
    transport: http(rpc),
  });
  const pauseHash = await admin.writeContract({
    chain: push.chain,
    address: D.kernel,
    abi: JOB_KERNEL_ABI,
    functionName: 'pause',
  });
  await push.waitForTransactionReceipt({ hash: pauseHash });
  await push.request({
    method: 'evm_setNextBlockTimestamp' as never,
    params: [expiredAt + 1] as never,
  });
  await push.request({ method: 'evm_mine' as never, params: [] as never });
  await (await provider.job.claimRefund(plain.jobId)).wait();
  expect((await owner.job.status(plain.jobId)).status).toBe('Expired');
  const unpauseHash = await admin.writeContract({
    chain: push.chain,
    address: D.kernel,
    abi: JOB_KERNEL_ABI,
    functionName: 'unpause',
  });
  await push.waitForTransactionReceipt({ hash: unpauseHash });
  expect(
    (await owner.job.list({ provider: accounts[1].address })).jobs.some(
      (j) => j.jobId === plain.jobId
    )
  ).toBe(true);
});
it('rejects a tampered plan before signing and atomically cancels a second job with permission revocation', async () => {
  const now = Number((await push.getBlock()).timestamp);
  const plan = await owner.market.preview(cardId, {
    principal: BigInt(10),
    executeBy: now + 600,
    expiredAt: now + 7200,
  });
  await expect(
    owner.market.openJob({
      ...plan,
      preview: { ...plan.preview, mayDo: ['tampered'] },
    })
  ).rejects.toMatchObject({ code: 'STALE_PLAN' });
  const badSignature = jest
    .spyOn(owner.universal, 'signTypedData')
    .mockImplementationOnce(async (data) => accounts[1].signTypedData(data));
  await expect(owner.market.openJob(plan)).rejects.toMatchObject({
    code: 'OPEN_JOB_SIMULATION_FAILED',
  });
  badSignature.mockRestore();
  const second = await owner.market.openJob(plan);
  await (await owner.job.cancel(second.jobId)).wait();
  expect((await owner.job.status(second.jobId)).status).toBe('Rejected');
  expect((await owner.market.activeJob(second.wallet)).jobId).toBe(BigInt(0));
  const gen = currentGeneration(PUSH_NETWORK.TESTNET_DONUT);
  expect(
    await push.readContract({
      address: gen.addresses.sessionEngine,
      abi: gen.contracts.abis.engine,
      functionName: 'isPermissionEnabled',
      args: [second.rulesId, second.wallet],
    })
  ).toBe(false);
});
it('accepts a real deployed EVM UEA owner signature with its home-chain domain', async () => {
  const external = await PushChain.initialize(
    { chain: CHAIN.ETHEREUM_SEPOLIA, address: accounts[0].address },
    {
      network: PUSH_NETWORK.TESTNET_DONUT,
      rpcUrls: { [CHAIN.PUSH_TESTNET_DONUT]: [rpc] },
    }
  );
  const uea = getAddress(external.universal.account);
  const base = (owner as unknown as { agenticRuntime: AgenticRuntime })
    .agenticRuntime;
  const rt: StackRuntime = {
    agw: {
      ...base,
      signerPushAccount: () => uea,
      signerOrigin: () => ({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: accounts[0].address,
      }),
      signerIsPushNative: () => false,
    },
    account: () => uea,
    wallet: () => undefined,
    send: base.execute,
    // Relaying is permitted on-chain. Anvil has no Cosmos MsgExecutePayload transport;
    // only the submitting transport is native here. The UEA verifies the real origin signature.
    signTypedData: (data) => accounts[0].signTypedData(data),
    canSignTypedData: () => true,
    jobBlocks: new Map(),
  };
  const market = new MarketNamespaceImpl(rt);
  const now = Number((await push.getBlock()).timestamp);
  const plan = await market.preview(cardId, {
    principal: BigInt(10),
    executeBy: now + 600,
    expiredAt: now + 7200,
  });
  await expect(market.openJob(plan)).rejects.toMatchObject({
    code: 'OWNER_NOT_DEPLOYED',
  });
  const deploy = await owner.universal.sendTransaction({
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
          owner: accounts[0].address,
        },
      ],
    }),
  });
  await deploy.wait();
  expect(await push.getCode({ address: uea })).not.toBe('0x');
  const reviewed = await market.preview(cardId, {
    principal: BigInt(10),
    executeBy: now + 600,
    expiredAt: now + 7200,
  });
  expect(reviewed.intent.owner).toBe(uea);
  expect(reviewed.intent.signerChainId).toBe(BigInt(11155111));
  const result = await market.openJob(reviewed);
  const gen = currentGeneration(PUSH_NETWORK.TESTNET_DONUT);
  expect(
    await push.readContract({
      address: result.wallet,
      abi: gen.contracts.abis.wallet,
      functionName: 'owner',
    })
  ).toBe(uea);
  expect((await owner.job.status(result.jobId)).status).toBe('Open');
});
