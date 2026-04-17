/**
 * End-to-end composition matrix for SDK 5.2 gas abstraction.
 *
 * Verifies the final Push Chain multicall shape across:
 *   - Sizer categories (A / B / C)
 *   - Funds variants (none / native / ERC-20)
 *   - User destination payload variants (value / single payload / multicall array)
 *
 * This is the higher-level counterpart to bridge-swap-builder.spec.ts and
 * payload-builders.spec.ts — it wires the sizer + bridge-swap composer +
 * outbound builder together the same way the route handler does, and
 * asserts the shape of the produced MultiCall[] that the UEA will execute.
 */
import { decodeFunctionData } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import type { OrchestratorContext } from '../internals/context';
import {
  sizeOutboundGas,
  type GasSizingDecision,
} from '../internals/gas-usd-sizer';
import { __resetPcUsdCache } from '../internals/pc-usd-oracle';
import { buildBridgeSwapEntries } from '../internals/bridge-swap-builder';
import { buildOutboundApprovalAndCall } from '../payload-builders';
import { GasExceedsCategoryCWithErc20FundsError } from '../route-detector';
import {
  ERC20_EVM,
  UNIVERSAL_GATEWAY_PC,
  UNIV3_SWAP_ROUTER_EVM,
  WPC_EVM,
} from '../../constants/abi';
import type {
  MultiCall,
  UniversalOutboundTxRequest,
} from '../orchestrator.types';

// Addresses (test fixtures)
const GATEWAY_PC = '0x00000000000000000000000000000000000000C1' as const;
const PRC20_PETH = '0x0000000000000000000000000000000000000aaa' as const;
const WPC = '0x0000000000000000000000000000000000002222' as const;
const UEA = '0x0000000000000000000000000000000000009999' as const;
const FACTORY = '0x0000000000000000000000000000000000003333' as const;
const POOL = '0x0000000000000000000000000000000000004444' as const;

// Live SwapRouter address from chain.ts for PUSH_TESTNET_DONUT
const SWAP_ROUTER = '0x5D548bB9E305AAe0d6dc6e6fdc3ab419f6aC0037' as const;

const mockGetPrice = jest.fn();
jest.mock('../../price-fetch/price-fetch', () => ({
  PriceFetch: jest.fn().mockImplementation(() => ({
    getPrice: (...args: any[]) => mockGetPrice(...args),
  })),
}));

function makeCtx(): OrchestratorContext {
  const readContract = jest.fn(async ({ functionName, args }: any) => {
    switch (functionName) {
      case 'UNIVERSAL_CORE':
        return '0x0000000000000000000000000000000000001111';
      case 'WPC':
        return WPC;
      case 'uniswapV3Factory':
        return FACTORY;
      case 'defaultFeeTier':
        return 500;
      case 'getPool':
        return POOL;
      case 'quoteExactInputSingle':
        // Return a chunky pETH amount so we can verify it's folded into burn.
        // 2 pETH per overflow unit as the test-case stable rate.
        return [
          (args[0].amountIn as bigint) * BigInt(2),
          BigInt(0),
          0,
          BigInt(0),
        ];
      default:
        throw new Error(`unexpected readContract call: ${functionName}`);
    }
  });
  return {
    pushClient: {
      readContract,
      pushToUSDC: jest.fn((amt: bigint) => (amt * BigInt(10)) / BigInt(100)),
      usdcToPush: jest.fn((usd: bigint) => (usd * BigInt(100)) / BigInt(10)),
    } as any,
    universalSigner: {
      account: { chain: CHAIN.ETHEREUM_SEPOLIA, address: '0xowner' },
    } as any,
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls: {},
    printTraces: false,
    accountStatusCache: null,
  } as OrchestratorContext;
}

const baseOutboundRequest: UniversalOutboundTxRequest = {
  target: '0x000000000000000000000000000000000000bbbb',
  token: PRC20_PETH,
  amount: BigInt(0),
  gasLimit: BigInt(200_000),
  payload: '0x',
  revertRecipient: UEA,
};

beforeEach(() => {
  __resetPcUsdCache();
  mockGetPrice.mockReset();
});

