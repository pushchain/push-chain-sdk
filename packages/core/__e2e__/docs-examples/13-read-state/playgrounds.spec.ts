import '@e2e/shared/setup';
import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import { Connection, SystemProgram } from '@solana/web3.js';
import type { Hex } from 'viem';
import { PushChain } from '../../../src';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { CHAIN } from '../../../src/lib/constants/enums';
import { fundUeaPC, makePushContext } from '../_helpers/docs-fund';
import { retryTruth, sepoliaTruth } from '../../read/_shared';

// Exact copies of the three customPropGTagEvent playgrounds at:
// push-chain-website/docs/chain/03-build/13a-Universal-Read.mdx
// Only imports, prompts, logging and the final catch are adapted by the harness.
// Run scripts/check-read-state-doc-examples.mjs to check fixture parity.
const pushKey = process.env['PUSH_PRIVATE_KEY'] as Hex | undefined;
const d = pushKey ? describe : describe.skip;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
type Run = { logs: unknown[][]; client: PushChain; fundingCount: number; closeCount: number };

d('docs-examples › 13-read-state playgrounds', () => {
  const providers: ethers.JsonRpcProvider[] = [];
  const wallets: ethers.HDNodeWallet[] = [];
  let registryRun: Promise<Run> | undefined;
  const token = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const;
  const tokenAbi = [{ type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const;

  async function run(slug: string, resumeId?: string): Promise<Run> {
    const source = fs.readFileSync(path.join(__dirname, 'fixtures', slug + '.js'), 'utf8');
    const body = source.replace(/^\s*import.*$/gm, '')
      .replace("main().catch(error => { console.error(error.message); process.exitCode = 1; });", 'await main();');
    const logs: unknown[][] = [];
    let client: PushChain | undefined;
    let fundingCount = 0;
    let closeCount = 0;
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
        if (!resumeId) throw new Error('Resume example requires an existing request ID');
        return resumeId;
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

  function registry() {
    // Resume remains runnable alone: seed a request if the first test was not selected.
    return registryRun ??= run('universal_read_registry');
  }
  function output(result: Run, label: string): unknown {
    return result.logs.find(row => row[0] === label)?.[1];
  }

  it('universal_read_registry — fresh-wallet request and decoded balance', async () => {
    const result = await registry();
    expect(result.fundingCount).toBe(1);
    expect(result.closeCount).toBe(1);
    expect(output(result, 'Callback delivered:')).toBe(true);
    const requestId = output(result, 'Save requestId:') as Hex;
    const read = await result.client.universal.trackRead({ requestId });
    expect(read.txHash).toBe(output(result, 'Save txHash:'));
    expect(read.value).toBe(await retryTruth(() => sepoliaTruth().getBalance({
      address: '0x000000000000000000000000000000000000dEaD',
      blockNumber: read.request.spec.blockNumber,
    })));
    expect(JSON.parse(output(result, 'Value:') as string)).toBe(String(read.value));
  }, 300_000);

  it('universal_read_batch — EVM, Web2, typed call and Solana keep input order', async () => {
    const result = await run('universal_read_batch');
    expect(result.fundingCount).toBe(1);
    expect(result.closeCount).toBe(1);
    const ids = (output(result, 'Save request IDs:') as string).split(', ') as Hex[];
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    const first = await result.client.universal.trackRead({ requestId: ids[0] });
    const values = result.logs.filter(row => row[0] === 'Value:').map(row => JSON.parse(row[1] as string));
    const truth = await retryTruth(() => sepoliaTruth().getBalance({
      address: '0x000000000000000000000000000000000000dEaD',
      blockNumber: first.request.spec.blockNumber,
    }));
    const typed = await result.client.universal.trackRead({ requestId: ids[2] });
    const supply = await retryTruth(() => sepoliaTruth().readContract({
      address: token, abi: tokenAbi, functionName: 'totalSupply',
      blockNumber: typed.request.spec.blockNumber,
    }));
    const solana = new Connection(CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC[0], 'finalized');
    const lamports = await solana.getBalance(SystemProgram.programId, 'finalized');
    expect(values).toEqual([truth.toString(), ['1', false], supply.toString(), lamports.toString()]);
    expect(result.logs.filter(row => row[0] === 'Callback delivered:').map(row => row[1])).toEqual([true, true, true, true]);
  }, 300_000);

  it('universal_read_resume — existing request with a read-only client', async () => {
    const seed = await registry();
    const result = await run('universal_read_resume', output(seed, 'Save requestId:') as string);
    expect(result.fundingCount).toBe(0);
    expect(result.closeCount).toBe(1);
    expect(output(result, 'Current status:')).toBe(PushChain.CONSTANTS.READ.STATUS.FULFILLED);
    expect(output(result, 'Value:')).toBe(output(seed, 'Value:'));
    expect(output(result, 'Callback delivered:')).toBe(true);
  }, 300_000);

  it('closes readline and the provider when a playground fails before broadcast', async () => {
    const source = fs.readFileSync(path.join(__dirname, 'fixtures', 'universal_read_registry.js'), 'utf8');
    const body = source.replace(/^\s*import.*$/gm, '')
      .replace("main().catch(error => { console.error(error.message); process.exitCode = 1; });", 'await main();');
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
