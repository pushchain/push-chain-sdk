/** Actual v5 AGW/URP/engine. Token/core/gateway and destination lookup are local fixtures; no bridge/TSS proof. */
import {
  encodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { CHAIN, type PushChain, type UniversalRule } from '../src';
import type { AgenticRuntime } from '../src/lib/agentic/runtime';
import { updateRules } from '../src/lib/agentic/management/rules-write';
import { createWallet } from '../src/lib/agentic/management/create';
import { configId } from '../src/lib/agentic/codec/ids';
import { UINT256_MAX } from '../src/lib/agentic/codec/defaults';
import { buildSession } from '../src/lib/agentic/codec/session';
import {
  encodeNativeTerms,
  nativeRuleToTerms,
} from '../src/lib/agentic/codec/native';
import { startHarness, type Harness } from './harness';

const TOKEN = parseAbi([
  'function mint(address,uint256)',
  'function approve(address,uint256) returns (bool)',
]);
const CORE = parseAbi([
  'function setGasToken(string,address)',
  'function getOutboundTxGasAndFees(address,uint256) view returns (address,uint256,uint256,uint256,string,uint256)',
]);
const CHAIN_NS = CHAIN.ETHEREUM_SEPOLIA;
const CEA = getAddress('0x000000000000000000000000000000000000cea1');
const DEST = getAddress('0x0000000000000000000000000000000000001234');
const internal = (c: PushChain) =>
  (c as unknown as { agenticRuntime: AgenticRuntime }).agenticRuntime;

describe('v5 multi-asset SDK management and execution', () => {
  let h: Harness, owner: PushChain, a: Address, b: Address;
  beforeAll(async () => {
    h = await startHarness(18551);
    owner = await h.client(0);
    a = await h.deploy(0, 'HarnessPRC20', 'HarnessFixtures.sol', [CHAIN_NS, 6]);
    b = await h.deploy(0, 'HarnessPRC20', 'HarnessFixtures.sol', [
      CHAIN_NS,
      18,
    ]);
    await h.write(0, h.addresses.universalCore, CORE, 'setGasToken', [
      CHAIN_NS,
      a,
    ]);
    configure(internal(owner));
  });
  afterAll(async () => {
    await h?.stop();
  });
  function configure(rt: AgenticRuntime) {
    // Fixture source token addresses equal fixture PRC20s; production uses the token registry.
    rt.resolvePrc20 = (token) =>
      getAddress(typeof token === 'string' ? token : token?.address ?? a);
    rt.resolveCEA = async () => ({ cea: CEA, isDeployed: false });
    rt.quoteOutbound = async (token, limit) => {
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
  function rule(
    assets: UniversalRule['assets'] = [
      { token: a, maxPerCall: BigInt(5), maxTotal: BigInt(7) },
      { token: b, maxPerCall: BigInt(9), maxTotal: BigInt(30) },
    ]
  ): UniversalRule {
    return {
      agent: h.wallets[1].account!.address,
      chainNamespace: CHAIN_NS,
      assets,
      validUntil: Math.floor(Date.now() / 1000) + 3600,
      maxGasPerCall: BigInt(10) ** BigInt(16),
      allowedCalls: [{ target: DEST, selector: 'increment()' }],
    };
  }
  async function setup(input = rule()) {
    const created = await owner.agentic.create('v5', { rules: [input] });
    const wallet = created.wallet,
      id = created.rulesIds[0];
    await h.publicClient.waitForTransactionReceipt({
      hash: await h.wallets[4].sendTransaction({
        account: h.wallets[4].account!,
        chain: h.wallets[4].chain,
        to: wallet,
        value: BigInt(10) ** BigInt(18),
      }),
    });
    for (const token of [a, b]) {
      await h.write(0, token, TOKEN, 'mint', [wallet, BigInt(1000)]);
      const w = await h.client(0, { agenticWallet: wallet });
      await (
        await w.universal.sendTransaction({
          to: token,
          data: encodeFunctionData({
            abi: TOKEN,
            functionName: 'approve',
            args: [h.addresses.gateway, BigInt(1000)],
          }),
        })
      ).wait();
    }
    const agent = await h.client(1, { agenticWallet: wallet });
    configure(internal(agent));
    const send = (token: Address, amount: bigint) =>
      agent.universal.sendTransaction({
        to: { address: DEST, chain: CHAIN_NS },
        funds: {
          amount,
          token: {
            symbol: 'fixture',
            decimals: 6,
            address: token,
            mechanism: 'approve',
          },
        },
        data: [{ to: DEST, data: '0xd09de08a', value: BigInt(0) }],
      });
    return { wallet, id, agent, send };
  }
  async function waitPush(
    tx: ReturnType<PushChain['universal']['sendTransaction']>
  ) {
    const response = await tx;
    return h.publicClient.waitForTransactionReceipt({
      hash: response.hash as Hex,
    });
  }
  async function stored(wallet: Address, id: Hex) {
    const [action] = await h.publicClient.readContract({
      address: h.addresses.engine,
      abi: h.generation.contracts.abis.engine,
      functionName: 'getEnabledActions',
      args: [wallet, id],
    });
    return h.publicClient.readContract({
      address: h.addresses.rulesPolicy,
      abi: h.generation.contracts.abis.policy,
      functionName: 'getConfig',
      args: [configId(wallet, id, action), wallet],
    });
  }
  it('public create encodes two ordered assets; public get reconstructs source-token caps', async () => {
    const { wallet, id } = await setup();
    expect((await stored(wallet, id)).assets.map((x) => x.token)).toEqual([
      a,
      b,
    ]);
    expect(
      (await owner.agentic.wallet(wallet).rules.get(id)).rule
    ).toMatchObject({
      assets: [
        { token: a, maxPerCall: BigInt(5), maxTotal: BigInt(7) },
        { token: b, maxPerCall: BigInt(9), maxTotal: BigInt(30) },
      ],
    });
  });
  it('a token from the wrong chain fails before deployment', async () => {
    const wrong = await h.deploy(0, 'HarnessPRC20', 'HarnessFixtures.sol', [
      'eip155:1',
      6,
    ]);
    const count = await h.publicClient.readContract({
      address: h.addresses.factory,
      abi: h.generation.contracts.abis.factory,
      functionName: 'walletCount',
      args: [h.wallets[0].account!.address],
    });
    await expect(
      owner.agentic.create('wrong-chain', {
        rules: [rule([{ token: wrong, maxPerCall: BigInt(1) }])],
      })
    ).rejects.toMatchObject({ code: 'ASSET_CHAIN_MISMATCH' });
    expect(
      await h.publicClient.readContract({
        address: h.addresses.factory,
        abi: h.generation.contracts.abis.factory,
        functionName: 'walletCount',
        args: [h.wallets[0].account!.address],
      })
    ).toBe(count);
  });
  it('a same-chain registry identity mismatch fails before deployment', async () => {
    const rt = internal(owner);
    const resolve = rt.resolvePrc20;
    rt.resolvePrc20 = () => b;
    try {
      await expect(
        owner.agentic.create('wrong-identity', {
          rules: [rule([{ token: a, maxPerCall: BigInt(1) }])],
        })
      ).rejects.toMatchObject({ code: 'INVALID_RULE' });
    } finally {
      rt.resolvePrc20 = resolve;
    }
  });
  it('both tokens execute under one rule and keep independent counters/limits', async () => {
    const { wallet, id, send } = await setup();
    await waitPush(send(a, BigInt(5)));
    await expect(send(a, BigInt(3))).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(TotalSpendCapExceeded)' },
    });
    await waitPush(send(b, BigInt(9)));
    expect((await stored(wallet, id)).assets.map((x) => x.spent)).toEqual([
      BigInt(5),
      BigInt(9),
    ]);
  });
  it('omitted total encodes maxUint256; explicit zero prohibits movement', async () => {
    const { wallet, id, send } = await setup(
      rule([
        { token: a, maxPerCall: BigInt(5) },
        { token: b, maxPerCall: BigInt(9), maxTotal: BigInt(0) },
      ])
    );
    expect((await stored(wallet, id)).assets.map((x) => x.maxTotal)).toEqual([
      UINT256_MAX,
      BigInt(0),
    ]);
    await expect(send(b, BigInt(1))).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(TotalSpendCapExceeded)' },
    });
    expect((await stored(wallet, id)).assets[1].spent).toBe(BigInt(0));
  });
  it('empty user assets grants one zero-cap gas token and executes a call-only request', async () => {
    const { wallet, id, send } = await setup(rule([]));
    expect((await stored(wallet, id)).assets).toEqual([
      {
        token: a,
        maxPerCall: BigInt(0),
        maxTotal: BigInt(0),
        spent: BigInt(0),
      },
    ]);
    await waitPush(send(a, BigInt(0)));
    await expect(send(a, BigInt(1))).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(AmountExceedsCap)' },
    });
  });
  it('public update resets both counters in one batch and records five checkpoints', async () => {
    const { wallet, id, send } = await setup();
    await waitPush(send(b, BigInt(4)));
    const count = await h.publicClient.readContract({
      address: wallet,
      abi: h.generation.contracts.abis.wallet,
      functionName: 'checkpointCount',
    });
    const result = await owner.agentic
      .wallet(wallet)
      .rules.update({ rules: [{ rulesId: id, rule: rule() }] });
    expect(
      (await stored(wallet, result.rules[0].rulesId)).assets.map((x) => x.spent)
    ).toEqual([BigInt(0), BigInt(0)]);
    expect(
      await h.publicClient.readContract({
        address: wallet,
        abi: h.generation.contracts.abis.wallet,
        functionName: 'checkpointCount',
      })
    ).toBe(count + BigInt(5));
  });
  it('spend on the second asset after snapshot rolls back revoke/grant and checkpoint writes', async () => {
    const { wallet, id, send } = await setup();
    const base = internal(owner);
    const count = await h.publicClient.readContract({
      address: wallet,
      abi: h.generation.contracts.abis.wallet,
      functionName: 'checkpointCount',
    });
    const racing = {
      ...base,
      execute: async (...args: Parameters<AgenticRuntime['execute']>) => {
        await waitPush(send(b, BigInt(1)));
        return base.execute(...args);
      },
    };
    await expect(
      updateRules(racing, h.generation, wallet, {
        rules: [{ rulesId: id, rule: rule() }],
      })
    ).rejects.toMatchObject({ decodedError: { name: 'AssetSpentMismatch' } });
    expect(
      await h.publicClient.readContract({
        address: h.addresses.engine,
        abi: h.generation.contracts.abis.engine,
        functionName: 'getPermissionIDs',
        args: [wallet],
      })
    ).toEqual([id]);
    expect(
      await h.publicClient.readContract({
        address: wallet,
        abi: h.generation.contracts.abis.wallet,
        functionName: 'checkpointCount',
      })
    ).toBe(count);
  });
  it('duplicate grants are allowed, but an ambiguous send fails before any signature', async () => {
    const created = await owner.agentic.create('multiple', {
      rules: [rule(), rule()],
    });
    expect(new Set(created.rulesIds).size).toBe(2);
    const agent = await h.client(1, { agenticWallet: created.wallet });
    await expect(
      agent.universal.sendTransaction({
        to: { address: DEST, chain: CHAIN_NS },
        data: '0xd09de08a',
      })
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_RULE' });
  });
  it('a legacy two-field envelope is refused by the actual v5 grant path', async () => {
    const bare = await owner.agentic.create('old-envelope', { rules: [] });
    const { encodeAbiParameters } = await import('viem');
    const terms = nativeRuleToTerms(
      {
        agent: h.wallets[1].account!.address,
        target: h.addresses.target,
        selector: 'increment()',
        validUntil: Math.floor(Date.now() / 1000) + 3600,
      },
      { nowSeconds: 0 }
    ).terms;
    const session = buildSession({
      validator: h.addresses.validator,
      rulesPolicy: h.addresses.rulesPolicy,
      agent: h.wallets[1].account!.address,
      actions: [
        {
          target: terms.target,
          selector: terms.selector,
          initData: encodeAbiParameters(
            [{ type: 'string' }, { type: 'bytes' }],
            ['eip155:9000', encodeNativeTerms(terms)]
          ),
        },
      ],
    });
    await expect(
      h.publicClient.simulateContract({
        address: bare.wallet,
        abi: h.generation.contracts.abis.wallet,
        functionName: 'grantRules',
        args: [session as never],
        account: h.wallets[0].account!.address,
      })
    ).rejects.toMatchObject({
      cause: { data: { errorName: 'Panic', args: [BigInt(65)] } },
    });
    expect(
      await h.publicClient.readContract({
        address: h.addresses.engine,
        abi: h.generation.contracts.abis.engine,
        functionName: 'getPermissionIDs',
        args: [bare.wallet],
      })
    ).toEqual([]);
  });
});
