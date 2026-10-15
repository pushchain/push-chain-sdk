import { getAddress, type Address } from 'viem';
import type { RuleCall, ForeignChainNamespace } from '../agentic.types';
import type { PresetCategory } from './types';

/** Internal catalog: reviewed addresses and explicit calls only; never fetched at runtime. */
export interface PresetChainDefinition {
  chainNamespace: ForeignChainNamespace;
  allowedCalls: readonly RuleCall[];
  /** Static single-hop routers; incomplete pairs return zero-input-cap review calls. */
  swapRouters?: readonly { address: Address; app: string }[];
  /** Exact spenders that need an approval for each non-native supplied asset. */
  approvals?: readonly { spender: Address; app: string; token?: Address }[];
  maxGasPerCall?: bigint;
}
export interface PresetDefinition {
  constant: PresetCategory;
  name: string;
  chains: readonly PresetChainDefinition[];
}
/** Mainnet and testnet templates from the October 15 Notion export and protocol sources.
 * Read-only deployment/code evidence and exclusions: plan/agw/research/preset-catalog-2026-10-15/.
 * Mainnet entries are templates only; no mainnet deployment or execution guarantee.
 */
const address = (value: string): Address => getAddress(value.toLowerCase());
const wallet = 'agentic:wallet' as const;
const aave = (pool: Address): RuleCall[] =>
  [
    ['supply(address,uint256,address,uint16)', 2, 'Supply'],
    ['withdraw(address,uint256,address)', 2, 'Withdraw'],
    ['borrow(address,uint256,uint256,uint16,address)', 4, 'Borrow'],
    ['repay(address,uint256,uint256,address)', 3, 'Repay'],
  ].map(([selector, arg, label]) => ({
    target: pool,
    selector: selector as RuleCall['selector'],
    pins: [{ arg: arg as number, expected: wallet }],
    app: 'Aave V3',
    label: label as string,
  }));
const market = (target: Address, app: string): RuleCall[] =>
  [
    'mint(uint256)',
    'redeem(uint256)',
    'redeemUnderlying(uint256)',
    'borrow(uint256)',
    'repayBorrow(uint256)',
  ].map((selector) => ({
    target,
    selector: selector as RuleCall['selector'],
    app,
    label: selector.split('(')[0],
  }));