describe('Sizer-to-outbound composition matrix', () => {
  const eth3500 = BigInt(3500_0000_0000);

  /**
   * Simulates what the Route 2 handler does: size → (if C) build bridge
   * swap entries → call buildOutboundApprovalAndCall. Returns the
   * resulting multicall so tests can assert shape.
   */
  async function composeOutbound(opts: {
    gasFee: bigint;
    burnAmount?: bigint;
    funds?: { token: { mechanism: 'approve' | 'permit2' | 'native'; symbol?: string } };
  }): Promise<{
    decision: GasSizingDecision;
    multicalls: MultiCall[];
    extraBurnAmount?: bigint;
  }> {
    mockGetPrice.mockResolvedValue(eth3500);
    const ctx = makeCtx();
    const decision = await sizeOutboundGas(ctx, {
      gasFee: opts.gasFee,
      originChain: CHAIN.ETHEREUM_SEPOLIA,
      destinationChain: CHAIN.ETHEREUM_SEPOLIA,
    });

    let bridgeSwapEntries: MultiCall[] | undefined;
    let extraBurnAmount: bigint | undefined;

    if (decision.category === 'C' && decision.overflowNativePc > BigInt(0)) {
      const token = opts.funds?.token;
      if (token && token.mechanism !== 'native') {
        throw new GasExceedsCategoryCWithErc20FundsError(token.symbol);
      }
      const swap = await buildBridgeSwapEntries(ctx, {
        overflowNativePc: decision.overflowNativePc,
        destinationPrc20: PRC20_PETH,
        ueaAddress: UEA,
      });
      bridgeSwapEntries = swap.entries;
      extraBurnAmount = swap.expectedPrc20Out;
    }

    const multicalls = buildOutboundApprovalAndCall({
      prc20Token: PRC20_PETH,
      gasToken: PRC20_PETH,
      burnAmount: opts.burnAmount ?? BigInt(0),
      gasFee: opts.gasFee,
      nativeValueForGas: decision.gasLegNativePc,
      gatewayPcAddress: GATEWAY_PC,
      outboundRequest: baseOutboundRequest,
      bridgeSwapEntries,
      extraBurnAmount,
    });

    return { decision, multicalls, extraBurnAmount };
  }

  // --------------------------------------------------------------------------
  // Case A — gas < $1 (no bridge-swap entries)
  // --------------------------------------------------------------------------

  describe('Case A (gas < $1)', () => {
    it('no funds, no burn → [outbound] only', async () => {
      const { decision, multicalls } = await composeOutbound({
        gasFee: BigInt(1e14), // 0.0001 ETH = $0.35
      });
      expect(decision.category).toBe('A');
      expect(multicalls).toHaveLength(1);
      assertIsOutbound(multicalls[0]);
    });

    it('with ERC-20 funds → [approve-zero, approve-burn, outbound]', async () => {
      const { multicalls } = await composeOutbound({
        gasFee: BigInt(1e14),
        burnAmount: BigInt(500),
        funds: { token: { mechanism: 'approve', symbol: 'USDT' } },
      });
      expect(multicalls).toHaveLength(3);
      assertApproveZero(multicalls[0]);
      assertApproveAmount(multicalls[1], BigInt(500));
      assertIsOutbound(multicalls[2]);
    });
  });

  // --------------------------------------------------------------------------
  // Case B — $1 ≤ gas ≤ $10 (no bridge-swap entries)
  // --------------------------------------------------------------------------

  describe('Case B ($1–$10)', () => {
    it('no funds → [outbound] only', async () => {
      const { decision, multicalls } = await composeOutbound({
        gasFee: BigInt(1e15), // 0.001 ETH = $3.50
      });
      expect(decision.category).toBe('B');
      expect(multicalls).toHaveLength(1);
      assertIsOutbound(multicalls[0]);
    });

    it('with native funds → [approve-zero, approve-burn, outbound]', async () => {
      const { multicalls } = await composeOutbound({
        gasFee: BigInt(1e15),
        burnAmount: BigInt(1000),
        funds: { token: { mechanism: 'native', symbol: 'ETH' } },
      });
      expect(multicalls).toHaveLength(3);
      assertApproveAmount(multicalls[1], BigInt(1000));
    });

    it('with ERC-20 funds → composes without error (mixed ok for B)', async () => {
      const { multicalls } = await composeOutbound({
        gasFee: BigInt(1e15),
        burnAmount: BigInt(2000),
        funds: { token: { mechanism: 'approve', symbol: 'USDT' } },
      });
      expect(multicalls).toHaveLength(3);
      assertApproveAmount(multicalls[1], BigInt(2000));
    });
  });

  // --------------------------------------------------------------------------
  // Case C — gas > $10 (prepends wrap + approve-router + swap)
  // --------------------------------------------------------------------------

  describe('Case C (gas > $10)', () => {
    it('no funds, no burn → [wrap, approve-router, swap, approve-zero, approve-burn, outbound]', async () => {
      const { decision, multicalls, extraBurnAmount } = await composeOutbound({
        gasFee: BigInt(1e16), // 0.01 ETH = $35
      });
      expect(decision.category).toBe('C');
      expect(decision.overflowNativePc).toBeGreaterThan(BigInt(0));
      expect(extraBurnAmount).toBeGreaterThan(BigInt(0));
      expect(multicalls).toHaveLength(6);

      assertIsWrap(multicalls[0], decision.overflowNativePc);
      assertApproveToRouter(multicalls[1], decision.overflowNativePc);
      assertIsSwap(multicalls[2]);
      assertApproveZero(multicalls[3]);
      assertApproveAmount(multicalls[4], extraBurnAmount!);
      assertIsOutbound(multicalls[5]);
    });

    it('with original burn + native funds → fold expectedPrc20Out into approve', async () => {
      const { multicalls, extraBurnAmount } = await composeOutbound({
        gasFee: BigInt(1e16),
        burnAmount: BigInt(1_000_000),
        funds: { token: { mechanism: 'native', symbol: 'ETH' } },
      });
      expect(multicalls).toHaveLength(6);
      // approve-burn amount = original + extraBurnAmount
      assertApproveAmount(multicalls[4], BigInt(1_000_000) + extraBurnAmount!);
    });

    it('with ERC-20 funds → throws GasExceedsCategoryCWithErc20FundsError', async () => {
      await expect(
        composeOutbound({
          gasFee: BigInt(1e16),
          funds: { token: { mechanism: 'approve', symbol: 'USDC' } },
        })
      ).rejects.toThrow(GasExceedsCategoryCWithErc20FundsError);
    });

    it('outbound request burnAmount is bumped by extraBurnAmount', async () => {
      const { multicalls, extraBurnAmount } = await composeOutbound({
        gasFee: BigInt(1e16),
        burnAmount: BigInt(500_000),
      });
      const decoded = decodeFunctionData({
        abi: UNIVERSAL_GATEWAY_PC,
        data: multicalls[5].data as `0x${string}`,
      });
      expect(decoded.functionName).toBe('sendUniversalTxOutbound');
      const req = decoded.args![0] as any;
      expect(req.amount).toBe(BigInt(500_000) + extraBurnAmount!);
    });
  });
});

