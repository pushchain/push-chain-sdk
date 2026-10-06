/** Internal SVM lifecycle/execution on actual v4 contracts; no Solana/TSS simulation. */
import { PublicKey } from '@solana/web3.js';
import {
  encodeFunctionData,
  encodeErrorResult,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { CHAIN, type PushChain } from '../src';
import type { AgenticRuntime } from '../src/lib/agentic/runtime';
import { Snapshot } from '../src/lib/agentic/reads/snapshot';
import { readSvmRule } from '../src/lib/agentic/reads/svm';
import {
  grantSvmWire,
  prepareSvmReplacement,
  replaceSvmWire,
  type SvmWireGrant,
} from '../src/lib/agentic/management/svm';
import {
  resolveSvmContext,
  type SvmMetadataProvider,
} from '../src/lib/agentic/management/svm-context';
import {
  prepareSvmAgentExecution,
  sendSvmAgentWire,
} from '../src/lib/agentic/execution/svm-send';
import {
  registerIdl,
  clearRegistry,
} from '../src/lib/orchestrator/svm-idl/registry';
import { v4 } from '../src/lib/agentic/contracts/v4';
import { wrapSendError } from '../src/lib/agentic/management/common';
import { startHarness, type Harness } from './harness';

const key = (b: string) => `0x${b.repeat(32)}` as Hex;
const GATEWAY = key('22'),
  PROGRAM = key('33'),
  MINT = key('44'),
  MINT2 = key('55');
const SPL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  TOKEN2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const TOKEN = parseAbi([
  'function mint(address,uint256)',
  'function approve(address,uint256) returns (bool)',
  'function setSourceTokenAddress(string)',
  'function setSourceChainNamespace(string)',
]);
const CORE = parseAbi([
  'function setGasToken(string,address)',
  'function getOutboundTxGasAndFees(address,uint256) view returns (address,uint256,uint256,uint256,string,uint256)',
]);
const rt = (c: PushChain) =>
  (c as unknown as { agenticRuntime: AgenticRuntime }).agenticRuntime;
const metadata: SvmMetadataProvider = {
  gateway: async (chain) => ({ chainNamespace: chain, program: GATEWAY }),
  mint: async (_chain, address) => ({
    mint: address,
    tokenProgram: address === MINT2 ? TOKEN2022 : SPL,
  }),
};

describe('internal prepared SVM backend on v4', () => {
  let h: Harness, owner: PushChain, tokens: Address[];
  beforeAll(async () => {
    h = await startHarness(18554);
    owner = await h.client(0);
    tokens = [];
    for (const source of ['', MINT, MINT2]) {
      const token = await h.deploy(0, 'HarnessPRC20', 'HarnessFixtures.sol', [
        CHAIN.SOLANA_DEVNET,
        9,
      ]);
      await h.write(0, token, TOKEN, 'setSourceTokenAddress', [source]);
      tokens.push(token);
    }
    await h.write(0, h.addresses.universalCore, CORE, 'setGasToken', [
      CHAIN.SOLANA_DEVNET,
      tokens[0],
    ]);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    clearRegistry();
  });
  afterAll(async () => h?.stop());
  const cfg = async (wallet: Address, id: Hex) =>
    readSvmRule(
      await Snapshot.at(rt(owner).reader),
      h.generation,
      wallet,
      id,
      rt(owner).pushChainNamespace
    );
  function configure(runtime: AgenticRuntime) {
    runtime.quoteOutbound = async (token, limit) => {
      const [, nativeValueForGas, protocolFee, , , gasLimitUsed] =
        await h.publicClient.readContract({
          address: h.addresses.universalCore,
          abi: CORE,
          functionName: 'getOutboundTxGasAndFees',
          args: [token, limit],
        });
      return { nativeValueForGas, protocolFee, gasLimitUsed };
    };
  }
  async function setup() {
    const { wallet } = await owner.agentic.create('svm-backend', { rules: [] });
    const caps = tokens.map((token) => ({
      token,
      maxPerCall: BigInt(5),
      maxTotal: BigInt(10),
    }));
    const resolved = await resolveSvmContext(
      await Snapshot.at(rt(owner).reader),
      wallet,
      CHAIN.SOLANA_DEVNET,
      caps,
      metadata
    );
    const terms = {
      ...resolved,
      validUntil: Math.floor(Date.now() / 1000) + 3600,
      maxGasPerCall: BigInt(10) ** BigInt(16),
      programs: [
        {
          program: PROGRAM,
          discriminator: '0x0102030405060708' as Hex,
          discriminatorLen: 8,
          dataless: false,
          maxAccounts: 3,
        },
      ],
      pins: resolved.ceaAccounts.map((expected, accountIndex) => ({
        ruleIndex: 0,
        accountIndex,
        expected,
      })),
      dataPins: [],
    };
    const input: SvmWireGrant = {
      agent: h.wallets[1].account!.address,
      chainNamespace: CHAIN.SOLANA_DEVNET,
      terms,
    };
    const grant = await grantSvmWire(rt(owner), h.generation, wallet, input);
    registerIdl({
      address: new PublicKey(Buffer.from(PROGRAM.slice(2), 'hex')).toBase58(),
      metadata: { name: 'fixture', version: '1', spec: '0.1.0' },
      instructions: [
        {
          name: 'go',
          discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
          accounts: [
            { name: 'cea_authority', writable: true },
            ...resolved.ceaAccounts.slice(1).map((k, i) => ({
              name: `ata${i}`,
              writable: true,
              address: new PublicKey(Buffer.from(k.slice(2), 'hex')).toBase58(),
            })),
          ],
          args: [],
        },
      ],
    });
    await h.publicClient.waitForTransactionReceipt({
      hash: await h.wallets[4].sendTransaction({
        to: wallet,
        value: BigInt(10) ** BigInt(18),
        account: h.wallets[4].account!,
        chain: h.wallets[4].chain,
      }),
    });
    for (const token of tokens) {
      await h.write(0, token, TOKEN, 'mint', [wallet, BigInt(100)]);
      await h.write(0, wallet, v4.abis.wallet, 'execute', [
        key('00'),
        v4.packSingle({
          target: token,
          value: BigInt(0),
          data: encodeFunctionData({
            abi: TOKEN,
            functionName: 'approve',
            args: [h.addresses.gateway, BigInt(100)],
          }),
        }),
      ]);
    }
    const agent = await h.client(1);
    configure(rt(agent));
    const request = (token = tokens[2], amount = BigInt(5)) => ({
      wallet,
      rulesId: grant.rulesId,
      token,
      amount,
      gasLimit: BigInt(200_000),
      program: PROGRAM,
      instructionData: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    });
    return { wallet, id: grant.rulesId, input, agent, request };
  }
  it('reads all source assets/counters/pins losslessly while public SVM remains gated', async () => {
    const s = await setup(),
      stored = await cfg(s.wallet, s.id);
    expect(stored.config.assets.map((a) => a.token)).toEqual(tokens);
    expect(stored.config.assets.map((a) => a.spent)).toEqual([
      BigInt(0),
      BigInt(0),
      BigInt(0),
    ]);
    expect(stored.config.pins).toEqual(s.input.terms.pins);
    expect(stored.chainNamespace).toBe(CHAIN.SOLANA_DEVNET);
    await expect(
      owner.agentic.wallet(s.wallet).rules.get(s.id)
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
  });
  it('runs context, IDL, quote, allowance, wrapping and real token pull/burn as the agent', async () => {
    const s = await setup();
    const sent = await sendSvmAgentWire(
      rt(s.agent),
      h.generation,
      s.request(),
      metadata
    );
    expect((await sent.tx.wait()).status).toBe(1);
    const root = await h.publicClient.getTransactionReceipt({
      hash: sent.tx.hash as Hex,
    });
    expect(root.from).toBe(h.wallets[1].account!.address.toLowerCase());
    expect(
      (await cfg(s.wallet, s.id)).config.assets.map((a) => a.spent)
    ).toEqual([BigInt(0), BigInt(0), BigInt(5)]);
  });
  it('refuses the wrong signer before execute', async () => {
    const s = await setup(),
      execute = jest.spyOn(rt(owner), 'execute');
    await expect(
      prepareSvmAgentExecution(rt(owner), h.generation, s.request(), metadata)
    ).rejects.toMatchObject({ code: 'NOT_OWNER_OR_AGENT' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('requires separate allowance and never writes an approval on the agent path', async () => {
    const s = await setup();
    await h.write(0, s.wallet, v4.abis.wallet, 'execute', [
      key('00'),
      v4.packSingle({
        target: tokens[2],
        value: BigInt(0),
        data: encodeFunctionData({
          abi: TOKEN,
          functionName: 'approve',
          args: [h.addresses.gateway, BigInt(0)],
        }),
      }),
    ]);
    const execute = jest.spyOn(rt(s.agent), 'execute');
    await expect(
      sendSvmAgentWire(rt(s.agent), h.generation, s.request(), metadata)
    ).rejects.toMatchObject({ code: 'GATEWAY_ALLOWANCE_INSUFFICIENT' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('atomically replaces and resets every asset, recording five checkpoints', async () => {
    const s = await setup();
    await (
      await sendSvmAgentWire(rt(s.agent), h.generation, s.request(), metadata)
    ).tx.wait();
    const before = await h.publicClient.readContract({
      address: s.wallet,
      abi: v4.abis.wallet,
      functionName: 'checkpointCount',
    });
    const next = await replaceSvmWire(
      rt(owner),
      h.generation,
      s.wallet,
      s.id,
      s.input
    );
    expect(
      (await cfg(s.wallet, next.rulesId)).config.assets.map((a) => a.spent)
    ).toEqual([BigInt(0), BigInt(0), BigInt(0)]);
    await expect(cfg(s.wallet, s.id)).rejects.toMatchObject({
      code: 'RULE_NOT_FOUND',
    });
    expect(
      await h.publicClient.readContract({
        address: s.wallet,
        abi: v4.abis.wallet,
        functionName: 'checkpointCount',
      })
    ).toBe(before + BigInt(5));
  });
  it('a second-asset spend after snapshot rolls back revoke/grant/checkpoints', async () => {
    const s = await setup(),
      prepared = await prepareSvmReplacement(
        rt(owner),
        h.generation,
        s.wallet,
        s.id,
        s.input
      );
    await (
      await sendSvmAgentWire(
        rt(s.agent),
        h.generation,
        s.request(tokens[1]),
        metadata
      )
    ).tx.wait();
    const before = await h.publicClient.readContract({
      address: s.wallet,
      abi: v4.abis.wallet,
      functionName: 'checkpointCount',
    });
    const error = await rt(owner)
      .execute({ to: s.wallet, value: BigInt(0), data: prepared.data })
      .catch(wrapSendError);
    expect(error).toMatchObject({
      decodedError: { name: 'AssetSpentMismatch' },
    });
    expect((await cfg(s.wallet, s.id)).config.assets[1].spent).toBe(BigInt(5));
    expect(
      await h.publicClient.readContract({
        address: s.wallet,
        abi: v4.abis.wallet,
        functionName: 'checkpointCount',
      })
    ).toBe(before);
  });
  it('grant initialization failure after revoke rolls back the old rule', async () => {
    const s = await setup();
    const alternate = await h.deploy(0, 'HarnessPRC20', 'HarnessFixtures.sol', [
      CHAIN.SOLANA_DEVNET,
      9,
    ]);
    const input = {
      ...s.input,
      terms: {
        ...s.input.terms,
        assets: [
          { token: alternate, maxPerCall: BigInt(5), maxTotal: BigInt(10) },
        ],
      },
    };
    const prepared = await prepareSvmReplacement(
      rt(owner),
      h.generation,
      s.wallet,
      s.id,
      input
    );
    await h.write(0, alternate, TOKEN, 'setSourceChainNamespace', [
      CHAIN.ETHEREUM_SEPOLIA,
    ]);
    const error = await rt(owner)
      .execute({ to: s.wallet, value: BigInt(0), data: prepared.data })
      .catch(wrapSendError);
    expect(error).toMatchObject({ decodedError: { name: 'ChainMismatch' } });
    expect((await cfg(s.wallet, s.id)).config.assets).toHaveLength(3);
  });
  it('generic owner revocation disables a SVM rule without public decoding', async () => {
    const s = await setup();
    await (await owner.agentic.wallet(s.wallet).rules.revoke([s.id])).wait();
    await expect(cfg(s.wallet, s.id)).rejects.toMatchObject({
      code: 'RULE_NOT_FOUND',
    });
  });
  it('returns the receipt ID when another owner grant advances the nonce during replacement', async () => {
    const s = await setup(),
      execute = rt(owner).execute;
    let intercepted = false;
    rt(owner).execute = async (params, opts) => {
      if (!intercepted) {
        intercepted = true;
        await grantSvmWire(rt(owner), h.generation, s.wallet, s.input);
      }
      return execute(params, opts);
    };
    try {
      const next = await replaceSvmWire(
        rt(owner),
        h.generation,
        s.wallet,
        s.id,
        s.input
      );
      expect((await cfg(s.wallet, next.rulesId)).config.assets).toHaveLength(3);
      await expect(cfg(s.wallet, s.id)).rejects.toMatchObject({
        code: 'RULE_NOT_FOUND',
      });
    } finally {
      rt(owner).execute = execute;
    }
  });
  it.each(['allowance', 'balance', 'revocation'])(
    'on-chain %s change after preflight refuses submission without metering',
    async (kind) => {
      const s = await setup(),
        runtime = rt(s.agent),
        original = runtime.execute;
      const before = await cfg(s.wallet, s.id);
      const nonce = await h.publicClient.getTransactionCount({
        address: h.wallets[1].account!.address,
        blockTag: 'pending',
      });
      let ticks: bigint | undefined;
      runtime.execute = async (params, options) => {
        if (kind === 'revocation')
          await (
            await owner.agentic.wallet(s.wallet).rules.revoke([s.id])
          ).wait();
        else
          await h.write(0, s.wallet, v4.abis.wallet, 'execute', [
            key('00'),
            v4.packSingle({
              target: tokens[2],
              value: BigInt(0),
              data: encodeFunctionData({
                abi: parseAbi([
                  'function approve(address,uint256) returns(bool)',
                  'function transfer(address,uint256) returns(bool)',
                ]),
                functionName: kind === 'allowance' ? 'approve' : 'transfer',
                args: [
                  kind === 'allowance'
                    ? h.addresses.gateway
                    : h.wallets[0].account!.address,
                  kind === 'allowance' ? BigInt(0) : BigInt(100),
                ],
              }),
            }),
          ]);
        ticks = await h.publicClient.readContract({
          address: s.wallet,
          abi: v4.abis.wallet,
          functionName: 'checkpointCount',
        });
        return original(params, options);
      };
      try {
        const error = await sendSvmAgentWire(
          runtime,
          h.generation,
          s.request(),
          metadata
        ).catch((e) => e);
        expect(error.name).toBe('AgenticRevertError');
        if (kind === 'revocation')
          expect(error.decodedError?.name).toBe('CallerIsNotAgent');
        else {
          const name = kind === 'allowance' ? 'LowAllowance' : 'LowBalance';
          const data = encodeErrorResult({
            abi: parseAbi([`error ${name}()`]),
            errorName: name,
          });
          expect(error.message).toContain(data);
        }
        const stored = await h.publicClient.readContract({
          address: h.addresses.rulesPolicy,
          abi: v4.abis.policy,
          functionName: 'getSvmConfig',
          args: [before.configId, s.wallet],
        });
        expect(stored.assets.map((a) => a.spent)).toEqual([
          BigInt(0),
          BigInt(0),
          BigInt(0),
        ]);
        expect(
          await h.publicClient.getTransactionCount({
            address: h.wallets[1].account!.address,
            blockTag: 'pending',
          })
        ).toBe(nonce);
        expect(
          await h.publicClient.readContract({
            address: s.wallet,
            abi: v4.abis.wallet,
            functionName: 'checkpointCount',
          })
        ).toBe(ticks);
      } finally {
        runtime.execute = original;
      }
    }
  );
  it('an RPC outage during rule reads fails before execute or signing', async () => {
    const s = await setup(),
      runtime = rt(s.agent),
      reader = runtime.reader,
      read = reader.readContract.bind(reader);
    const execute = jest.spyOn(runtime, 'execute');
    const failedReader = {
      ...reader,
      readContract: async (args: Parameters<typeof read>[0]) => {
        if (args.functionName === 'getSvmConfig')
          throw new Error('fixture RPC outage');
        return read(args);
      },
    };
    const failed = { ...runtime, reader: failedReader };
    await expect(
      sendSvmAgentWire(failed, h.generation, s.request(), metadata)
    ).rejects.toMatchObject({ code: 'RULE_READ_FAILED' });
    expect(execute).not.toHaveBeenCalled();
    expect(
      (await cfg(s.wallet, s.id)).config.assets.map((a) => a.spent)
    ).toEqual([BigInt(0), BigInt(0), BigInt(0)]);
  });
  it('receipt failure after a mined grant retains the hash and does not retry', async () => {
    const s = await setup(),
      runtime = rt(owner),
      original = runtime.execute;
    let hash: Hex | undefined,
      submissions = 0;
    runtime.execute = async (params, options) => {
      submissions++;
      const tx = await original(params, options);
      hash = tx.hash as Hex;
      await h.publicClient.waitForTransactionReceipt({ hash });
      tx.wait = async () => {
        throw new Error('fixture receipt outage');
      };
      return tx;
    };
    try {
      await expect(
        grantSvmWire(runtime, h.generation, s.wallet, s.input)
      ).rejects.toMatchObject({
        code: 'RECEIPT_UNAVAILABLE',
        details: { txHash: expect.any(String) },
      });
      expect(submissions).toBe(1);
      expect(hash).toBeDefined();
      expect(
        await h.publicClient.readContract({
          address: s.wallet,
          abi: v4.abis.wallet,
          functionName: 'grantNonce',
        })
      ).toBe(BigInt(2));
      expect(
        (await h.publicClient.getTransactionReceipt({ hash: hash! })).status
      ).toBe('success');
    } finally {
      runtime.execute = original;
    }
  });
});
