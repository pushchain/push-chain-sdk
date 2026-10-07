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
import { CHAIN, PushChain, AgenticRevertError, type SolanaRule } from '../src';
import type { AgenticRuntime } from '../src/lib/agentic/runtime';
import { v5 } from '../src/lib/agentic/contracts/v5';
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
describe('public Solana IDL rules on actual v5', () => {
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
    await h.write(0, made.wallet, v5.abis.wallet, 'execute', [
      `0x${'00'.repeat(32)}`,
      v5.packSingle({
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
    ).rejects.toMatchObject({
      name: 'AgenticRevertError',
      decodedError: { name: 'PolicyCheckReverted(SvmDataCeilingExceeded)' },
    });
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
  it('owner funds-only sends use an empty payload and preserve transfer metadata in replay', async () => {
    const made = await owner.agentic.create('svm-owner-transfer', {
      rules: [],
    });
    await h.publicClient.waitForTransactionReceipt({
      hash: await h.wallets[4].sendTransaction({
        to: made.wallet,
        value: BigInt(10) ** BigInt(18),
        account: h.wallets[4].account!,
        chain: h.wallets[4].chain,
      }),
    });
    await h.write(0, token, TOKEN, 'mint', [made.wallet, BigInt(10)]);
    await h.write(0, made.wallet, v5.abis.wallet, 'execute', [
      `0x${'00'.repeat(32)}`,
      v5.packSingle({
        target: token,
        value: BigInt(0),
        data: encodeFunctionData({
          abi: TOKEN,
          functionName: 'approve',
          args: [h.addresses.gateway, BigInt(10)],
        }),
      }),
    ]);
    const sender = await h.client(0, { agenticWallet: made.wallet });
    configure(sender);
    clearRegistry(); // A simple transfer needs no program IDL.
    const tx = await sender.universal.sendTransaction({
      to: { chain: CHAIN.SOLANA_DEVNET, address: program },
      value: BigInt(5),
    });
    expect(tx.to).toBe('0x' + Buffer.alloc(32, 51).toString('hex'));
    expect(tx.value).toBe(BigInt(5));
    expect(tx.agentic?.destinationInstruction).toBeUndefined();
    expect(tx.agentic?.destinationTransfer).toMatchObject({
      token,
      amount: BigInt(5),
    });
    const raw: typeof tx = {
      ...tx,
      agentic: undefined,
      from: tx.raw!.from,
      to: tx.raw!.to,
      data: tx.raw!.data,
      route: 'UOA_TO_PUSH',
    };
    const { adaptTrackedResponse } = await import(
      '../src/lib/agentic/response'
    );
    await adaptTrackedResponse(rt(sender), raw);
    expect(raw.to).toBe(tx.to);
    expect(raw.data).toBe('0x');
    expect(raw.value).toBe(BigInt(5));
    expect(raw.agentic?.destinationTransfer).toEqual(
      tx.agentic?.destinationTransfer
    );
    expect(raw.route).toBe('UOA_TO_CEA');
    const baseReader = rt(sender).reader;
    const unavailable = {
      ...baseReader,
      readContract: async (
        params: Parameters<typeof baseReader.readContract>[0]
      ) => {
        if (params.functionName === 'gasTokenPRC20ByChainNamespace')
          throw new Error('historical metadata unavailable');
        return baseReader.readContract(params);
      },
    };
    const fallback: typeof tx = {
      ...tx,
      agentic: undefined,
      from: tx.raw!.from,
      to: tx.raw!.to,
      data: tx.raw!.data,
      route: 'UOA_TO_PUSH',
    };
    await adaptTrackedResponse(
      { network: rt(sender).network, reader: unavailable },
      fallback
    );
    expect(fallback.route).toBe('UOA_TO_CEA');
    expect(fallback.agentic?.destinationTransfer).toBeUndefined();

    expect(
      (await h.publicClient.getTransactionReceipt({ hash: tx.hash as Hex }))
        .status
    ).toBe('success');
  });
  it('actual policy refusals return mapped contract errors and preserve counters', async () => {
    const made = await owner.agentic.create('svm-policy-errors', {
      rules: [rule()],
    });
    await h.publicClient.waitForTransactionReceipt({
      hash: await h.wallets[4].sendTransaction({
        to: made.wallet,
        value: BigInt(10) ** BigInt(18),
        account: h.wallets[4].account!,
        chain: h.wallets[4].chain,
      }),
    });
    const agent = await h.client(1, { agenticWallet: made.wallet });
    configure(agent);
    const handle = owner.agentic.wallet(made.wallet),
      before = await handle.rules.get(made.rulesIds[0]);
    const error = await agent.universal
      .sendTransaction({
        to: { chain: CHAIN.SOLANA_DEVNET, address: program },
        data: PushChain.utils.helpers.encodeTxData({
          abi: idl,
          functionName: 'deposit',
          args: [BigInt(6)],
        }),
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(AgenticRevertError);
    expect(error.decodedError.name).toBe(
      'PolicyCheckReverted(SvmDataCeilingExceeded)'
    );
    expect(await handle.rules.get(made.rulesIds[0])).toEqual(before);
    await expect(
      agent.universal.sendTransaction({
        to: { chain: CHAIN.SOLANA_DEVNET, address: program },
        value: BigInt(1),
      })
    ).rejects.toMatchObject({ code: 'INVALID_RULE' });
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
    await h.publicClient.waitForTransactionReceipt({
      hash: await h.wallets[4].sendTransaction({
        to: made.wallet,
        value: BigInt(10) ** BigInt(18),
        account: h.wallets[4].account!,
        chain: h.wallets[4].chain,
      }),
    });
    await h.write(0, spl, TOKEN, 'mint', [made.wallet, BigInt(10)]);
    await h.write(0, made.wallet, v5.abis.wallet, 'execute', [
      `0x${'00'.repeat(32)}`,
      v5.packSingle({
        target: spl,
        value: BigInt(0),
        data: encodeFunctionData({
          abi: TOKEN,
          functionName: 'approve',
          args: [h.addresses.gateway, BigInt(10)],
        }),
      }),
    ]);
    const sender = await h.client(0, { agenticWallet: made.wallet });
    Object.assign(rt(sender), {
      svmMetadata: rt(source).svmMetadata,
      resolvePrc20: rt(source).resolvePrc20,
      quoteOutbound: rt(source).quoteOutbound,
    });
    const quote = jest.spyOn(rt(sender), 'quoteOutbound');
    const tx = await sender.universal.sendTransaction({
      to: { chain: CHAIN.SOLANA_DEVNET, address: program },
      funds: {
        token: {
          address: mint,
          symbol: 'MOCK',
          decimals: 6,
          mechanism: 'approve',
        },
        amount: BigInt(5),
      },
    });
    expect(tx.value).toBe(BigInt(0));
    expect(tx.agentic?.destinationTransfer).toMatchObject({
      token: spl,
      amount: BigInt(5),
    });
    expect(quote.mock.calls[0][3]).toMatchObject({
      wallet: made.wallet,
      splMintBase58: mint,
      burnAmount: BigInt(5),
    });
    expect(
      (await h.publicClient.getTransactionReceipt({ hash: tx.hash as Hex }))
        .status
    ).toBe('success');
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
  it('the contract rejects an outbound above its PC cap through the same error mapper', async () => {
    const input = rule();
    input.maxGasPerCall = BigInt(1);
    const made = await owner.agentic.create('svm-pc-cap', { rules: [input] });
    await h.publicClient.waitForTransactionReceipt({
      hash: await h.wallets[4].sendTransaction({
        to: made.wallet,
        value: BigInt(10) ** BigInt(18),
        account: h.wallets[4].account!,
        chain: h.wallets[4].chain,
      }),
    });
    const agent = await h.client(1, { agenticWallet: made.wallet });
    configure(agent);
    const error = await agent.universal
      .sendTransaction({
        to: { chain: CHAIN.SOLANA_DEVNET, address: program },
        data: PushChain.utils.helpers.encodeTxData({
          abi: idl,
          functionName: 'deposit',
          args: [BigInt(0)],
        }),
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(AgenticRevertError);
    expect(error.decodedError.name).toBe(
      'PolicyCheckReverted(PCValueExceedsCap)'
    );
  });
  it('expired SVM permissions are refused by the actual contract rather than a local policy check', async () => {
    const input = rule();
    input.validUntil =
      Number((await h.publicClient.getBlock()).timestamp) + 120;
    const made = await owner.agentic.create('svm-expired', { rules: [input] });
    await h.publicClient.waitForTransactionReceipt({
      hash: await h.wallets[4].sendTransaction({
        to: made.wallet,
        value: BigInt(10) ** BigInt(18),
        account: h.wallets[4].account!,
        chain: h.wallets[4].chain,
      }),
    });
    const agent = await h.client(1, { agenticWallet: made.wallet });
    configure(agent);
    await h.publicClient.request({
      method: 'evm_setNextBlockTimestamp' as never,
      params: [input.validUntil + 1] as never,
    });
    await h.publicClient.request({ method: 'evm_mine' as never });
    const error = await agent.universal
      .sendTransaction({
        to: { chain: CHAIN.SOLANA_DEVNET, address: program },
        data: PushChain.utils.helpers.encodeTxData({
          abi: idl,
          functionName: 'deposit',
          args: [BigInt(0)],
        }),
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(AgenticRevertError);
    expect(error.decodedError.name).toBe('PolicyCheckReverted(RulesExpired)');
  });
});
