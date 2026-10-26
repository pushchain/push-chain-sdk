/** Real SDK, AGW v6, kernel, hook, evaluator and Read State on isolated Anvil.
 * Mocked tracked chain metadata and manually delivered consensus results; no public RPC or broadcasts.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import {
  encodeAbiParameters,
  stringToHex,
  zeroAddress,
  zeroHash,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  keccak256,
  parseAbi,
  parseEther,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { startHarness, type Harness } from '../__agw-local__/harness';
import {
  PushChain,
  type JobNamespace,
  type PrePostJobSpec,
  type JobSpec,
  type JobEvent,
  type JobEvaluatorConfig,
} from '../src';
import { JOB_KERNEL_ABI } from '../src/lib/market/contracts/AgenticCommerce';
import { EVALUATOR_ABI } from '../src/lib/job/UniversalEvaluator';
import { EVALUATION_HOOK_ABI } from '../src/lib/job/UniversalHook';
let h: Harness,
  owner: PushChain,
  provider: PushChain,
  job: JobNamespace<JobSpec | PrePostJobSpec>,
  agentJob: JobNamespace<JobSpec | PrePostJobSpec>,
  config: JobEvaluatorConfig;
let coreDir: string,
  token: Address,
  core: Address,
  readState: Address,
  kernel: Address,
  hook: Address,
  evaluator: Address,
  wallet: Address,
  rulesId: Hex;
let height = BigInt(30000000);
let baseline: Hex;
const events: JobEvent[] = [];
const stops: (() => void)[] = [];
const moduleAddress = '0x07a0258D367A4A4cd9d6E4b7eEE8E7eF491CC519';
function artifact(file: string, name: string) {
  return JSON.parse(
    readFileSync(join(coreDir, 'out', file, `${name}.json`), 'utf8')
  ) as { abi: Abi; bytecode: { object: Hex } };
}
async function deploy(
  name: string,
  file = `${name}.sol`,
  args: unknown[] = [],
  library?: Address
) {
  const a = artifact(file, name);
  const bytecode = (
    library
      ? a.bytecode.object.replace(/__\$[0-9a-fA-F]{34}\$__/g, library.slice(2))
      : a.bytecode.object
  ) as Hex;
  const hash = await h.wallets[0].deployContract({
    abi: a.abi,
    bytecode,
    args,
    account: h.wallets[0].account!,
    chain: h.publicClient.chain,
  });
  const receipt = await h.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress)
    throw new Error(`Deploy ${name} failed`);
  return getAddress(receipt.contractAddress);
}
async function write(
  address: Address,
  abi: Abi,
  name: string,
  args: unknown[]
) {
  return h.write(0, address, abi, name, args);
}
beforeAll(async () => {
  coreDir = execFileSync(
    'bash',
    [join(__dirname, '../scripts/evaluator-local/prepare.sh')],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  )
    .trim()
    .split('\n')
    .pop()!;
  const port = await new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
  h = await startHarness(port);
  owner = await h.client(0);
  provider = await h.client(1);
  const admin = h.wallets[0].account!.address;
  token = await deploy('MockERC20_6', 'MockERC20_6.sol', [
    'SDK local payment',
    'SDK',
  ]);
  core = await deploy('MockReadCore');
  const vault = await deploy('MockVaultPC');
  await write(
    core,
    artifact('MockReadCore.sol', 'MockReadCore').abi,
    'setReadBaseFee',
    ['eip155', '8453', BigInt(1000)]
  );
  await write(
    core,
    artifact('MockReadCore.sol', 'MockReadCore').abi,
    'setChainHeight',
    ['eip155:8453', height]
  );
  const readImpl = await deploy('UniversalCallback');
  readState = await deploy('ERC1967Proxy', 'ERC1967Proxy.sol', [
    readImpl,
    encodeFunctionData({
      abi: artifact('UniversalCallback.sol', 'UniversalCallback').abi,
      functionName: 'initialize',
      args: [core, vault, admin],
    }),
  ]);
  const kernelImpl = await deploy('AgenticCommerce');
  kernel = await deploy('ERC1967Proxy', 'ERC1967Proxy.sol', [
    kernelImpl,
    encodeFunctionData({
      abi: JOB_KERNEL_ABI,
      functionName: 'initialize',
      args: [token, admin, admin],
    }),
  ]);
  const lib = await deploy('JobSpecLib'),
    hookImpl = await deploy('UniversalHook');
  const nonce = await h.publicClient.getTransactionCount({ address: admin });
  const predicted = getContractAddress({
    from: admin,
    nonce: BigInt(nonce + 1),
  });
  hook = await deploy(
    'TransparentUpgradeableProxy',
    'TransparentUpgradeableProxy.sol',
    [
      hookImpl,
      admin,
      encodeFunctionData({
        abi: EVALUATION_HOOK_ABI,
        functionName: 'initialize',
        args: [kernel, h.addresses.factory, h.addresses.engine, predicted],
      }),
    ]
  );
  evaluator = await deploy(
    'UniversalEvaluator',
    'UniversalEvaluator.sol',
    [
      kernel,
      hook,
      readState,
      core,
      admin,
      {
        readTtl: BigInt(30),
        callbackGasLimit: BigInt(1000000),
        snapshotCallbackGasLimit: BigInt(300000),
        budgetMultiplier: BigInt(3),
        maxHeightAge: BigInt(3600),
        maxConfirmations: 64,
      },
    ],
    lib
  );
  expect(evaluator).toBe(predicted);
  await write(kernel, JOB_KERNEL_ABI, 'setHookWhitelist', [hook, true]);
  const now = Number((await h.publicClient.getBlock()).timestamp);
  const created = await owner.agentic.create('evaluator-sdk-local', {
    rules: [
      {
        agent: h.wallets[1].account!.address,
        validUntil: now + 30000,
        allowedCalls: [{ target: token, selector: 'balanceOf(address)' }],
      },
    ],
  });
  wallet = created.wallet;
  rulesId = created.rulesIds[0];
  await write(token, artifact('MockERC20_6.sol', 'MockERC20_6').abi, 'mint', [
    wallet,
    BigInt(50000000),
  ]);
  const tx = await h.wallets[0].sendTransaction({
    to: wallet,
    value: parseEther('2'),
    account: h.wallets[0].account!,
    chain: h.publicClient.chain,
  });
  await h.publicClient.waitForTransactionReceipt({ hash: tx });
  owner = await h.client(0, { agenticWallet: wallet });
  config = {
    profile: 'pre-post-v1',
    kernel,
    hook,
    evaluator,
    startBlock: BigInt(0),
    evaluatorCodeHash: keccak256(
      (await h.publicClient.getCode({ address: evaluator }))!
    ),
    hookCodeHash: keccak256((await h.publicClient.getCode({ address: hook }))!),
  };
  job = owner.job.withEvaluator(config);
  agentJob = provider.job.withEvaluator(config);
  await h.publicClient.request({
    method: 'anvil_impersonateAccount' as never,
    params: [moduleAddress] as never,
  });
  await h.publicClient.request({
    method: 'anvil_setBalance' as never,
    params: [moduleAddress, '0x56bc75e2d63100000'] as never,
  });
}, 180000);
beforeEach(async () => {
  height = BigInt(30000000);
  events.length = 0;
  baseline = (await h.publicClient.request({
    method: 'evm_snapshot' as never,
    params: [] as never,
  })) as Hex;
});
afterEach(async () => {
  stops.splice(0).forEach((stop) => stop());
  await h.publicClient.request({
    method: 'evm_revert' as never,
    params: [baseline] as never,
  });
});
afterAll(async () => {
  stops.forEach((stop) => stop());
  await h?.stop();
});
const readStateAbi = () =>
  artifact('UniversalCallback.sol', 'UniversalCallback').abi;
async function deliver(requestId: bigint, value: bigint | null) {
  const data = encodeFunctionData({
    abi: readStateAbi(),
    functionName: 'fulfillExternalCallback',
    args: [
      requestId,
      value === null
        ? '0x'
        : encodeAbiParameters([{ type: 'uint256' }], [value]),
    ],
  });
  const hash = (await h.publicClient.request({
    method: 'eth_sendTransaction' as never,
    params: [
      { from: moduleAddress, to: readState, data, gas: '0x1e8480' },
    ] as never,
  })) as Hex;
  expect(
    (await h.publicClient.waitForTransactionReceipt({ hash })).status
  ).toBe('success');
}
function criteria() {
  const read = PushChain.utils.job.prepareRead({
    chain: 'eip155:8453',
    target: token,
    abi: parseAbi(['function balanceOf(address) view returns(uint256)']),
    functionName: 'balanceOf',
    args: [wallet],
  });
  return PushChain.utils.job.prePost.buildJobSpec({
    reads: [read, { read, at: 'PRE_EXECUTION' }],
    checks: [
      {
        left: [0],
        right: [1],
        evaluation: 'NUMBER',
        operation: 'GREATER_OR_EQUAL',
        target: BigInt(5),
      },
    ],
    logic: 'ALL',
  });
}
async function createFunded() {
  const spec = criteria(),
    bytes = PushChain.utils.job.prePost.encodeJobSpec(spec),
    now = Number((await h.publicClient.getBlock()).timestamp);
  const created = await job.create({
    provider: h.wallets[1].account!.address,
    evaluator,
    hook,
    paymentToken: token,
    expiredAt: now + 7200,
    jobSpec: bytes,
  });
  await (await agentJob.setBudget(created.jobId, BigInt(1000000))).wait();
  const quote = await job.quoteEvaluation(created.jobId);
  await (
    await job.fund(created.jobId, {
      rulesId,
      expectedBudget: BigInt(1000000),
      evaluation: {
        expectedSpecHash: keccak256(bytes),
        maxReadFee: parseEther('0.1'),
        prefundAmount: quote.topUp + parseEther('0.01'),
      },
    })
  ).wait();
  return created.jobId;
}
async function submit(jobId: bigint) {
  const before = await job.status(jobId);
  if (!before.evaluation.available) throw new Error('Expected evaluator facts');
  await deliver(before.evaluation.reads[1].requestId, BigInt(100));
  height += BigInt(1);
  await write(
    core,
    artifact('MockReadCore.sol', 'MockReadCore').abi,
    'setChainHeight',
    ['eip155:8453', height]
  );
  await (
    await agentJob.submit(jobId, { deliverable: 'local evaluator test' })
  ).wait();
  let status = await job.status(jobId);
  // submit fixes the end blocks, while read dispatch is explicitly best effort.
  // RPC gas estimation may leave that dispatch for the public retry path.
  if (status.evaluation.available && !status.evaluation.started) {
    await (await agentJob.verify(jobId)).wait();
    status = await job.status(jobId);
  }
  if (!status.evaluation.available) throw new Error('Expected evaluator facts');
  return status;
}
it('executes atomic PC prepayment and escrow, freezes canonical criteria, then pays on a PRE/POST verdict', async () => {
  const jobId = await createFunded();
  const funded = await job.status(jobId);
  expect(funded.status).toBe('Funded');
  expect(funded.jobSpec?.frozen).toBe(true);
  expect(funded.evaluation).toMatchObject({
    available: true,
    ready: false,
    reads: [
      { at: 'POST_EXECUTION' },
      { at: 'PRE_EXECUTION', fundHeight: height },
    ],
  });
  const status = await submit(jobId);
  if (!status.evaluation.available) throw new Error();
  await deliver(status.evaluation.reads[0].requestId, BigInt(110));
  expect(await job.status(jobId)).toMatchObject({
    status: 'Completed',
    evaluation: { available: true, verdict: 'PASS', applied: true },
  });
  await (await job.claimReadFees(jobId)).wait();
  expect((await job.status(jobId)).evaluation).toMatchObject({
    prepaid: BigInt(0),
  });
});
it('refuses stale criteria hashes and fee caps without moving escrow or prepaying reads', async () => {
  const spec = criteria(),
    bytes = PushChain.utils.job.prePost.encodeJobSpec(spec),
    now = Number((await h.publicClient.getBlock()).timestamp);
  const { jobId } = await job.create({
    provider: h.wallets[1].account!.address,
    evaluator,
    hook,
    paymentToken: token,
    expiredAt: now + 7200,
    jobSpec: bytes,
  });
  await (await agentJob.setBudget(jobId, BigInt(1))).wait();
  await expect(
    job.fund(jobId, {
      rulesId,
      expectedBudget: BigInt(1),
      evaluation: {
        expectedSpecHash: ('0x' + '11'.repeat(32)) as Hex,
        maxReadFee: parseEther('0.1'),
      },
    })
  ).rejects.toMatchObject({ code: 'SPEC_HASH_MISMATCH' });
  await expect(
    job.fund(jobId, {
      rulesId,
      expectedBudget: BigInt(1),
      evaluation: { expectedSpecHash: keccak256(bytes), maxReadFee: BigInt(0) },
    })
  ).rejects.toMatchObject({ code: 'READ_FEE_EXCEEDED' });
  expect(await job.status(jobId)).toMatchObject({
    status: 'Open',
    evaluation: { prepaid: BigInt(0) },
  });
  await (await job.cancel(jobId)).wait();
});
it('retries an unreadable evaluation from the client wallet at the original fixed height', async () => {
  const jobId = await createFunded();
  const status = await submit(jobId);
  if (!status.evaluation.available) throw new Error();
  const first = status.evaluation.reads[0];
  await deliver(first.requestId, null);
  expect((await job.status(jobId)).evaluation).toMatchObject({
    done: true,
    verdict: 'INCONCLUSIVE',
  });
  await (
    await job.verify(jobId, {
      value: parseEther('0.01'),
      maxReadFee: parseEther('0.01'),
    })
  ).wait();
  const retried = await job.status(jobId);
  if (!retried.evaluation.available) throw new Error();
  expect(retried.evaluation.reads[0].requestId).not.toBe(first.requestId);
  expect(retried.evaluation.reads[0].endHeight).toBe(first.endHeight);
  await deliver(retried.evaluation.reads[0].requestId, BigInt(110));
  expect((await job.status(jobId)).status).toBe('Completed');
  await (await job.claimReadFees(jobId)).wait();
});
it('recovers a PRE request past expiry and refuses a stranger retry', async () => {
  const jobId = await createFunded();
  const before = await job.status(jobId);
  if (!before.evaluation.available) throw new Error();
  await h.publicClient.request({
    method: 'anvil_mine' as never,
    params: ['0x20'] as never,
  });
  const stranger = (await h.client(2)).job.withEvaluator(config);
  await expect(
    stranger.verify(jobId, { action: 'retrySnapshot' })
  ).rejects.toMatchObject({ code: 'NOT_CLIENT' });
  await (
    await agentJob.verify(jobId, {
      action: 'retrySnapshot',
      value: parseEther('0.01'),
      maxReadFee: parseEther('0.01'),
    })
  ).wait();
  const retried = await job.status(jobId);
  if (!retried.evaluation.available) throw new Error();
  expect(retried.evaluation.reads[1].requestId).not.toBe(
    before.evaluation.reads[1].requestId
  );
  expect(retried.evaluation.reads[1].fundHeight).toBe(
    before.evaluation.reads[1].fundHeight
  );
  const status = await submit(jobId);
  if (!status.evaluation.available) throw new Error();
  await deliver(status.evaluation.reads[0].requestId, BigInt(110));
  expect((await job.status(jobId)).status).toBe('Completed');
  await (await job.claimReadFees(jobId)).wait();
});
it('stores a verdict through a paused kernel and applies it with public settle after unpausing', async () => {
  const jobId = await createFunded();
  const status = await submit(jobId);
  if (!status.evaluation.available) throw new Error();
  const start = await h.publicClient.getBlockNumber();
  stops.push(
    job.watch(jobId, (e) => events.push(e), {
      fromBlock: start,
      pollIntervalMs: 25,
    })
  );
  await write(kernel, JOB_KERNEL_ABI, 'pause', []);
  await deliver(status.evaluation.reads[0].requestId, BigInt(110));
  expect(await job.status(jobId)).toMatchObject({
    status: 'Submitted',
    evaluation: { verdict: 'PASS', applied: false },
  });
  await write(kernel, JOB_KERNEL_ABI, 'unpause', []);
  await (await agentJob.verify(jobId)).wait();
  expect((await job.status(jobId)).status).toBe('Completed');
  for (let i = 0; i < 40 && !events.some((e) => e.kind === 'Verified'); i++)
    await new Promise((resolve) => setTimeout(resolve, 25));
  expect(events.filter((e) => e.kind === 'Error')).toEqual([]);
  expect(events.some((e) => e.kind === 'Verified')).toBe(true);
  expect(events.some((e) => e.kind === 'SettleFailed')).toBe(true);
  await (await job.claimReadFees(jobId)).wait();
});
it('matches the pinned Solidity marketplace builder for the new card template wire', async () => {
  const library = await deploy('JobSpecBuilder');
  const builder = await deploy(
    'JobSpecBuilderHarness',
    'JobSpecBuilder.t.sol',
    [],
    library
  );
  const abi = artifact('JobSpecBuilder.t.sol', 'JobSpecBuilderHarness').abi;
  const chainHash = keccak256(stringToHex('eip155:8453'));
  await write(builder, abi, 'setSupported', [chainHash, true]);
  const cea = (await h.publicClient.readContract({
    address: builder,
    abi,
    functionName: 'ceaFor',
    args: [wallet, chainHash],
  })) as Address;
  const read = PushChain.utils.job.prepareRead({
    chain: 'eip155:8453',
    target: token,
    abi: parseAbi(['function balanceOf(address) view returns(uint256)']),
    functionName: 'balanceOf',
    args: ['agentic:wallet'],
  });
  const template = PushChain.utils.job.prePost.buildJobSpecTemplate({
    reads: [read, { read, at: 'PRE_EXECUTION' }],
    checks: [
      {
        left: [0],
        right: [1],
        evaluation: 'NUMBER',
        operation: 'GREATER_OR_EQUAL',
        target: { principalBps: BigInt(9990) },
      },
    ],
    logic: 'ALL',
    params: Array.from({ length: 17 }, () => ({
      min: BigInt(0),
      max: BigInt(20000),
    })),
  });
  const context = {
    agw: wallet,
    principal: BigInt(10000),
    executeBy: 123456,
    settleWindow: 60,
    params: Array.from({ length: 17 }, (_, i) => BigInt(i)),
    origin: ('0x' + 'ab'.repeat(32)) as Hex,
  };
  const expected = await h.publicClient.readContract({
    address: builder,
    abi,
    functionName: 'build',
    args: [PushChain.utils.job.prePost.encodeJobSpec(template), context],
  });
  const resolved = PushChain.utils.job.prePost.resolveJobSpec(template, {
    principal: context.principal,
    params: Array.from({ length: 17 }, (_, i) => BigInt(i)),
    accounts: { 'eip155:8453': cea },
    origin: context.origin,
  });
  expect(PushChain.utils.job.prePost.encodeJobSpec(resolved)).toBe(expected);
});
it('keeps legacy binary JobSpecs and manual jobs usable on the same scoped kernel', async () => {
  const read = PushChain.utils.job.prepareRead({
    chain: 'eip155:8453',
    target: token,
    abi: parseAbi(['function balanceOf(address) view returns(uint256)']),
    functionName: 'balanceOf',
    args: [wallet],
  });
  const now = Number((await h.publicClient.getBlock()).timestamp),
    spec = PushChain.utils.job.buildJobSpec({
      reads: [read],
      checks: [
        {
          read: 0,
          evaluation: 'COMPARE',
          operation: 'GREATER_OR_EQUAL',
          target: BigInt(1),
        },
      ],
      logic: 'ALL',
      executeBy: now + 100,
      failFinalAt: now + 200,
    });
  const { jobId } = await job.create({
    provider: h.wallets[1].account!.address,
    evaluator: h.wallets[2].account!.address,
    hook: zeroAddress,
    paymentToken: token,
    expiredAt: now + 7200,
    jobSpec: PushChain.utils.job.encodeJobSpec(spec),
  });
  expect((await job.status(jobId)).jobSpec?.spec).toEqual(spec);
  await (await agentJob.setBudget(jobId, BigInt(1))).wait();
  await (await job.fund(jobId, { expectedBudget: BigInt(1) })).wait();
  await expect(job.verify(jobId)).rejects.toMatchObject({
    code: 'CAPABILITY_UNAVAILABLE',
  });
  await (await agentJob.submit(jobId, { deliverable: 'legacy manual' })).wait();
  await h.write(2, kernel, JOB_KERNEL_ABI, 'complete', [jobId, zeroHash, '0x']);
  expect((await job.status(jobId)).status).toBe('Completed');
});
it('rejects a failing fixed-block criterion and refunds escrow to the client', async () => {
  const jobId = await createFunded();
  const status = await submit(jobId);
  if (!status.evaluation.available) throw new Error();
  const before = await h.publicClient.readContract({
    address: token,
    abi: parseAbi(['function balanceOf(address) view returns(uint256)']),
    functionName: 'balanceOf',
    args: [wallet],
  });
  await deliver(status.evaluation.reads[0].requestId, BigInt(101));
  expect(await job.status(jobId)).toMatchObject({
    status: 'Rejected',
    evaluation: { verdict: 'FAIL', applied: true },
  });
  const after = await h.publicClient.readContract({
    address: token,
    abi: parseAbi(['function balanceOf(address) view returns(uint256)']),
    functionName: 'balanceOf',
    args: [wallet],
  });
  expect(after - before).toBe(BigInt(1000000));
  await (await job.claimReadFees(jobId)).wait();
});
it('waits for both destination work blocks and evaluates summed cross-chain criteria', async () => {
  const chains = ['eip155:84532', 'eip155:11155111'];
  const coreAbi = artifact('MockReadCore.sol', 'MockReadCore').abi;
  for (const chain of chains) {
    await write(core, coreAbi, 'setReadBaseFee', [
      'eip155',
      chain.split(':')[1],
      BigInt(1000),
    ]);
    await write(core, coreAbi, 'setChainHeight', [chain, BigInt(4000)]);
  }
  const reads = chains.map((chain) =>
    PushChain.utils.job.prepareRead({
      chain: chain as 'eip155:84532' | 'eip155:11155111',
      target: token,
      abi: parseAbi(['function balanceOf(address) view returns(uint256)']),
      functionName: 'balanceOf',
      args: [wallet],
    })
  );
  // This tests cross-chain criteria on a plain job, not multi-chain marketplace cards or multi-rule hook binding.
  const spec = PushChain.utils.job.prePost.buildJobSpec({
    reads: [
      reads[0],
      reads[1],
      { read: reads[0], at: 'PRE_EXECUTION' },
      { read: reads[1], at: 'PRE_EXECUTION' },
    ],
    checks: [
      {
        left: [0, 1],
        right: [2, 3],
        evaluation: 'NUMBER',
        operation: 'GREATER_OR_EQUAL',
        target: BigInt(1000),
      },
      {
        left: [0],
        right: [2],
        evaluation: 'NUMBER',
        operation: 'GREATER_OR_EQUAL',
        target: BigInt(400),
      },
      {
        left: [1],
        right: [3],
        evaluation: 'NUMBER',
        operation: 'GREATER_OR_EQUAL',
        target: BigInt(400),
      },
    ],
    logic: 'ALL',
  });
  const bytes = PushChain.utils.job.prePost.encodeJobSpec(spec),
    now = Number((await h.publicClient.getBlock()).timestamp);
  const { jobId } = await job.create({
    provider: h.wallets[1].account!.address,
    evaluator,
    hook,
    paymentToken: token,
    expiredAt: now + 7200,
    jobSpec: bytes,
  });
  await (await agentJob.setBudget(jobId, BigInt(1000000))).wait();
  await (
    await job.fund(jobId, {
      rulesId,
      expectedBudget: BigInt(1000000),
      evaluation: {
        expectedSpecHash: keccak256(bytes),
        maxReadFee: parseEther('0.1'),
        prefundAmount: parseEther('0.05'),
      },
    })
  ).wait();
  const funded = await job.status(jobId);
  if (!funded.evaluation.available) throw new Error();
  await deliver(funded.evaluation.reads[2].requestId, BigInt(100));
  await deliver(funded.evaluation.reads[3].requestId, BigInt(200));
  await write(core, coreAbi, 'setChainHeight', [chains[0], BigInt(4002)]);
  await write(core, coreAbi, 'setChainHeight', [chains[1], BigInt(4001)]);
  const executionBlocks = {
    [chains[0]]: BigInt(4002),
    [chains[1]]: BigInt(4003),
  };
  await expect(
    agentJob.submit(jobId, {
      deliverable: 'both chains worked',
      executionBlocks,
    })
  ).rejects.toMatchObject({
    code: 'EXECUTION_BLOCK_NOT_TRACKED',
    details: { chain: chains[1] },
  });
  expect((await job.status(jobId)).status).toBe('Funded');
  await write(core, coreAbi, 'setChainHeight', [chains[1], BigInt(4003)]);
  await (
    await agentJob.submit(jobId, {
      deliverable: 'both chains worked',
      executionBlocks,
    })
  ).wait();
  let submitted = await job.status(jobId);
  if (submitted.evaluation.available && !submitted.evaluation.started) {
    await (await agentJob.verify(jobId)).wait();
    submitted = await job.status(jobId);
  }
  if (!submitted.evaluation.available) throw new Error();
  expect(submitted.evaluation.reads[0].endHeight).toBe(BigInt(4002));
  expect(submitted.evaluation.reads[1].endHeight).toBe(BigInt(4003));
  await deliver(submitted.evaluation.reads[0].requestId, BigInt(700));
  await deliver(submitted.evaluation.reads[1].requestId, BigInt(600));
  expect(await job.status(jobId)).toMatchObject({
    status: 'Completed',
    evaluation: { verdict: 'PASS', applied: true },
  });
  await (await job.claimReadFees(jobId)).wait();
});
