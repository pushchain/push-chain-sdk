/** Real Donut -> Sepolia preset execution. No mainnet transactions.
 * Destination WETH/Circle USDC are intentionally prefunded, not bridged assets:
 * those two tokens have no usable SDK PRC20 pair. Generated call pins are unchanged.
 */
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  parseAbi,
  parseEther,
  parseEventLogs,
  type Address,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';
import { PushChain, CHAIN } from '../../src';
import { MOVEABLE_TOKEN_CONSTANTS } from '../../src/lib/constants/tokens';
import { getNativePRC20ForChain } from '../../src/lib/orchestrator/internals/helpers';
import { getCEAAddress } from '../../src/lib/orchestrator/cea-utils';
import {
  AGW_E2E_ENABLED,
  setupAgw,
  evmClient,
  inSeconds,
  type AgwFixture,
} from './_fixture';

const d = AGW_E2E_ENABLED ? describe : describe.skip;
const WETH = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14' as Address;
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as Address;
const FACTORY = '0x0227628f3F023bb0B980b67D528571c95c6DaC1c' as Address;
const AMOUNT = BigInt(10) ** BigInt(12);
const MAX_PC = parseEther('20');
const SWAP = parseAbi([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) returns(uint256)',
]);
const EXECUTED = parseAbi([
  'event UniversalTxExecuted(bytes32 indexed subTxId, bytes32 indexed universalTxId, address indexed originCaller, address target, bytes data)',
]);
const sep = createPublicClient({
  chain: sepolia,
  transport: http('https://ethereum-sepolia-rpc.publicnode.com'),
});

