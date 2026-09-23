import '@e2e/shared/setup';
import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import type { Hex } from 'viem';
import { PushChain } from '../../../src';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { CHAIN } from '../../../src/lib/constants/enums';
import { fundUeaPC, makePushContext } from '../_helpers/docs-fund';
import { retryTruth, sepoliaTruth } from '../../read/_shared';

// Exact copies of the three mirrored customPropGTagEvent playgrounds in
// push-chain-website/docs/chain/03-build/04-universal-reads/ (Read Universal State,
// Read Multiple Universal States, Track Universal Read). Only imports, prompts, logging
// and the final catch are adapted by the harness.
// Run scripts/check-read-state-doc-examples.mjs (--write to re-copy) to check fixture parity.
const pushKey = process.env['PUSH_PRIVATE_KEY'] as Hex | undefined;
const d = pushKey ? describe : describe.skip;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
type Run = { logs: unknown[][]; client: PushChain; fundingCount: number; closeCount: number };

// Subjects the docs playgrounds read.
const HOLDER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' as const; // vitalik.eth on Sepolia
const VAULT_PDA = '89q1AUFb7YREHtjc1aYaPywovPq6tb3GYNPyDUJ3rshi';

d('docs-examples › 13-read-state playgrounds', () => {
  const providers: ethers.JsonRpcProvider[] = [];
  const wallets: ethers.HDNodeWallet[] = [];
  let balanceRun: Promise<Run> | undefined;

  function fixtureBody(slug: string): string {
    const source = fs.readFileSync(path.join(__dirname, 'fixtures', slug + '.js'), 'utf8');
    return source.replace(/^\s*import.*$/gm, '')
      .replace("main().catch(error => { console.error(error.message); process.exitCode = 1; });", 'await main();');
  }

  /** Runs a playground; `answers` feed its non-funding prompts in order (e.g. the resume menu). */
  async function run(slug: string, answers: string[] = []): Promise<Run> {
    const body = fixtureBody(slug);
    const logs: unknown[][] = [];
    let client: PushChain | undefined;
    let fundingCount = 0;
    let closeCount = 0;
    const pending = [...answers];
    const sdk = {
      CONSTANTS: PushChain.CONSTANTS, utils: PushChain.utils,
      initialize: async (...args: Parameters<typeof PushChain.initialize>) => {
        client = await PushChain.initialize(...args);
        return client;
      },
    };
    const browserEthers = {
      ...ethers,
      JsonRpcProvider: class extends ethers.JsonRpcProvider {
        constructor(url: string) { super(url); providers.push(this); }
      },
      Wallet: { createRandom: () => {
        const wallet = ethers.Wallet.createRandom();
        wallets.push(wallet);
        return wallet;
      } },
    };
    const readline = { createInterface: () => ({
      question: async (question: string) => {
        if (question.startsWith(':::prompt:::')) {
          const address = question.match(/0x[0-9a-fA-F]{40}/)?.[0] as Hex;
          if (!address) throw new Error('Funding prompt has no wallet address');
          await fundUeaPC(makePushContext(pushKey!), address, '0.05');
          fundingCount++;
          return '';
        }
        if (!pending.length) throw new Error('Unexpected prompt: ' + question);
        return pending.shift()!;
      },
      close() { closeCount++; },
    }) };
    await new AsyncFunction('PushChain', 'ethers', 'readline', 'console', body)(
      sdk, browserEthers, readline,
      { log: (...args: unknown[]) => { logs.push(args); console.log(...args); },
        error: (...args: unknown[]) => { throw new Error(args.join(' ')); } },
    );
    if (!client) throw new Error('Playground did not initialize a client');
    return { logs, client, fundingCount, closeCount };
  }

  function balance() {
    // Resume remains runnable alone: seed a request if the first test was not selected.
    return balanceRun ??= run('universal_read_evm_balance');
  }
  function output(result: Run, label: string): unknown[] | undefined {
    return result.logs.find(row => row[0] === label)?.slice(1);
  }
  function events(result: Run): string[] {
    return result.logs.map(row => String(row[0])).filter(line => line.startsWith('READ-TX-')).map(line => line.split(':')[0]);
  }

  it('universal_read_evm_balance — fresh-wallet request and decoded balance', async () => {
    const result = await balance();
    expect(result.fundingCount).toBe(1);
    expect(result.closeCount).toBe(1);
    const requestId = output(result, 'Save requestId:')![0] as Hex;
    const read = await result.client.universal.trackRead({ requestId });
    expect(read.txHash).toBe(output(result, 'Save txHash:')![0]);
    expect(read.outcome).toBe(PushChain.CONSTANTS.READ.OUTCOME.SUCCESS);
    expect(read.value).toBe(await retryTruth(() => sepoliaTruth().getBalance({ address: HOLDER, blockNumber: read.request.spec.blockNumber })));
    expect(output(result, 'Value:')).toEqual([ethers.formatEther(read.value as bigint), 'ETH']);
    expect(events(result)).toContain('READ-TX-199-01');
  }, 300_000);

  it('universal_read_batch — EVM and Solana balances in input order', async () => {
    const result = await run('universal_read_batch');
    expect(result.fundingCount).toBe(1);
    expect(result.closeCount).toBe(1);
    expect(typeof output(result, 'Submission is atomic:')![0]).toBe('boolean');
    const ids = (output(result, 'Save request IDs:')![0] as string).split(', ') as Hex[];
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const [eth, sol] = await Promise.all(ids.map(requestId => result.client.universal.trackRead({ requestId })));
    expect(eth.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
    expect(sol.chain).toBe(CHAIN.SOLANA_DEVNET);
    expect(eth.value).toBe(await retryTruth(() => sepoliaTruth().getBalance({ address: HOLDER, blockNumber: eth.request.spec.blockNumber })));
    const values = result.logs.filter(row => row[0] === 'Value:').map(row => row.slice(1));
    expect(values).toEqual([[ethers.formatEther(eth.value as bigint), 'ETH'], [ethers.formatUnits(sol.value as bigint, 9), 'SOL']]);
    // The vault PDA is a live account; the finalized balance must at least exist and match the decoded read.
    const lamports = await new Connection(CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC[0], 'finalized').getBalance(new PublicKey(VAULT_PDA), 'finalized');
    expect(lamports).toBeGreaterThan(0);
  }, 300_000);

  it('universal_read_resume — your own request ID (menu 3) with a read-only client', async () => {
    const seed = await balance();
    const requestId = output(seed, 'Save requestId:')![0] as string;
    const result = await run('universal_read_resume', ['3', requestId]);
    expect(result.fundingCount).toBe(0);
    expect(result.closeCount).toBe(1);
    expect(output(result, 'Current status:')).toEqual(['FULFILLED']);
    const read = await result.client.universal.trackRead({ requestId: requestId as Hex });
    expect(output(result, 'Value:')).toEqual([JSON.stringify(String(read.value))]);
    expect(events(result).slice(0, 2)).toEqual(['READ-TX-104-03', 'READ-TX-104-04']);
  }, 300_000);

  it('universal_read_resume — predefined request ID (menu 1) and transaction hash (menu 2)', async () => {
    const byId = await run('universal_read_resume', ['1']);
    expect(byId.fundingCount).toBe(0);
    expect(output(byId, 'Current status:')).toEqual(['FULFILLED']);
    expect(String(output(byId, 'Value:')![0])).toMatch(/^\d+(\.\d+)? USDC$/);
    const byTx = await run('universal_read_resume', ['2']);
    expect(output(byTx, 'Reads in this transaction:')).toEqual([1]);
    expect(output(byTx, 'Value:')![1]).toBe('ETH');
  }, 300_000);

  it('closes readline and the provider when a playground fails before broadcast', async () => {
    const body = fixtureBody('universal_read_evm_balance');
    let closed = 0;
    let destroyed = 0;
    const fakeEthers = {
      JsonRpcProvider: class { destroy() { destroyed++; } },
      Wallet: { createRandom: () => ({ address: '0x1111111111111111111111111111111111111111', connect() { return this; } }) },
    };
    const readline = { createInterface: () => ({
      question: async () => { throw new Error('funding cancelled'); },
      close: () => { closed++; },
    }) };
    const execute = new AsyncFunction('PushChain', 'ethers', 'readline', 'console', body);
    await expect(execute(PushChain, fakeEthers, readline, console)).rejects.toThrow('funding cancelled');
    expect(closed).toBe(1);
    expect(destroyed).toBe(1);
  });

  afterAll(async () => {
    if (!wallets.length) return;
    const provider = new ethers.JsonRpcProvider('https://evm.donut.rpc.push.org/');
    try {
      const recipient = new ethers.Wallet(pushKey!).address;
      for (const wallet of wallets) {
        const balance = await provider.getBalance(wallet.address);
        if (balance === 0n) continue;
        const fees = await provider.getFeeData();
        const gasLimit = (await provider.estimateGas({ from: wallet.address, to: recipient, value: 1n })) * 2n;
        const reserve = gasLimit * fees.maxFeePerGas!;
        if (balance > reserve) {
          const tx = await wallet.connect(provider).sendTransaction({
            to: recipient, value: balance - reserve, gasLimit,
            maxFeePerGas: fees.maxFeePerGas!, maxPriorityFeePerGas: fees.maxPriorityFeePerGas!,
          });
          await tx.wait();
        }
      }
    } finally {
      provider.destroy();
      providers.forEach(provider => provider.destroy());
    }
  }, 120_000);
});
