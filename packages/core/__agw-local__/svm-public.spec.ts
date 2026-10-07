/** Public named-IDL API against actual AGW/URP; destination/gateway are fixtures. */
import { PublicKey } from '@solana/web3.js';
import type { Idl } from '@coral-xyz/anchor';
import {
  encodeFunctionData,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { CHAIN, PushChain, type SolanaRule } from '../src';
import type { AgenticRuntime } from '../src/lib/agentic/runtime';
import { v4 } from '../src/lib/agentic/contracts/v4';
import { clearRegistry } from '../src/lib/orchestrator/svm-idl/registry';
import { startHarness, type Harness } from './harness';
const program = new PublicKey(Buffer.alloc(32, 51)).toBase58();
const gateway = new PublicKey(Buffer.alloc(32, 34)).toBase58();
const idl: Idl = {
  address: program,
  metadata: { name: 'named', version: '1', spec: '0.1.0' },
  instructions: [
    {
      name: 'deposit',
      discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
      accounts: [{ name: 'cea_authority', writable: true }],
      args: [{ name: 'amount', type: 'u64' }],
    },
  ],
};
const TOKEN = parseAbi([
  'function mint(address,uint256)',
  'function setSourceTokenAddress(string)',
  'function approve(address,uint256) returns (bool)',
]);
const CORE = parseAbi(['function setGasToken(string,address)']);
const rt = (c: PushChain) =>
  (c as unknown as { agenticRuntime: AgenticRuntime }).agenticRuntime;
describe('public Solana IDL rules on actual v4', () => {
  let h: Harness, owner: PushChain, token: Address;
  beforeAll(async () => {
    h = await startHarness(18561);
    owner = await h.client(0);
    token = await h.deploy(0, 'HarnessPRC20', 'HarnessFixtures.sol', [
      CHAIN.SOLANA_DEVNET,
      9,
    ]);
    await h.write(0, token, TOKEN, 'setSourceTokenAddress', ['']);
    await h.write(0, h.addresses.universalCore, CORE, 'setGasToken', [
      CHAIN.SOLANA_DEVNET,
      token,
    ]);
    configure(owner);
  });
  afterAll(async () => {
    clearRegistry();
    await h?.stop();
  });
  function configure(client: PushChain) {
    Object.assign(rt(client), {
      svmMetadata: {
        gateway: async (chain: string) => ({
          chainNamespace: chain,
          program: gateway,
        }),
        mint: async () => {
          throw new Error('native-only fixture');
        },
      },
      resolvePrc20: () => token,
      quoteOutbound: async () => ({
        protocolFee: BigInt(10) ** BigInt(14),
        nativeValueForGas: BigInt(10) ** BigInt(15),
        gasLimitUsed: BigInt(100000),
      }),
    });
  }
  const rule = (): SolanaRule => ({
    agent: h.wallets[1].account!.address,
    chainNamespace: CHAIN.SOLANA_DEVNET,
    validUntil: Math.floor(Date.now() / 1000) + 3600,
    maxGasPerCall: BigInt(10) ** BigInt(17),
    assets: [
      { token: zeroAddress, maxPerCall: BigInt(5), maxTotal: BigInt(10) },
    ],
    allowedInstructions: [
      {
        program,
        instruction: { idl, name: 'deposit' },
        accounts: [{ name: 'cea_authority', expected: { kind: 'walletCEA' } }],
        fields: [{ name: 'amount', max: BigInt(5) }],
      },
    ],
  });
  it('create/get/list/update/revoke use public named inputs and exact stored reads', async () => {
    const made = await owner.agentic.create('public-svm', { rules: [rule()] });
    const wallet = owner.agentic.wallet(made.wallet);
    const record = await wallet.rules.get(made.rulesIds[0]);
    expect(record).not.toHaveProperty('ref');
    expect(record.rule).toMatchObject({
      format: 'decoded',
      dataPins: [{ offset: 8, len: 8, mode: 2 }],
    });
    expect((await wallet.rules.list()).rules).toHaveLength(1);
    const update = await wallet.rules.update({
      rules: [{ rulesId: made.rulesIds[0], rule: rule() }],
    });
    expect(update.rules[0].rulesId).not.toBe(made.rulesIds[0]);
    await (await wallet.rules.revoke([update.rules[0].rulesId])).wait();
    expect((await wallet.rules.list()).rules).toHaveLength(0);
  });
  it('agent public send uses wallet context, mapped errors and replay metadata', async () => {
    const made = await owner.agentic.create('public-send', { rules: [rule()] });
    await h.publicClient.waitForTransactionReceipt({
      hash: await h.wallets[4].sendTransaction({
        to: made.wallet,
        value: BigInt(10) ** BigInt(18),
        account: h.wallets[4].account!,
        chain: h.wallets[4].chain,
      }),
    });
    await h.write(0, token, TOKEN, 'mint', [made.wallet, BigInt(20)]);
    await h.write(0, made.wallet, v4.abis.wallet, 'execute', [
      `0x${'00'.repeat(32)}`,
      v4.packSingle({
        target: token,
        value: BigInt(0),
        data: encodeFunctionData({
          abi: TOKEN,
          functionName: 'approve',
          args: [h.addresses.gateway, BigInt(20)],
        }),
      }),
    ]);
    const agent = await h.client(1, { agenticWallet: made.wallet });
    configure(agent);
    const data = (n: bigint) =>
      PushChain.utils.helpers.encodeTxData({
        abi: idl,
        functionName: 'deposit',
        args: [n],
      });
    const tx = await agent.universal.sendTransaction({
      to: { chain: CHAIN.SOLANA_DEVNET, address: program },
      data: data(BigInt(5)),
      value: BigInt(5),
    });
    expect(tx.from).toBe(made.wallet);
    expect(tx.agentic?.destinationInstruction?.data).toBe(data(BigInt(5)));
    expect(
      (await h.publicClient.getTransactionReceipt({ hash: tx.hash as Hex }))
        .status
    ).toBe('success');
    const { adaptTrackedResponse } = await import(
      '../src/lib/agentic/response'
    );
    const raw: typeof tx = {
      ...tx,
      agentic: undefined,
      from: tx.raw!.from,
      to: tx.raw!.to,
      data: tx.raw!.data,
    };
    await adaptTrackedResponse(rt(agent), raw);
    expect(raw.agentic?.destinationInstruction).toEqual(
      tx.agentic?.destinationInstruction
    );
    await expect(
      agent.universal.sendTransaction({
        to: { chain: CHAIN.SOLANA_DEVNET, address: program },
        data: data(BigInt(6)),
        value: BigInt(5),
      })
    ).rejects.toThrow('SvmDataCeilingExceeded');
  });
  it('owner sends use the wallet CEA without requiring an agent rule', async () => {
    const made = await owner.agentic.create('svm-owner', { rules: [] });
    await h.publicClient.waitForTransactionReceipt({
      hash: await h.wallets[4].sendTransaction({
        to: made.wallet,
        value: BigInt(10) ** BigInt(18),
        account: h.wallets[4].account!,
        chain: h.wallets[4].chain,
      }),
    });
    const sender = await h.client(0, { agenticWallet: made.wallet });
    configure(sender);
    const tx = await sender.universal.sendTransaction({
      to: { chain: CHAIN.SOLANA_DEVNET, address: program },
      data: PushChain.utils.helpers.encodeTxData({
        abi: idl,
        functionName: 'deposit',
        args: [BigInt(0)],
      }),
    });
    expect(tx.agentic?.door).toBe('owner');
    expect(tx.agentic?.rulesId).toBeUndefined();
    expect(
      (await h.publicClient.getTransactionReceipt({ hash: tx.hash as Hex }))
        .status
    ).toBe('success');
  });
  it('SPL and output mints derive protected wallet ATAs through public grants', async () => {
    const mint = new PublicKey(Buffer.alloc(32, 68)).toBase58();
    const output = new PublicKey(Buffer.alloc(32, 85)).toBase58();
    const spl = await h.deploy(0, 'HarnessPRC20', 'HarnessFixtures.sol', [
      CHAIN.SOLANA_DEVNET,
      6,
    ]);
    await h.write(0, spl, TOKEN, 'setSourceTokenAddress', [mint]);
    const source = await h.client(0);
    configure(source);
    Object.assign(rt(source), {
      resolvePrc20: () => spl,
      svmMetadata: {
        gateway: async (chain: string) => ({
          chainNamespace: chain,
          program: gateway,
        }),
        mint: async (_chain: string, address: string) => ({
          mint: address,
          tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        }),
      },
    });
    const input = rule();
    input.assets = [{ token: mint, maxPerCall: BigInt(5) }];
    input.outputTokens = [output];
    input.allowedInstructions[0].instruction = {
      idl: {
        ...idl,
        instructions: [
          {
            ...idl.instructions[0],
            accounts: [
              { name: 'cea_authority' },
              { name: 'inputAta', writable: true },
              { name: 'outputAta', writable: true },
            ],
          },
        ],
      },
      name: 'deposit',
    };
    input.allowedInstructions[0].accounts.push(
      { name: 'inputAta', expected: { kind: 'walletATA', token: mint } },
      { name: 'outputAta', expected: { kind: 'walletATA', token: output } }
    );
    const made = await source.agentic.create('public-spl', { rules: [input] });
    const read = await source.agentic
      .wallet(made.wallet)
      .rules.get(made.rulesIds[0]);
    if (!('format' in read.rule))
      throw new Error('expected decoded Solana rule');
    expect(read.rule.ceaAccounts).toHaveLength(3);
    expect(read.rule.pins.map((p) => p.expected)).toEqual(
      read.rule.ceaAccounts
    );
    expect(read.rule.assets[0].maxTotal).toBe(
      BigInt(2) ** BigInt(256) - BigInt(1)
    );
  });
  it('invalid named input and removed ref never submit a transaction', async () => {
    const before = await h.publicClient.getTransactionCount({
      address: h.wallets[0].account!.address,
    });
    const r = rule();
    r.allowedInstructions[0].accounts[0].name = 'typo';
    await expect(
      owner.agentic.create('invalid', { rules: [r] })
    ).rejects.toThrow('unknown IDL account');
    await expect(
      owner.agentic.create('removed-ref', {
        rules: [{ ...rule(), ref: `0x${'11'.repeat(32)}` } as never],
      })
    ).rejects.toThrow('ref is not supported');
    expect(
      await h.publicClient.getTransactionCount({
        address: h.wallets[0].account!.address,
      })
    ).toBe(before);
  });
});
