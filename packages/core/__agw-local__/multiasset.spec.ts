import { agenticPresets } from '../src/lib/agentic/presets';
import * as accountLookup from '../src/lib/universal/account/account';
import { buildPresetApi } from '../src/lib/agentic/presets';
import { publicRules } from '../src/lib/agentic/public-rule';
/** Actual v6 AGW/URP/engine. Token/core/gateway and destination lookup are local fixtures; no bridge/TSS proof. */
import {
  encodeFunctionData,
  getAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { CHAIN, type PushChain, type Rule } from '../src';
import type { AgenticRuntime } from '../src/lib/agentic/runtime';
import { updateRules } from '../src/lib/agentic/management/rules-write';
import { createWallet } from '../src/lib/agentic/management/create';
import { configId } from '../src/lib/agentic/codec/ids';
import { prepareWalletRules } from '../src/lib/agentic/management/prepare';
import { Snapshot } from '../src/lib/agentic/reads/snapshot';
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

describe('v6 multi-asset SDK management and execution', () => {
  let h: Harness, owner: PushChain, a: Address, b: Address;
  let originLookup: jest.SpyInstance;
  beforeAll(async () => {
    // This harness deploys no UEA factory; its receivers are local contracts.
    // Keep actual AGW/RPC execution while isolating response-origin metadata.
    originLookup = jest
      .spyOn(accountLookup, 'convertExecutorToOrigin')
      .mockResolvedValue({ account: null, exists: false });
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
    try {
      await h?.stop();
    } finally {
      originLookup?.mockRestore();
    }
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
    assets: Rule['assets'] = [
      { token: a, maxPerCall: BigInt(5), maxTotal: BigInt(7) },
      { token: b, maxPerCall: BigInt(9), maxTotal: BigInt(30) },
    ]
  ): Rule {
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
    const created = await owner.agentic.create('v6', { rules: [input] });
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
  it('v6 EVM alternatives enforce both spender and MAX, and reads update losslessly', async () => {
    const input = rule();
    input.allowedCalls = [DEST, CEA].map((spender) => ({
      target: a,
      selector: 'approve(address,uint256)',
      pins: [
        { arg: 0, expected: spender },
        { arg: 1, max: BigInt(5) },
      ],
    }));
    const { wallet, id, agent } = await setup(input);
    const send = (spender: Address, amount: bigint) =>
      agent.universal.sendTransaction({
        to: { address: a, chain: CHAIN_NS },
        data: [
          {
            to: a,
            value: BigInt(0),
            data: encodeFunctionData({
              abi: TOKEN,
              functionName: 'approve',
              args: [spender, amount],
            }),
          },
        ],
      });
    await waitPush(send(DEST, BigInt(5)));
    await waitPush(send(CEA, BigInt(4)));
    await expect(
      send(h.wallets[3].account!.address, BigInt(1))
    ).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(ArgPinMismatch)' },
    });
    await expect(send(DEST, BigInt(6))).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(ArgPinAboveMax)' },
    });
    const handle = owner.agentic.wallet(wallet),
      record = await handle.rules.get(id);
    expect((record.rule as Rule).allowedCalls).toHaveLength(2);
    const updated = await handle.rules.update({
      rules: [
        {
          rulesId: id,
          rule: { ...record.rule, validUntil: record.validUntil + 60 },
        },
      ],
    });
    expect((await handle.rules.get(updated.rules[0].rulesId)).rule).toEqual({
      ...record.rule,
      validUntil: record.validUntil + 60,
    });
  });
  it('v6 refuses a bare alternative that bypasses a pinned function and too many initial rules', async () => {
    const input = rule();
    input.allowedCalls = [
      { target: DEST, selector: 'increment()', pins: [] },
      {
        target: DEST,
        selector: 'increment()',
        pins: [{ arg: 0, max: BigInt(1) }],
      },
    ];
    await expect(
      owner.agentic.create('bypass', { rules: [input] })
    ).rejects.toMatchObject({ code: 'INVALID_RULE' });
    const rules = Array.from({ length: 9 }, (_, i) => ({
      ...rule(),
      agent: getAddress(`0x${(100 + i).toString(16).padStart(40, '0')}`),
    }));
    const before = await owner.agentic.derive();
    await expect(
      owner.agentic.create('too-many', { rules })
    ).rejects.toMatchObject({ code: 'INVALID_RULE' });
    expect(await owner.agentic.derive()).toEqual(before);
  });

  const presetOptions = (maxPerCall: bigint) => ({
    chainNamespace: CHAIN_NS,
    agent: h.wallets[1].account!.address,
    validUntil: Math.floor(Date.now() / 1000) + 3600,
    maxGasPerCall: BigInt(10) ** BigInt(16),
    assets: [{ token: zeroAddress, maxPerCall, maxTotal: BigInt(40) }],
  });
  const PRESET_ABI = parseAbi([
    'function deposit() payable',
    'function approve(address,uint256) returns (bool)',
    'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) returns (uint256)',
    'function supply(address,uint256,address,uint16)',
  ]);
  // Native ETH funds the wallet's destination account; the rule caps the wrap value.
  const wrapCall = (weth: Address, value: bigint) => ({
    to: weth,
    value,
    data: encodeFunctionData({ abi: PRESET_ABI, functionName: 'deposit' }),
  });
  const approveCall = (token: Address, spender: Address, amount: bigint) => ({
    to: token,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: PRESET_ABI,
      functionName: 'approve',
      args: [spender, amount],
    }),
  });
  it('the shipped DEX catalog enforces the wrap value, tuple receiver/token and amount pins on actual v6 URP', async () => {
    const { rules } = agenticPresets.get('DEXES', presetOptions(BigInt(5)));
    const { wallet, id, agent } = await setup(rules[0]);
    expect((await stored(wallet, id)).assets[0]).toMatchObject({
      token: a,
      maxPerCall: BigInt(5),
    });
    const weth = getAddress(rules[0].allowedCalls[0].target);
    const router = getAddress(rules[0].allowedCalls[2].target);
    const usdc = getAddress(rules[0].allowedCalls[4].target);
    const swap = (
      tokenIn: Address,
      tokenOut: Address,
      amountIn: bigint,
      recipient = CEA
    ) => ({
      to: router,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: PRESET_ABI,
        functionName: 'exactInputSingle',
        args: [
          {
            tokenIn,
            tokenOut,
            fee: 3000,
            recipient,
            amountIn,
            amountOutMinimum: BigInt(0),
            sqrtPriceLimitX96: BigInt(0),
          },
        ],
      }),
    });
    const send = (data: ReturnType<typeof swap>[], amount = BigInt(5)) =>
      agent.universal.sendTransaction({
        to: { address: router, chain: CHAIN_NS },
        funds: { amount },
        data,
      });
    const sell = (amount: bigint, recipient = CEA) => [
      wrapCall(weth, amount),
      approveCall(weth, router, amount),
      swap(weth, usdc, amount, recipient),
    ];
    await waitPush(send(sell(BigInt(5))));
    expect((await stored(wallet, id)).assets[0].spent).toBe(BigInt(5));
    await expect(
      send([wrapCall(weth, BigInt(6)), ...sell(BigInt(5)).slice(1)])
    ).rejects.toMatchObject({
      decodedError: {
        name: 'PolicyCheckReverted(InnerValueExceedsAllowance)',
      },
    });
    await expect(send(sell(BigInt(5), DEST))).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(ArgPinMismatch)' },
    });
    await expect(
      send([...sell(BigInt(5)).slice(0, 2), swap(DEST, usdc, BigInt(5))])
    ).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(ArgPinMismatch)' },
    });
    await expect(
      send([...sell(BigInt(5)).slice(0, 2), swap(weth, usdc, BigInt(6))])
    ).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(ArgPinAboveMax)' },
    });
    // Destination-held USDC swaps back under the fixed 10 USDC per-swap pin.
    const usdcCap = BigInt(10_000_000);
    await waitPush(
      send(
        [approveCall(usdc, router, usdcCap), swap(usdc, weth, usdcCap)],
        BigInt(0)
      )
    );
    // The policy reports the first matching entry's failure: the WETH-in swap's token pin.
    await expect(
      send([swap(usdc, weth, usdcCap + BigInt(1))], BigInt(0))
    ).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(ArgPinMismatch)' },
    });
    // Calls using destination-held capital do not consume the Push bridge counter.
    expect((await stored(wallet, id)).assets[0].spent).toBe(BigInt(5));
  });

  it('the shipped LENDING catalog pins Aave supply to WETH and the wallet, and a regenerated cap applies through rules.update', async () => {
    const first = agenticPresets.get('LENDING', presetOptions(BigInt(5)));
    const { wallet, id, agent } = await setup(first.rules[0]);
    const weth = getAddress(first.rules[0].allowedCalls[0].target);
    const pool = getAddress(first.rules[0].allowedCalls[2].target);
    const supply = (amount: bigint, asset = weth, onBehalfOf = CEA) => [
      wrapCall(weth, amount),
      approveCall(weth, pool, amount),
      {
        to: pool,
        value: BigInt(0),
        data: encodeFunctionData({
          abi: PRESET_ABI,
          functionName: 'supply',
          args: [asset, amount, onBehalfOf, 0],
        }),
      },
    ];
    const send = (data: ReturnType<typeof supply>, amount: bigint) =>
      agent.universal.sendTransaction({
        to: { address: pool, chain: CHAIN_NS },
        funds: { amount },
        data,
      });
    await waitPush(send(supply(BigInt(5)), BigInt(5)));
    await expect(
      send(supply(BigInt(5), DEST), BigInt(5))
    ).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(ArgPinMismatch)' },
    });
    await expect(
      send(supply(BigInt(5), weth, DEST), BigInt(5))
    ).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(ArgPinMismatch)' },
    });
    const w = owner.agentic.wallet(wallet);
    const changed = agenticPresets.get('LENDING', presetOptions(BigInt(2)));
    const before = await h.publicClient.readContract({
      address: wallet,
      abi: h.generation.contracts.abis.wallet,
      functionName: 'checkpointCount',
    });
    const replaced = await w.rules.update({
      rules: [{ rulesId: id, rule: changed.rules[0] }],
    });
    expect(
      await h.publicClient.readContract({
        address: wallet,
        abi: h.generation.contracts.abis.wallet,
        functionName: 'checkpointCount',
      })
    ).toBe(before + BigInt(5));
    expect(replaced.rules[0].rulesId).not.toBe(id);
    await expect(send(supply(BigInt(3)), BigInt(3))).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(AmountExceedsCap)' },
    });
    await waitPush(send(supply(BigInt(2)), BigInt(2)));
    expect(
      (await stored(wallet, replaced.rules[0].rulesId)).assets[0].spent
    ).toBe(BigInt(2));
  });

  it('a fixture preset produces rules accepted by public create and enforced by real contracts', async () => {
    const presets = buildPresetApi([
      {
        constant: 'DEXES',
        name: 'Local fixture only',
        chains: [
          {
            chainNamespace: CHAIN_NS,
            allowedCalls: [
              { target: DEST, selector: 'increment()', app: 'Harness' },
            ],
            maxGasPerCall: BigInt(10) ** BigInt(16),
          },
        ],
      },
    ]);
    const { rules } = presets.get('DEXES', {
      agent: h.wallets[1].account!.address,
      validUntil: Math.floor(Date.now() / 1000) + 3600,
      assets: [
        {
          chainNamespace: CHAIN_NS,
          token: zeroAddress,
          maxPerCall: BigInt(5),
          maxTotal: BigInt(7),
        },
      ],
    });
    const { wallet, id, send } = await setup(rules[0]);
    await waitPush(send(a, BigInt(5)));
    expect((await stored(wallet, id)).assets[0].spent).toBe(BigInt(5));
    await expect(send(a, BigInt(3))).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(TotalSpendCapExceeded)' },
    });
  });

  it('a tokens-only rule lets the agent transfer each token only back to the owner, capped per transfer', async () => {
    const ownerAddress = h.wallets[0].account!.address;
    const { wallet, id, agent } = await setup({
      agent: h.wallets[1].account!.address,
      chainNamespace: CHAIN_NS,
      assets: [{ token: a, maxPerCall: BigInt(5), maxTotal: BigInt(20) }],
      validUntil: Math.floor(Date.now() / 1000) + 3600,
      maxGasPerCall: BigInt(10) ** BigInt(16),
    } as unknown as Rule);
    const record = await owner.agentic.wallet(wallet).rules.get(id);
    if (!('allowedCalls' in record.rule)) throw new Error('Expected EVM rule');
    expect(record.rule.allowedCalls).toHaveLength(1);
    const ERC20 = parseAbi([
      'function transfer(address,uint256) returns (bool)',
    ]);
    const send = (to: Address, amount: bigint, funded = BigInt(5)) =>
      agent.universal.sendTransaction({
        to: { address: a, chain: CHAIN_NS },
        funds: {
          amount: funded,
          token: {
            symbol: 'fixture',
            decimals: 6,
            address: a,
            mechanism: 'approve',
          },
        },
        data: [
          {
            to: a,
            value: BigInt(0),
            data: encodeFunctionData({
              abi: ERC20,
              functionName: 'transfer',
              args: [to, amount],
            }),
          },
        ],
      });
    await waitPush(send(ownerAddress, BigInt(5)));
    expect((await stored(wallet, id)).assets[0].spent).toBe(BigInt(5));
    await expect(send(DEST, BigInt(5))).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(ArgPinMismatch)' },
    });
    await expect(send(ownerAddress, BigInt(6))).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(ArgPinAboveMax)' },
    });
  });

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
  it('omitted and explicit zero totals both prohibit movement', async () => {
    const { wallet, id, send } = await setup(
      rule([
        { token: a, maxPerCall: BigInt(5) },
        { token: b, maxPerCall: BigInt(9), maxTotal: BigInt(0) },
      ])
    );
    expect((await stored(wallet, id)).assets.map((x) => x.maxTotal)).toEqual([
      BigInt(0),
      BigInt(0),
    ]);
    await expect(send(a, BigInt(1))).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(TotalSpendCapExceeded)' },
    });
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
        rules: [{ rulesId: id, rule: publicRules([rule()])[0] }],
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
  it('out-of-band duplicate contract grants still make sends ambiguous', async () => {
    const created = await owner.agentic.create('multiple', {
      rules: [rule()],
    });
    const rt = internal(owner);
    const [prepared] = await prepareWalletRules(
      rt,
      h.generation,
      h.wallets[0].account!.address,
      created.wallet,
      publicRules([rule()]),
      await Snapshot.at(rt.reader)
    );
    await h.write(
      0,
      created.wallet,
      h.generation.contracts.abis.wallet as never,
      'grantRules',
      [prepared.session]
    );
    const agent = await h.client(1, { agenticWallet: created.wallet });
    await expect(
      agent.universal.sendTransaction({
        to: { address: DEST, chain: CHAIN_NS },
        data: '0xd09de08a',
      })
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_RULE' });
  });
  it('a legacy two-field envelope is refused by the actual v6 grant path', async () => {
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
