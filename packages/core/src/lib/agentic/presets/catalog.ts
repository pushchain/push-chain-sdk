import { getAddress, parseUnits, type Address } from 'viem';
import type {
  ArgumentPath,
  RuleCall,
  ForeignChainNamespace,
} from '../agentic.types';
import type { PresetCategory } from './types';

/** Caps filled from the preset's native ETH asset (its maxPerCall). */
export type PresetBudget =
  | { kind: 'native-value' }
  | { kind: 'native-amount'; amountArg: ArgumentPath };
export interface PresetCallDefinition extends RuleCall {
  budget?: PresetBudget;
}

/** Internal catalog: reviewed addresses and explicit calls only; never fetched at runtime. */
export interface PresetChainDefinition {
  chainNamespace: ForeignChainNamespace;
  allowedCalls: readonly PresetCallDefinition[];
  maxGasPerCall?: bigint;
}
export interface PresetDefinition {
  constant: PresetCategory;
  name: string;
  chains: readonly PresetChainDefinition[];
}
/** Testnet entries that ran live on Donut. Every preset sends native ETH from Push
 * and wraps it on arrival; no other token is moved from Push. Circle USDC is only
 * the destination-side swap token (the only WETH pools with liquidity, checked
 * read-only on October 24). Evidence: plan/agw/research/.
 */
const address = (value: string): Address => getAddress(value.toLowerCase());
const wallet = 'agentic:wallet' as const;
/** Destination-held USDC per swap; editable in the returned rule. */
const USDC_PER_SWAP = parseUnits('10', 6);
const SWAP_STRUCT = '(address,address,uint24,address,uint256,uint256,uint160)';

const wrap = (weth: Address): PresetCallDefinition => ({
  target: weth,
  selector: 'deposit()',
  app: 'WETH',
  label: 'Wrap ETH',
  budget: { kind: 'native-value' },
});
const unwrap = (weth: Address): PresetCallDefinition => ({
  target: weth,
  selector: 'withdraw(uint256)',
  app: 'WETH',
  label: 'Unwrap WETH',
  budget: { kind: 'native-amount', amountArg: 0 },
});
const approveWeth = (
  weth: Address,
  spender: Address,
  app: string
): PresetCallDefinition => ({
  target: weth,
  selector: 'approve(address,uint256)',
  pins: [{ arg: 0, expected: spender }],
  app,
  label: 'Approve WETH spending',
  budget: { kind: 'native-amount', amountArg: 1 },
});

const uniswap = (
  router: Address,
  weth: Address,
  usdc: Address
): PresetCallDefinition[] => {
  const swap = (
    exactInput: boolean,
    tokenIn: Address,
    tokenOut: Address
  ): PresetCallDefinition => {
    const amountArg = [0, exactInput ? 4 : 5] as const;
    return {
      target: router,
      selector: `${
        exactInput ? 'exactInputSingle' : 'exactOutputSingle'
      }(${SWAP_STRUCT})`,
      pins: [
        { arg: [0, 0], expected: tokenIn },
        { arg: [0, 1], expected: tokenOut },
        { arg: [0, 3], expected: wallet },
        ...(tokenIn === usdc ? [{ arg: amountArg, max: USDC_PER_SWAP }] : []),
      ],
      app: 'Uniswap V3',
      label: `${exactInput ? 'Swap exact input' : 'Swap exact output'} (${
        tokenIn === weth ? 'WETH to USDC' : 'USDC to WETH'
      })`,
      ...(tokenIn === weth
        ? { budget: { kind: 'native-amount' as const, amountArg } }
        : {}),
    };
  };
  return [
    wrap(weth),
    approveWeth(weth, router, 'Uniswap V3'),
    swap(true, weth, usdc),
    swap(false, weth, usdc),
    {
      target: usdc,
      selector: 'approve(address,uint256)',
      pins: [
        { arg: 0, expected: router },
        { arg: 1, max: USDC_PER_SWAP },
      ],
      app: 'Uniswap V3',
      label: 'Approve USDC spending',
    },
    swap(true, usdc, weth),
    swap(false, usdc, weth),
    unwrap(weth),
  ];
};

const aave = (pool: Address, weth: Address): PresetCallDefinition[] => [
  wrap(weth),
  approveWeth(weth, pool, 'Aave V3'),
  ...(
    [
      ['supply(address,uint256,address,uint16)', 2, 'Supply'],
      ['withdraw(address,uint256,address)', 2, 'Withdraw'],
      ['borrow(address,uint256,uint256,uint16,address)', 4, 'Borrow'],
      ['repay(address,uint256,uint256,address)', 3, 'Repay'],
    ] as const
  ).map(
    ([selector, beneficiary, label]): PresetCallDefinition => ({
      target: pool,
      selector,
      pins: [
        { arg: 0, expected: weth },
        { arg: beneficiary, expected: wallet },
      ],
      app: 'Aave V3',
      label,
      budget: { kind: 'native-amount', amountArg: 1 },
    })
  ),
  unwrap(weth),
];

export const PRESET_CATALOG: readonly PresetDefinition[] = [
  {
    constant: 'DEXES',
    name: 'Popular DEXes',
    chains: (
      [
        [
          'eip155:11155111',
          '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
          '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
          '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        ],
        [
          'eip155:84532',
          '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
          '0x4200000000000000000000000000000000000006',
          '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        ],
        [
          'eip155:421614',
          '0x101F443B4d1b059569D643917553c771E1b9663E',
          '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
          '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
        ],
      ] as const
    ).map(([chainNamespace, router, weth, usdc]) => ({
      chainNamespace,
      allowedCalls: uniswap(address(router), address(weth), address(usdc)),
    })),
  },
  {
    constant: 'LENDING',
    name: 'Lending',
    chains: (
      [
        [
          'eip155:11155111',
          '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951',
          // Aave's own Sepolia WETH reserve, not the canonical WETH.
          '0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c',
        ],
        [
          'eip155:84532',
          '0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27',
          '0x4200000000000000000000000000000000000006',
        ],
        [
          'eip155:421614',
          '0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff',
          // Aave's own Arbitrum Sepolia WETH reserve.
          '0x1dF462e2712496373A347f8ad10802a5E95f053D',
        ],
      ] as const
    ).map(([chainNamespace, pool, weth]) => ({
      chainNamespace,
      allowedCalls: aave(address(pool), address(weth)),
    })),
  },
  { constant: 'STAKING', name: 'Staking', chains: [] },
];
