/** Real protocol tests on supported testnets only. All signing uses Donut.
 * Destination-only assets are prefunded; generated preset calls/pins are retained.
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
import { PushChain, CHAIN, type Rule } from '../../src';
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
const ZERO = BigInt(0),
  SMALL = BigInt(10) ** BigInt(12),
  MAX_PC = parseEther('20');
const rpc = {
  [CHAIN.ETHEREUM_SEPOLIA]: 'https://ethereum-sepolia-rpc.publicnode.com',
  [CHAIN.BASE_SEPOLIA]: 'https://base-sepolia-rpc.publicnode.com',
  [CHAIN.ARBITRUM_SEPOLIA]: 'https://arbitrum-sepolia-rpc.publicnode.com',
  [CHAIN.BNB_TESTNET]: 'https://bsc-testnet-rpc.publicnode.com',
};
type Destination = keyof typeof rpc;
type Call = { to: Address; value: bigint; data: Hex };
const ERC20 = erc20Abi;
const EXECUTED = parseAbi([
  'event UniversalTxExecuted(bytes32 indexed subTxId, bytes32 indexed universalTxId, address indexed originCaller, address target, bytes data)',
]);
const WETH = parseAbi(['function deposit() payable']);
const AAVE = parseAbi([
  'function supply(address,uint256,address,uint16)',
  'function withdraw(address,uint256,address) returns(uint256)',
]);
const MARKET = parseAbi([
  'function mint(uint256) returns(uint256)',
  'function redeem(uint256) returns(uint256)',
  'function balanceOf(address) view returns(uint256)',
]);
const read = (chain: Destination) =>
  createPublicClient({ transport: http(rpc[chain], { timeout: 20_000 }) });
const call = (to: Address, data: Hex, value = ZERO): Call => ({
  to,
  data,
  value,
});
const approve = (token: Address, spender: Address, amount: bigint) =>
  call(
    token,
    encodeFunctionData({
      abi: ERC20,
      functionName: 'approve',
      args: [spender, amount],
    })
  );
const balance = (chain: Destination, token: Address, owner: Address) =>
  read(chain).readContract({
    address: token,
    abi: ERC20,
    functionName: 'balanceOf',
    args: [owner],
  });
const preset = (
  category: 'DEXES' | 'LENDING' | 'STAKING',
  chain: Destination,
  agent: Address,
  tokens: { token: Address; maxPerCall: bigint; maxTotal: bigint }[]
): Rule => ({
  ...PushChain.utils.agentic.presets.get(category, {
    chainNamespace: chain,
    agent,
    validUntil: inSeconds(7200),
    maxGasPerCall: MAX_PC,
    assets: tokens,
  }).rules[0],
  assets: [],
});

async function walletFor(
  f: AgwFixture,
  chain: Destination,
  rule: Rule,
  label: string
) {
  const { wallet, rulesIds } = await f.owner.agentic.create(label, {
    rules: [rule],
  });
  const cea = (await getCEAAddress(wallet, chain)).cea as Address;
  await f.fundPC(wallet, parseEther('100'));
  const owner = await evmClient(
    process.env['PUSH_PRIVATE_KEY'] as Hex,
    CHAIN.PUSH_TESTNET_DONUT,
    f.manifest.network,
    wallet
  );
  const agent = await f.agent(wallet);
  f.evidence('preset-expanded-wallet', {
    label,
    chain,
    wallet,
    cea,
    rulesId: rulesIds[0],
  });
  return { wallet, cea, owner, agent, rulesId: rulesIds[0] };
}
async function send(
  f: AgwFixture,
  w: Awaited<ReturnType<typeof walletFor>>,
  chain: Destination,
  client: PushChain,
  calls: Call[],
  stage: string,
  funds?: {
    token: typeof MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.ETH;
    amount: bigint;
  }
) {
  const tx = await client.universal.sendTransaction({
    to: { address: calls[0].to, chain },
    data: calls,
    gasLimit: BigInt(2_000_000),
    ...(funds ? { funds } : {}),
  });
  f.evidence('preset-expanded-stage', {
    chain,
    wallet: w.wallet,
    cea: w.cea,
    stage: `${stage}-submitted`,
    pushTx: tx.hash,
  });
  const receipt = await tx.wait();
  expect(receipt.externalTxHash).toBeTruthy();
  const dest = await read(chain).getTransactionReceipt({
    hash: receipt.externalTxHash as Hex,
  });
  f.evidence('preset-expanded-stage', {
    chain,
    wallet: w.wallet,
    cea: w.cea,
    stage: `${stage}-completed`,
    pushTx: tx.hash,
    externalTx: receipt.externalTxHash,
    status: dest.status,
  });
  expect(dest.status).toBe('success');
  const events = parseEventLogs({ abi: EXECUTED, logs: dest.logs });
  for (const c of calls)
    expect(
      events.some(
        (e) =>
          e.address.toLowerCase() === w.cea.toLowerCase() &&
          e.args.originCaller.toLowerCase() === w.wallet.toLowerCase() &&
          e.args.target.toLowerCase() === c.to.toLowerCase() &&
          e.args.data === c.data
      )
    ).toBe(true);
  return dest;
}
// Moonwell and Venus use different Redeem event signatures. Require the
// protocol's entire burned-share amount and payout to match the CEA balances.
function assertRedemption(
  receipt: Awaited<ReturnType<typeof send>>,
  market: Address,
  cea: Address,
  shares: bigint,
  received: bigint
) {
  const events = parseEventLogs({
    abi: parseAbi([
      'event Redeem(address redeemer,uint256 redeemAmount,uint256 redeemTokens)',
      'event Redeem(address redeemer,uint256 redeemAmount,uint256 redeemTokens,uint256 totalSupply)',
    ]),
    logs: receipt.logs,
  });
  const event = events.find(
    (e) =>
      e.address.toLowerCase() === market.toLowerCase() &&
      e.args.redeemer.toLowerCase() === cea.toLowerCase()
  );
  expect(event?.args.redeemTokens).toBe(shares);
  expect(event?.args.redeemAmount).toBe(received);
}

async function wrap(
  f: AgwFixture,
  w: Awaited<ReturnType<typeof walletFor>>,
  chain: Destination,
  token: Address,
  amount: bigint
) {
  const prc20 = getNativePRC20ForChain(chain, f.manifest.network);
  if (
    (await f.push.readContract({
      address: prc20,
      abi: ERC20,
      functionName: 'balanceOf',
      args: [f.ownerAddress],
    })) < amount
  )
    throw new Error(
      `PRESET_PREREQUISITE: master lacks native PRC20 for ${chain}`
    );
  await (
    await f.owner.universal.sendTransaction({
      to: prc20,
      data: encodeFunctionData({
        abi: ERC20,
        functionName: 'transfer',
        args: [w.wallet, amount],
      }),
    })
  ).wait();
  const native =
    chain === CHAIN.BNB_TESTNET
      ? MOVEABLE_TOKEN_CONSTANTS.BNB_TESTNET.BNB
      : chain === CHAIN.BASE_SEPOLIA
      ? MOVEABLE_TOKEN_CONSTANTS.BASE_SEPOLIA.ETH
      : chain === CHAIN.ARBITRUM_SEPOLIA
      ? MOVEABLE_TOKEN_CONSTANTS.ARBITRUM_SEPOLIA.ETH
      : MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.ETH;
  await send(
    f,
    w,
    chain,
    w.owner,
    [
      call(
        token,
        encodeFunctionData({ abi: WETH, functionName: 'deposit' }),
        amount
      ),
    ],
    'wrap',
    { token: native, amount }
  );
  expect(await balance(chain, token, w.cea)).toBe(amount);
}

d('agw presets expanded', () => {
  let f: AgwFixture;
  afterEach(() => f?.teardown());
  it('1. EigenLayer Sepolia deposit credits shares to the wallet', async () => {
    const chain = CHAIN.ETHEREUM_SEPOLIA;
    const manager = '0x2E3D6c0744b10eb0A4e6F679F71554a39Ec47a5D' as Address;
    const strategy = '0x424246eF71b01ee33aA33aC590fd9a0855F5eFbc' as Address;
    const abi = parseAbi([
      'function strategyIsWhitelistedForDeposit(address) view returns(bool)',
      'function paused() view returns(uint256)',
      'function depositIntoStrategy(address,address,uint256) returns(uint256)',
      'function stakerDepositShares(address,address) view returns(uint256)',
    ]);
    expect(
      await read(chain).readContract({
        address: manager,
        abi,
        functionName: 'strategyIsWhitelistedForDeposit',
        args: [strategy],
      })
    ).toBe(true);
    expect(
      (await read(chain).readContract({
        address: manager,
        abi,
        functionName: 'paused',
      })) & BigInt(1)
    ).toBe(ZERO);
    const token = await read(chain).readContract({
      address: strategy,
      abi: parseAbi(['function underlyingToken() view returns(address)']),
      functionName: 'underlyingToken',
    });
    f = await setupAgw();
    const rule = preset('STAKING', chain, f.agentAddress, [
      { token, maxPerCall: SMALL, maxTotal: SMALL },
    ]);
    const w = await walletFor(f, chain, rule, 'e2e-preset-eigen');
    await wrap(f, w, chain, token, SMALL);
    const before = await read(chain).readContract({
      address: manager,
      abi,
      functionName: 'stakerDepositShares',
      args: [w.cea, strategy],
    });
    await send(
      f,
      w,
      chain,
      w.agent,
      [
        approve(token, manager, SMALL),
        call(
          manager,
          encodeFunctionData({
            abi,
            functionName: 'depositIntoStrategy',
            args: [strategy, token, SMALL],
          })
        ),
      ],
      'eigen-deposit'
    );
    const after = await read(chain).readContract({
      address: manager,
      abi,
      functionName: 'stakerDepositShares',
      args: [w.cea, strategy],
    });
    expect(after).toBeGreaterThan(before);
    expect(await balance(chain, token, w.cea)).toBe(ZERO);
    f.evidence('preset-eigen-live', {
      wallet: w.wallet,
      cea: w.cea,
      strategy,
      amount: SMALL,
      shares: after - before,
    });
  }, 900_000);
  const dexCases = [
    {
      id: 2,
      chain: CHAIN.BASE_SEPOLIA,
      wrapped: '0x4200000000000000000000000000000000000006',
      output: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      fee: 3000,
    },
    {
      id: 3,
      chain: CHAIN.ARBITRUM_SEPOLIA,
      wrapped: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
      output: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      fee: 3000,
    },
    {
      id: 4,
      chain: CHAIN.BNB_TESTNET,
      wrapped: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
      output: '0xA11c8D9DC9b66E209Ef60F0C8D969D3CD988782c',
      fee: 100,
    },
  ] as const;
  async function dexAndLend({
    chain,
    wrapped,
    output,
    fee,
  }: (typeof dexCases)[number]) {
    const discovery = PushChain.utils.agentic.presets.get('DEXES', {
      chainNamespace: chain,
    }).rules[0];
    const router = discovery.allowedCalls[0].target as Address;
    const factory = await read(chain).readContract({
      address: router,
      abi: parseAbi(['function factory() view returns(address)']),
      functionName: 'factory',
    });
    const pool = await read(chain).readContract({
      address: factory,
      abi: parseAbi([
        'function getPool(address,address,uint24) view returns(address)',
      ]),
      functionName: 'getPool',
      args: [wrapped, output, fee],
    });
    if (/^0x0+$/.test(pool))
      throw new Error(`PRESET_PREREQUISITE: ${chain} pool missing`);
    expect(
      await read(chain).readContract({
        address: pool,
        abi: parseAbi(['function liquidity() view returns(uint128)']),
        functionName: 'liquidity',
      })
    ).toBeGreaterThan(ZERO);
    f = await setupAgw();
    const w = await walletFor(
      f,
      chain,
      preset('DEXES', chain, f.agentAddress, [
        { token: wrapped, maxPerCall: SMALL, maxTotal: SMALL },
        { token: output, maxPerCall: SMALL, maxTotal: SMALL },
      ]),
      `e2e-preset-dex-${chain}`
    );
    await wrap(f, w, chain, wrapped, SMALL);
    const abi = parseAbi([
      'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) returns(uint256)',
    ]);
    const swap = (recipient: Address, amountIn = SMALL) =>
      call(
        router,
        encodeFunctionData({
          abi,
          functionName: 'exactInputSingle',
          args: [
            {
              tokenIn: wrapped,
              tokenOut: output,
              fee,
              recipient,
              amountIn,
              amountOutMinimum: BigInt(1),
              sqrtPriceLimitX96: ZERO,
            },
          ],
        })
      );
    await expect(
      w.agent.universal.sendTransaction({
        to: { address: router, chain },
        gasLimit: BigInt(2_000_000),
        data: [swap(f.agentAddress)],
      })
    ).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(ArgPinMismatch)' },
    });
    await expect(
      w.agent.universal.sendTransaction({
        to: { address: router, chain },
        gasLimit: BigInt(2_000_000),
        data: [swap(w.cea, SMALL + BigInt(1))],
      })
    ).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(ArgPinAboveMax)' },
    });
    const before = await balance(chain, output, w.cea);
    await send(
      f,
      w,
      chain,
      w.agent,
      [approve(wrapped, router, SMALL), swap(w.cea)],
      'dex-swap'
    );
    const received = (await balance(chain, output, w.cea)) - before;
    expect(received).toBeGreaterThan(ZERO);
    expect(await balance(chain, wrapped, w.cea)).toBe(ZERO);
    f.evidence('preset-expanded-dex', {
      chain,
      wallet: w.wallet,
      cea: w.cea,
      pool,
      router,
      amountIn: SMALL,
      amountOut: received,
    });
    if (chain === CHAIN.BASE_SEPOLIA) return; // its Aave reserve uses a different test token; exercised in case 5.
    const rule = preset('LENDING', chain, f.agentAddress, [
      { token: output, maxPerCall: received, maxTotal: received },
    ]);
    await f.owner.agentic
      .wallet(w.wallet)
      .rules.update({ rules: [{ rulesId: w.rulesId, rule }] });
    if (chain === CHAIN.ARBITRUM_SEPOLIA) {
      const aave = rule.allowedCalls.find((c) => c.app === 'Aave V3')!
        .target as Address;
      await send(
        f,
        w,
        chain,
        w.agent,
        [
          approve(output, aave, received),
          call(
            aave,
            encodeFunctionData({
              abi: AAVE,
              functionName: 'supply',
              args: [output, received, w.cea, 0],
            })
          ),
        ],
        'aave-supply'
      );
      expect(await balance(chain, output, w.cea)).toBe(before);
      await send(
        f,
        w,
        chain,
        w.agent,
        [
          call(
            aave,
            encodeFunctionData({
              abi: AAVE,
              functionName: 'withdraw',
              args: [output, received, w.cea],
            })
          ),
        ],
        'aave-withdraw'
      );
      expect(await balance(chain, output, w.cea)).toBe(before + received);
      f.evidence('preset-expanded-aave', {
        chain,
        wallet: w.wallet,
        cea: w.cea,
        amount: received,
        asset: output,
      });
    } else {
      const venus = rule.allowedCalls.find((c) => c.app === 'Venus vUSDT')!
        .target as Address;
      await send(
        f,
        w,
        chain,
        w.agent,
        [
          approve(output, venus, received),
          call(
            venus,
            encodeFunctionData({
              abi: MARKET,
              functionName: 'mint',
              args: [received],
            })
          ),
        ],
        'venus-mint'
      );
      const shares = await balance(chain, venus, w.cea);
      expect(shares).toBeGreaterThan(ZERO);
      expect(await balance(chain, output, w.cea)).toBe(before);
      const redemption = await send(
        f,
        w,
        chain,
        w.agent,
        [
          call(
            venus,
            encodeFunctionData({
              abi: MARKET,
              functionName: 'redeem',
              args: [shares],
            })
          ),
        ],
        'venus-redeem'
      );
      const redeemed = (await balance(chain, output, w.cea)) - before;
      expect(await balance(chain, venus, w.cea)).toBe(ZERO);
      assertRedemption(redemption, venus, w.cea, shares, redeemed);
      expect(redeemed).toBeGreaterThanOrEqual(
        (received * BigInt(99)) / BigInt(100)
      );
      f.evidence('preset-expanded-venus', {
        chain,
        wallet: w.wallet,
        cea: w.cea,
        deposited: received,
        redeemed,
        shares,
        asset: output,
      });
    }
  }
  it('2. DEX swap on eip155:84532', () => dexAndLend(dexCases[0]), 1_200_000);
  it(
    '3. DEX swap and Aave round trip on eip155:421614',
    () => dexAndLend(dexCases[1]),
    1_200_000
  );
  it(
    '4. DEX swap and Venus round trip on eip155:97',
    () => dexAndLend(dexCases[2]),
    1_200_000
  );

  it('5. Base Aave and both Moonwell markets supply and redeem wallet positions', async () => {
    const chain = CHAIN.BASE_SEPOLIA;
    const link = '0x810D46F9a9027E28F9B01F75E2bdde839dA61115' as Address;
    const usdbc = '0x4616975f7E6045FD9737e95bC527e9e14c727BD2' as Address;
    const weth = '0x663A6F02d547dFd639BF689FED298712f2FB69Fb' as Address;
    const faucet = '0xD9145b5F45Ad4519c7ACcD6E0A4A82e83bB8A6Dc' as Address;
    const amountUSDBC = BigInt(10_000);
    expect(await read(chain).getCode({ address: faucet })).not.toBeUndefined();
    f = await setupAgw();
    const rule = preset('LENDING', chain, f.agentAddress, [
      { token: link, maxPerCall: SMALL, maxTotal: SMALL },
      { token: usdbc, maxPerCall: amountUSDBC, maxTotal: amountUSDBC },
      { token: weth, maxPerCall: SMALL, maxTotal: SMALL },
    ]);
    const w = await walletFor(f, chain, rule, 'e2e-preset-base-lending');
    const aave = rule.allowedCalls.find((c) => c.app === 'Aave V3')!
      .target as Address;
    const mUSDBC = rule.allowedCalls.find((c) => c.app === 'Moonwell mUSDbC')!
      .target as Address;
    const mWETH = rule.allowedCalls.find((c) => c.app === 'Moonwell mWETH')!
      .target as Address;
    await send(
      f,
      w,
      chain,
      w.owner,
      [
        call(
          faucet,
          encodeFunctionData({
            abi: parseAbi(['function mint(address,address,uint256)']),
            functionName: 'mint',
            args: [link, w.cea, SMALL],
          })
        ),
        call(
          usdbc,
          encodeFunctionData({
            abi: parseAbi(['function allocateTo(address,uint256)']),
            functionName: 'allocateTo',
            args: [w.cea, amountUSDBC],
          })
        ),
        call(
          weth,
          encodeFunctionData({
            abi: parseAbi(['function mint(address,uint256)']),
            functionName: 'mint',
            args: [w.cea, SMALL],
          })
        ),
      ],
      'faucets'
    );
    expect(await balance(chain, link, w.cea)).toBe(SMALL);
    expect(await balance(chain, usdbc, w.cea)).toBe(amountUSDBC);
    expect(await balance(chain, weth, w.cea)).toBe(SMALL);
    await send(
      f,
      w,
      chain,
      w.agent,
      [
        approve(link, aave, SMALL),
        call(
          aave,
          encodeFunctionData({
            abi: AAVE,
            functionName: 'supply',
            args: [link, SMALL, w.cea, 0],
          })
        ),
        approve(usdbc, mUSDBC, amountUSDBC),
        call(
          mUSDBC,
          encodeFunctionData({
            abi: MARKET,
            functionName: 'mint',
            args: [amountUSDBC],
          })
        ),
        approve(weth, mWETH, SMALL),
        call(
          mWETH,
          encodeFunctionData({
            abi: MARKET,
            functionName: 'mint',
            args: [SMALL],
          })
        ),
      ],
      'lending-supply'
    );
    const sharesUSDBC = await balance(chain, mUSDBC, w.cea),
      sharesWETH = await balance(chain, mWETH, w.cea);
    expect(sharesUSDBC).toBeGreaterThan(ZERO);
    expect(sharesWETH).toBeGreaterThan(ZERO);
    expect(await balance(chain, link, w.cea)).toBe(ZERO);
    expect(await balance(chain, usdbc, w.cea)).toBe(ZERO);
    expect(await balance(chain, weth, w.cea)).toBe(ZERO);
    const redemption = await send(
      f,
      w,
      chain,
      w.agent,
      [
        call(
          aave,
          encodeFunctionData({
            abi: AAVE,
            functionName: 'withdraw',
            args: [link, SMALL, w.cea],
          })
        ),
        call(
          mUSDBC,
          encodeFunctionData({
            abi: MARKET,
            functionName: 'redeem',
            args: [sharesUSDBC],
          })
        ),
        call(
          mWETH,
          encodeFunctionData({
            abi: MARKET,
            functionName: 'redeem',
            args: [sharesWETH],
          })
        ),
      ],
      'lending-withdraw'
    );
    expect(await balance(chain, link, w.cea)).toBe(SMALL);
    expect(await balance(chain, usdbc, w.cea)).toBeGreaterThanOrEqual(
      (amountUSDBC * BigInt(99)) / BigInt(100)
    );
    expect(await balance(chain, weth, w.cea)).toBeGreaterThanOrEqual(
      (SMALL * BigInt(99)) / BigInt(100)
    );
    expect(await balance(chain, mUSDBC, w.cea)).toBe(ZERO);
    expect(await balance(chain, mWETH, w.cea)).toBe(ZERO);
    assertRedemption(
      redemption,
      mUSDBC,
      w.cea,
      sharesUSDBC,
      await balance(chain, usdbc, w.cea)
    );
    assertRedemption(
      redemption,
      mWETH,
      w.cea,
      sharesWETH,
      await balance(chain, weth, w.cea)
    );
    f.evidence('preset-expanded-base-lending', {
      chain,
      wallet: w.wallet,
      cea: w.cea,
      link: SMALL,
      usdbc: amountUSDBC,
      weth: SMALL,
      sharesUSDBC,
      sharesWETH,
    });
  }, 1_200_000);
});