d('agw presets live', () => {
  let f: AgwFixture;
  afterAll(() => f?.teardown());
  it('1. Uniswap preset swaps from the wallet CEA and rejects a different recipient', async () => {
    // Read-only protocol prerequisites run before any funding.
    const block = await sep.getBlockNumber();
    const pool = await sep.readContract({
      address: FACTORY,
      abi: parseAbi([
        'function getPool(address,address,uint24) view returns(address)',
      ]),
      functionName: 'getPool',
      args: [WETH, USDC, 500],
      blockNumber: block,
    });
    if (/^0x0+$/.test(pool))
      throw new Error(
        'PRESET_PREREQUISITE: Sepolia WETH/Circle USDC pool is absent'
      );
    const liquidity = await sep.readContract({
      address: pool,
      abi: parseAbi(['function liquidity() view returns(uint128)']),
      functionName: 'liquidity',
      blockNumber: block,
    });
    if (!liquidity)
      throw new Error(
        'PRESET_PREREQUISITE: Sepolia pool has no active liquidity'
      );
    f = await setupAgw();
    const defaults = PushChain.utils.agentic.presets.get('DEXES', {
      chainNamespace: CHAIN.ETHEREUM_SEPOLIA,
      agent: f.agentAddress,
      funding: 'destination',
    });
    expect(defaults.readiness.ready).toBe(true);
    expect(defaults.rules[0].maxGasPerCall).toBe(MAX_PC);
    expect(defaults.rules[0].validUntil).toBeGreaterThan(inSeconds(6 * 86400));
    expect(
      defaults.readiness.chains[0].selectedAssets.map((a) =>
        a.token.toString().toLowerCase()
      )
    ).toEqual([WETH.toLowerCase(), USDC.toLowerCase()]);
    expect(
      defaults.readiness.chains[0].selectedAssets.every(
        (a) => a.maxPerCall > BigInt(0)
      )
    ).toBe(true);
    const { rules } = PushChain.utils.agentic.presets.get('DEXES', {
      funding: 'destination',
      chainNamespace: CHAIN.ETHEREUM_SEPOLIA,
      agent: f.agentAddress,
      validUntil: inSeconds(3600),
      maxGasPerCall: MAX_PC,
      assets: [
        { token: WETH, maxPerCall: AMOUNT, maxTotal: AMOUNT * BigInt(2) },
        {
          token: USDC,
          maxPerCall: BigInt(1_000_000),
          maxTotal: BigInt(2_000_000),
        },
      ],
    });
    // assets[] budgets bridge burns on Push. This test spends already-held CEA
    // tokens, so omit bridge assets without changing any generated call or pin.
    const { wallet, rulesIds } = await f.owner.agentic.create(
      'e2e-preset-uniswap',
      { rules }
    );
    const cea = (await getCEAAddress(wallet, CHAIN.ETHEREUM_SEPOLIA))
      .cea as Address;
    const router = rules[0].allowedCalls[0].target as Address;
    await f.fundPC(wallet, parseEther('65'));
    const peth = getNativePRC20ForChain(
      CHAIN.ETHEREUM_SEPOLIA,
      f.manifest.network
    );
    await (
      await f.owner.universal.sendTransaction({
        to: peth,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [wallet, AMOUNT * BigInt(2)],
        }),
      })
    ).wait();
    const owner = await evmClient(
      process.env['PUSH_PRIVATE_KEY'] as Hex,
      CHAIN.PUSH_TESTNET_DONUT,
      f.manifest.network,
      wallet
    );
    const wrap = await owner.universal.sendTransaction({
      to: { address: WETH, chain: CHAIN.ETHEREUM_SEPOLIA },
      data: [
        {
          to: WETH,
          value: AMOUNT * BigInt(2),
          data: encodeFunctionData({
            abi: parseAbi(['function deposit() payable']),
            functionName: 'deposit',
          }),
        },
      ],
      funds: {
        token: MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.ETH,
        amount: AMOUNT * BigInt(2),
      },
      gasLimit: BigInt(2_000_000),
    });
    const wrapped = await wrap.wait();
    expect(wrapped.externalTxHash).toBeTruthy();
    expect(
      (await sep.getTransactionReceipt({ hash: wrapped.externalTxHash as Hex }))
        .status
    ).toBe('success');
    const balance = (token: Address) =>
      sep.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [cea],
      });
    expect(await balance(WETH)).toBe(AMOUNT * BigInt(2));
    const before = await balance(USDC);
    const agent = await f.agent(wallet);
    const swap = (recipient: Address) =>
      encodeFunctionData({
        abi: SWAP,
        functionName: 'exactInputSingle',
        args: [
          {
            tokenIn: WETH,
            tokenOut: USDC,
            fee: 500,
            recipient,
            amountIn: AMOUNT,
            amountOutMinimum: BigInt(1),
            sqrtPriceLimitX96: BigInt(0),
          },
        ],
      });
    await expect(
      agent.universal.sendTransaction({
        to: { address: router, chain: CHAIN.ETHEREUM_SEPOLIA },
        data: [{ to: router, value: BigInt(0), data: swap(f.agentAddress) }],
        gasLimit: BigInt(700_000),
      })
    ).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(ArgPinMismatch)' },
    });
    const tx = await agent.universal.sendTransaction({
      to: { address: router, chain: CHAIN.ETHEREUM_SEPOLIA },
      gasLimit: BigInt(700_000),
      data: [
        {
          to: WETH,
          value: BigInt(0),
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [router, AMOUNT],
          }),
        },
        { to: router, value: BigInt(0), data: swap(cea) },
      ],
    });
    const receipt = await tx.wait();
    expect(receipt.externalTxHash).toBeTruthy();
    const dest = await sep.getTransactionReceipt({
      hash: receipt.externalTxHash as Hex,
    });
    expect(dest.status).toBe('success');
    expect(await balance(WETH)).toBe(AMOUNT);
    const after = await balance(USDC);
    expect(after).toBeGreaterThan(before);
    expect(
      parseEventLogs({ abi: EXECUTED, logs: dest.logs }).some(
        (e) =>
          e.address.toLowerCase() === cea.toLowerCase() &&
          e.args.originCaller.toLowerCase() === wallet.toLowerCase() &&
          e.args.target.toLowerCase() === router.toLowerCase() &&
          e.args.data === swap(cea)
      )
    ).toBe(true);
    f.evidence('preset-uniswap-live', {
      wallet,
      cea,
      rulesId: rulesIds[0],
      pool,
      prerequisiteBlock: block,
      wrapTx: wrap.hash,
      wrapExternal: wrapped.externalTxHash,
      pushTx: tx.hash,
      externalTx: receipt.externalTxHash,
      amountIn: AMOUNT,
      amountOut: after - before,
    });
  }, 900_000);
  it('2. Aave preset supplies and withdraws the wallet position', async () => {
    const mockLINK = '0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5' as Address;
    const faucet = '0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D' as Address;
    const amount = BigInt(10) ** BigInt(12);
    const faucetAbi = parseAbi(['function mint(address,address,uint256)']);
    // Testnet USDC/DAI/USDT supply caps are exhausted; use faucet LINK.
    // Mock LINK is a destination-only asset, not an SDK bridge token.
    await sep.simulateContract({
      address: faucet,
      abi: faucetAbi,
      functionName: 'mint',
      args: [mockLINK, '0x0000000000000000000000000000000000001234', amount],
      account: '0x0000000000000000000000000000000000001234',
    });
    const readinessPool = PushChain.utils.agentic.presets.get('LENDING', {
      chainNamespace: CHAIN.ETHEREUM_SEPOLIA,
    }).rules[0].allowedCalls[0].target as Address;
    // Fail before funding if protocol gates (cap, pause, freeze) reject supply.
    // An unfunded probe reaching token transfer is the expected result.
    let readiness = '';
    try {
      await sep.simulateContract({
        address: readinessPool,
        abi: parseAbi(['function supply(address,uint256,address,uint16)']),
        functionName: 'supply',
        args: [
          mockLINK,
          amount,
          '0x0000000000000000000000000000000000001234',
          0,
        ],
        account: '0x0000000000000000000000000000000000001234',
      });
    } catch (error) {
      readiness = String(
        (error as { shortMessage?: string }).shortMessage ?? error
      );
    }
    if (!readiness.includes('transfer amount exceeds balance'))
      throw new Error(
        `PRESET_PREREQUISITE: Aave reserve rejected unfunded supply probe: ${readiness}`
      );
    f?.teardown();
    f = await setupAgw();
    const defaults = PushChain.utils.agentic.presets.get('LENDING', {
      chainNamespace: CHAIN.ETHEREUM_SEPOLIA,
      agent: f.agentAddress,
      funding: 'destination',
    });
    expect(defaults.readiness.ready).toBe(true);
    expect(defaults.readiness.chains[0].selectedAssets[0].maxPerCall).toBe(
      parseEther('1')
    );
    expect(defaults.rules[0].maxGasPerCall).toBe(MAX_PC);
    expect(
      defaults.readiness.chains[0].selectedAssets.map((a) =>
        a.token.toString().toLowerCase()
      )
    ).toEqual([mockLINK.toLowerCase()]);
    const { rules } = PushChain.utils.agentic.presets.get('LENDING', {
      funding: 'destination',
      chainNamespace: CHAIN.ETHEREUM_SEPOLIA,
      agent: f.agentAddress,
      validUntil: inSeconds(3600),
      maxGasPerCall: MAX_PC,
      assets: defaults.readiness.chains[0].selectedAssets.map((a) => ({
        ...a,
        maxPerCall: amount,
        maxTotal: amount,
      })),
    });
    const { wallet, rulesIds } = await f.owner.agentic.create(
      'e2e-preset-aave',
      { rules }
    );
    const cea = (await getCEAAddress(wallet, CHAIN.ETHEREUM_SEPOLIA))
      .cea as Address;
    const pool = rules[0].allowedCalls[0].target as Address;
    await f.fundPC(wallet, parseEther('65'));
    const owner = await evmClient(
      process.env['PUSH_PRIVATE_KEY'] as Hex,
      CHAIN.PUSH_TESTNET_DONUT,
      f.manifest.network,
      wallet
    );
    const mint = await owner.universal.sendTransaction({
      to: { address: faucet, chain: CHAIN.ETHEREUM_SEPOLIA },
      gasLimit: BigInt(2_000_000),
      data: [
        {
          to: faucet,
          value: BigInt(0),
          data: encodeFunctionData({
            abi: faucetAbi,
            functionName: 'mint',
            args: [mockLINK, cea, amount],
          }),
        },
      ],
    });
    f.evidence('preset-aave-stage', {
      stage: 'mint-submitted',
      wallet,
      cea,
      pushTx: mint.hash,
    });
    const minted = await mint.wait();
    f.evidence('preset-aave-stage', {
      stage: 'mint-completed',
      wallet,
      cea,
      externalTx: minted.externalTxHash,
    });
    expect(
      (await sep.getTransactionReceipt({ hash: minted.externalTxHash as Hex }))
        .status
    ).toBe('success');
    const balance = () =>
      sep.readContract({
        address: mockLINK,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [cea],
      });
    expect(await balance()).toBe(amount);
    const abi = parseAbi([
      'function supply(address,uint256,address,uint16)',
      'function withdraw(address,uint256,address) returns(uint256)',
      'event Supply(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint16 indexed referralCode)',
      'event Withdraw(address indexed reserve,address indexed user,address indexed to,uint256 amount)',
    ]);
    const agent = await f.agent(wallet);
    const supplyData = encodeFunctionData({
      abi,
      functionName: 'supply',
      args: [mockLINK, amount, cea, 0],
    });
    await expect(
      agent.universal.sendTransaction({
        to: { address: pool, chain: CHAIN.ETHEREUM_SEPOLIA },
        gasLimit: BigInt(900_000),
        data: [
          {
            to: pool,
            value: BigInt(0),
            data: encodeFunctionData({
              abi,
              functionName: 'supply',
              args: [mockLINK, amount + BigInt(1), cea, 0],
            }),
          },
        ],
      })
    ).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(ArgPinAboveMax)' },
    });
    const supply = await agent.universal.sendTransaction({
      to: { address: pool, chain: CHAIN.ETHEREUM_SEPOLIA },
      gasLimit: BigInt(900_000),
      data: [
        {
          to: mockLINK,
          value: BigInt(0),
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [pool, amount],
          }),
        },
        { to: pool, value: BigInt(0), data: supplyData },
      ],
    });
    f.evidence('preset-aave-stage', {
      stage: 'supply-submitted',
      wallet,
      cea,
      pushTx: supply.hash,
    });
    const supplied = await supply.wait();
    f.evidence('preset-aave-stage', {
      stage: 'supply-completed',
      wallet,
      cea,
      externalTx: supplied.externalTxHash,
    });
    const supplyReceipt = await sep.getTransactionReceipt({
      hash: supplied.externalTxHash as Hex,
    });
    expect(supplyReceipt.status).toBe('success');
    expect(await balance()).toBe(BigInt(0));
    const events = parseEventLogs({
      abi,
      eventName: 'Supply',
      logs: supplyReceipt.logs,
    });
    expect(
      events.some(
        (e) =>
          e.address.toLowerCase() === pool.toLowerCase() &&
          e.args.user.toLowerCase() === cea.toLowerCase() &&
          e.args.onBehalfOf.toLowerCase() === cea.toLowerCase() &&
          e.args.amount === amount
      )
    ).toBe(true);
    const half = amount / BigInt(2);
    const regenerated = PushChain.utils.agentic.presets.get('LENDING', {
      chainNamespace: CHAIN.ETHEREUM_SEPOLIA,
      agent: f.agentAddress,
      validUntil: inSeconds(3600),
      maxGasPerCall: MAX_PC,
      assets: [{ token: mockLINK, maxPerCall: half, maxTotal: amount }],
    });
    expect(regenerated.readiness.ready).toBe(true);
    const changed = await f.owner.agentic.wallet(wallet).rules.update({
      rules: [
        {
          rulesId: rulesIds[0],
          rule: { ...regenerated.rules[0], assets: [] },
        },
      ],
    });
    await expect(
      agent.universal.sendTransaction({
        to: { address: pool, chain: CHAIN.ETHEREUM_SEPOLIA },
        gasLimit: BigInt(900_000),
        data: [
          {
            to: pool,
            value: BigInt(0),
            data: encodeFunctionData({
              abi,
              functionName: 'withdraw',
              args: [mockLINK, amount, cea],
            }),
          },
        ],
      })
    ).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(ArgPinAboveMax)' },
    });
    // The cap applies to each allowed call, not their aggregate in a batch.
    const withdraw = await agent.universal.sendTransaction({
      to: { address: pool, chain: CHAIN.ETHEREUM_SEPOLIA },
      gasLimit: BigInt(900_000),
      data: [0, 1].map(() => ({
        to: pool,
        value: BigInt(0),
        data: encodeFunctionData({
          abi,
          functionName: 'withdraw',
          args: [mockLINK, half, cea],
        }),
      })),
    });
    f.evidence('preset-aave-stage', {
      stage: 'withdraw-submitted',
      wallet,
      cea,
      pushTx: withdraw.hash,
    });
    const withdrawn = await withdraw.wait();
    f.evidence('preset-aave-stage', {
      stage: 'withdraw-completed',
      wallet,
      cea,
      externalTx: withdrawn.externalTxHash,
    });
    const withdrawalReceipt = await sep.getTransactionReceipt({
      hash: withdrawn.externalTxHash as Hex,
    });
    expect(withdrawalReceipt.status).toBe('success');
    expect(await balance()).toBe(amount);
    const withdrawals = parseEventLogs({
      abi,
      eventName: 'Withdraw',
      logs: withdrawalReceipt.logs,
    }).filter(
      (e) =>
        e.address.toLowerCase() === pool.toLowerCase() &&
        e.args.user.toLowerCase() === cea.toLowerCase() &&
        e.args.to.toLowerCase() === cea.toLowerCase()
    );
    expect(withdrawals).toHaveLength(2);
    expect(withdrawals.every((e) => e.args.amount === half)).toBe(true);
    expect(withdrawals.reduce((sum, e) => sum + e.args.amount, BigInt(0))).toBe(
      amount
    );
    f.evidence('preset-limits-regeneration-live', {
      wallet,
      cea,
      oldRulesId: rulesIds[0],
      newRulesId: changed.rules[0].rulesId,
      oldCap: amount,
      newCap: half,
      rejectedAboveCap: true,
      destinationTx: withdrawn.externalTxHash,
    });
    f.evidence('preset-aave-live', {
      wallet,
      cea,
      rulesId: rulesIds[0],
      mockLINK,
      pool,
      mintTx: mint.hash,
      mintExternal: minted.externalTxHash,
      supplyTx: supply.hash,
      supplyExternal: supplied.externalTxHash,
      withdrawTx: withdraw.hash,
      withdrawExternal: withdrawn.externalTxHash,
      amount,
    });
  }, 900_000);
});