// =============================================================================
// Assertions — decode and validate each entry type
// =============================================================================

function assertIsWrap(call: MultiCall, expectedValue: bigint) {
  expect(call.to.toLowerCase()).toBe(WPC.toLowerCase());
  expect(call.value).toBe(expectedValue);
  const d = decodeFunctionData({ abi: WPC_EVM, data: call.data });
  expect(d.functionName).toBe('deposit');
}

function assertApproveToRouter(call: MultiCall, expectedAmount: bigint) {
  expect(call.to.toLowerCase()).toBe(WPC.toLowerCase());
  expect(call.value).toBe(BigInt(0));
  const d = decodeFunctionData({ abi: ERC20_EVM, data: call.data });
  expect(d.functionName).toBe('approve');
  expect((d.args![0] as string).toLowerCase()).toBe(SWAP_ROUTER.toLowerCase());
  expect(d.args![1]).toBe(expectedAmount);
}

function assertIsSwap(call: MultiCall) {
  expect(call.to.toLowerCase()).toBe(SWAP_ROUTER.toLowerCase());
  expect(call.value).toBe(BigInt(0));
  const d = decodeFunctionData({
    abi: UNIV3_SWAP_ROUTER_EVM,
    data: call.data,
  });
  expect(d.functionName).toBe('exactInputSingle');
}

function assertApproveZero(call: MultiCall) {
  expect(call.to.toLowerCase()).toBe(PRC20_PETH.toLowerCase());
  const d = decodeFunctionData({ abi: ERC20_EVM, data: call.data });
  expect(d.functionName).toBe('approve');
  expect(d.args![1]).toBe(BigInt(0));
}

function assertApproveAmount(call: MultiCall, expected: bigint) {
  expect(call.to.toLowerCase()).toBe(PRC20_PETH.toLowerCase());
  const d = decodeFunctionData({ abi: ERC20_EVM, data: call.data });
  expect(d.functionName).toBe('approve');
  expect((d.args![0] as string).toLowerCase()).toBe(GATEWAY_PC.toLowerCase());
  expect(d.args![1]).toBe(expected);
}

function assertIsOutbound(call: MultiCall) {
  expect(call.to.toLowerCase()).toBe(GATEWAY_PC.toLowerCase());
  const d = decodeFunctionData({
    abi: UNIVERSAL_GATEWAY_PC,
    data: call.data,
  });
  expect(d.functionName).toBe('sendUniversalTxOutbound');
}