const sepoliaPool = address('0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951');
const basePool = address('0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27');
const arbitrumPool = address('0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff');
const moonUSDBC = address('0x876852425331a113d8E432eFFB3aC5BEf38f033a');
const moonWETH = address('0x2F39a349A79492a70E152760ce7123A1933eCf28');
const venusUSDT = address('0xb7526572FFE56AB9D7489838Bf2E18e3323b441A');
const venusUSDC = address('0xD5C4C2e2facBEB59D0216D0595d63FcDc6F9A1a7');
const eigen = address('0x2E3D6c0744b10eb0A4e6F679F71554a39Ec47a5D');
const stETH = address('0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84');
const wstETH = address('0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0');
const lidoQueue = address('0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1');
const mainnetMarkets = (
  chain: string
): Pick<PresetChainDefinition, 'allowedCalls' | 'approvals'> => {
  const entries =
    chain === 'eip155:8453'
      ? [
          [
            '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22',
            'Moonwell mUSDC',
            '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          ],
          [
            '0x628ff693426583D9a7FB391E54366292F509D457',
            'Moonwell mWETH',
            '0x4200000000000000000000000000000000000006',
          ],
        ]
      : chain === 'eip155:56'
      ? [
          [
            '0xfD5840Cd36d94D7229439859C0112a4185BC0255',
            'Venus vUSDT',
            '0x55d398326f99059fF775485246999027B3197955',
          ],
          [
            '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8',
            'Venus vUSDC',
            '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
          ],
        ]
      : [];
  const controller =
    chain === 'eip155:8453'
      ? '0xfBb21d0380beE3312B33c4353c8936a0F13EF26C'
      : '0xfD36E2c2a6789Db23113685031d7F16329158384';
  return {
    allowedCalls: [
      ...entries.flatMap(([target, app]) => market(address(target), app)),
      ...(entries.length
        ? [
            {
              target: address(controller),
              selector: 'enterMarkets(address[])' as const,
              app: chain === 'eip155:8453' ? 'Moonwell' : 'Venus',
              label: 'Enter markets',
            },
          ]
        : []),
    ],
    approvals: entries.map(([spender, app, token]) => ({
      spender: address(spender),
      app,
      token: address(token),
    })),
  };
};
export const PRESET_CATALOG: readonly PresetDefinition[] = [
  {
    constant: 'DEXES',
    name: 'Popular DEXes',
    chains: [
      ['eip155:1', '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', 'Uniswap V3'],
      [
        'eip155:8453',
        '0x2626664c2603336E57B271c5C0b26F421741e481',
        'Uniswap V3',
      ],
      [
        'eip155:42161',
        '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        'Uniswap V3',
      ],
      [
        'eip155:56',
        '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
        'PancakeSwap V3',
      ],
      [
        'eip155:11155111',
        '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
        'Uniswap V3',
      ],
      [
        'eip155:84532',
        '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
        'Uniswap V3',
      ],
      [
        'eip155:421614',
        '0x101F443B4d1b059569D643917553c771E1b9663E',
        'Uniswap V3',
      ],
      [
        'eip155:97',
        '0x9a489505a00cE272eAa5e07Dba6491314CaE3796',
        'PancakeSwap V3',
      ],
    ].map(([chain, router, app]) => ({
      chainNamespace: chain as ForeignChainNamespace,
      allowedCalls: [],
      swapRouters: [{ address: address(router), app }],
      approvals: [{ spender: address(router), app }],
    })),
  },
  {
    constant: 'LENDING',
    name: 'Lending',
    chains: [
      ...(
        [
          ['eip155:1', '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2'],
          ['eip155:8453', '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5'],
          ['eip155:42161', '0x794a61358D6845594F94dc1DB02A252b5b4814aD'],
          ['eip155:56', '0x6807dc923806fE8Fd134338EABCA509979a7e0cB'],
        ] as const
      ).map(([chainNamespace, pool]) => ({
        chainNamespace,
        allowedCalls: [
          ...aave(address(pool)),
          ...mainnetMarkets(chainNamespace).allowedCalls,
        ],
        approvals: [
          { spender: address(pool), app: 'Aave V3' },
          ...(mainnetMarkets(chainNamespace).approvals ?? []),
        ],
      })),

      {
        chainNamespace: 'eip155:11155111',
        allowedCalls: aave(sepoliaPool),
        approvals: [{ spender: sepoliaPool, app: 'Aave V3' }],
      },
      {
        chainNamespace: 'eip155:421614',
        allowedCalls: aave(arbitrumPool),
        approvals: [{ spender: arbitrumPool, app: 'Aave V3' }],
      },
      {
        chainNamespace: 'eip155:84532',
        allowedCalls: [
          ...aave(basePool),
          ...market(moonUSDBC, 'Moonwell mUSDbC'),
          ...market(moonWETH, 'Moonwell mWETH'),
          {
            target: address('0xC72ba45f2Ae134F21DAEb2b7B5fd5De0064Ee9bB'),
            selector: 'enterMarkets(address[])',
            app: 'Moonwell',
            label: 'Enter markets',
          },
        ],
        approvals: [
          { spender: basePool, app: 'Aave V3' },
          {
            spender: moonUSDBC,
            app: 'Moonwell mUSDbC',
            token: address('0x4616975f7E6045FD9737e95bC527e9e14c727BD2'),
          },
          {
            spender: moonWETH,
            app: 'Moonwell mWETH',
            token: address('0x663A6F02d547dFd639BF689FED298712f2FB69Fb'),
          },
        ],
      },
      {
        chainNamespace: 'eip155:97',
        allowedCalls: [
          ...market(venusUSDT, 'Venus vUSDT'),
          ...market(venusUSDC, 'Venus vUSDC'),
          {
            target: address('0x94d1820b2D1c7c7452A163983Dc888CEC546b77D'),
            selector: 'enterMarkets(address[])',
            app: 'Venus',
            label: 'Enter markets',
          },
        ],
        approvals: [
          {
            spender: venusUSDT,
            app: 'Venus vUSDT',
            token: address('0xA11c8D9DC9b66E209Ef60F0C8D969D3CD988782c'),
          },
          {
            spender: venusUSDC,
            app: 'Venus vUSDC',
            token: address('0x16227D60f7a0e586C66B005219dfc887D13C9531'),
          },
        ],
      },
    ],
  },
  {
    constant: 'STAKING',
    name: 'Staking',
    chains: [
      {
        chainNamespace: 'eip155:1',
        allowedCalls: [
          {
            target: stETH,
            selector: 'submit(address)',
            maxValue: BigInt(0),
            app: 'Lido',
            label: 'Stake ETH (set an explicit value cap)',
          },
          {
            target: wstETH,
            selector: 'wrap(uint256)',
            app: 'Lido wstETH',
            label: 'Wrap stETH',
          },
          {
            target: wstETH,
            selector: 'unwrap(uint256)',
            app: 'Lido wstETH',
            label: 'Unwrap wstETH',
          },
          {
            target: lidoQueue,
            selector: 'requestWithdrawals(uint256[],address)',
            pins: [{ arg: 1, expected: wallet }],
            app: 'Lido withdrawal queue',
            label: 'Request withdrawal',
          },
          {
            target: lidoQueue,
            selector: 'claimWithdrawals(uint256[],uint256[])',
            app: 'Lido withdrawal queue',
            label: 'Claim finalized withdrawals',
          },
          {
            target: lidoQueue,
            selector: 'claimWithdrawal(uint256)',
            app: 'Lido withdrawal queue',
            label: 'Claim finalized withdrawal',
          },

          {
            target: address('0x858646372CC42E1A627fcE94aa7A7033e7CF075A'),
            selector: 'depositIntoStrategy(address,address,uint256)',
            app: 'EigenLayer',
            label: 'Deposit into strategy (withdrawals not included)',
          },
        ],
        approvals: [
          { spender: wstETH, token: stETH, app: 'Lido wstETH' },
          { spender: lidoQueue, token: stETH, app: 'Lido withdrawal queue' },

          {
            spender: address('0x858646372CC42E1A627fcE94aa7A7033e7CF075A'),
            app: 'EigenLayer',
          },
        ],
      },

      {
        chainNamespace: 'eip155:11155111',
        allowedCalls: [
          {
            target: eigen,
            selector: 'depositIntoStrategy(address,address,uint256)',
            app: 'EigenLayer',
            label: 'Deposit into strategy (withdrawals not included)',
          },
        ],
        approvals: [{ spender: eigen, app: 'EigenLayer' }],
      },
    ],
  },
  { constant: 'PREDICTION', name: 'Prediction markets', chains: [] },
];
