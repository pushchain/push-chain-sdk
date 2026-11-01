/** Public SDK → real deployed 2.1/AGW v6 on an isolated Anvil Donut fork. No keys or writes to public RPC. */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  bytesToHex,
  hexToBytes,
  parseTransaction,
  keccak256,
  http,
  parseAbi,
  stringToHex,
  zeroAddress,
  zeroHash,
  type Address,
  type PublicClient,
  type Hex,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { PushChain, type UniversalSigner } from '../src';
import { CHAIN, PUSH_NETWORK, LIBRARY } from '../src/lib/constants/enums';
import { DONUT_MARKETPLACE as D } from '../src/lib/market/deployment';
import { JOB_KERNEL_ABI } from '../src/lib/market/contracts/AgenticCommerce';
import { currentGeneration } from '../src/lib/agentic/deployments';
import type { AgentCardRules } from '../src/lib/market/rules';
import type { JobSpecTemplate } from '../src';
import { MarketNamespaceImpl } from '../src/lib/market/market';
import type { StackRuntime } from '../src/lib/market/runtime';
import type { AgenticRuntime } from '../src/lib/agentic/runtime';

let node: ChildProcess;
let rpc: string;
let push: PublicClient;
let owner: PushChain;
let provider: PushChain;
let cardId: bigint;
let opened: { jobId: bigint; wallet: Address; rulesIds: `0x${string}`[] };
let template: JobSpecTemplate;
let rules: AgentCardRules;
let stopWatch: (() => void) | undefined;
const accounts = [0, 1, 2].map((addressIndex) =>
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
  const forkRpc =
    process.env['MARKET_FORK_RPC'] ?? 'https://evm.donut.rpc.push.org/';
  const forkBlock =
    process.env['MARKET_FORK_BLOCK'] ??
    String(
      await createPublicClient({ transport: http(forkRpc) }).getBlockNumber()
    );
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
      forkRpc,
      '--fork-block-number',
      forkBlock,
      '--timeout',
      '120000',
      '--retries',
      '2',
      '--silent',
      '--order',
      'fifo',
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
        left: [0],
        right: [],
        evaluation: 'COMPARE',
        operation: 'GREATER_OR_EQUAL',
        target: BigInt(0),
      },
    ],
    logic: 'ALL',
  });
  rules = [
    {
      chain: CHAIN.BNB_TESTNET,
      assets: [
        {
          token: { prc20: token },
          maxPerCall: PushChain.CONSTANTS.AGENTIC.PRINCIPAL,
          maxTotal: PushChain.CONSTANTS.AGENTIC.PRINCIPAL,
        },
      ],
      maxGasPerCall: BigInt(0),
      allowedCalls: [
        {
          target: tokenOnSepolia,
          selector: 'balanceOf(address)',
          pins: [{ arg: 0, expected: PushChain.CONSTANTS.AGENTIC.WALLET }],
        },
      ],
    },
  ];
}, 180000);
afterAll(async () => {
  stopWatch?.();
  node?.kill('SIGTERM');
});

it('registers and discovers a real 2.1 provider card through the public namespace', async () => {
  const response = await provider.market.agent.register(
    {
      jobType: 'SDK_FORK_TEST',
      metadataURI: 'https://example.invalid/sdk-marketplace-test',
      metadataHash: ('0x' + '12'.repeat(32)) as `0x${string}`,
      providerFee: BigInt(5000000),
      paymentToken: D.paymentToken,
      minDuration: 3600,
      maxDuration: 90 * 86400,
    },
    { rules, jobSpecTemplate: template }
  );
  cardId = response.cardId;
  expect(response.version).toBe(BigInt(1));
  expect(cardId).toBeGreaterThan(BigInt(0));
  const card = await owner.market.card(cardId);
  expect(card.provider).toBe(accounts[1].address);
  expect(card.jobSpecTemplate.profile).toBe('pre-post-v1');
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
    expiredAt: now + 7200,
  });
  const response = await owner.market.openJob(plan);
  opened = response;
  expect((await owner.market.activeJob(opened.wallet)).jobId).toBe(
    opened.jobId
  );
  const status = await owner.job.status(opened.jobId);
  expect(status.description).toBe(plan.jobSpec.bytes);
  expect(status.evaluation.available).toBe(true);
  expect(response.rulesIds).toHaveLength(1);
  await (await owner.job.cancel(response.jobId)).wait();
  expect((await owner.job.status(response.jobId)).status).toBe('Rejected');
  await expect(
    owner.agentic.wallet(response.wallet).rules.get(response.rulesIds[0])
  ).rejects.toMatchObject({ code: 'RULE_NOT_FOUND' });
});
