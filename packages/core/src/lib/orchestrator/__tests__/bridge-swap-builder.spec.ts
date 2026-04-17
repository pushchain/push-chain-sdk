/**
 * Unit tests for bridge-swap-builder.ts (SDK 5.2 Case C overflow bridging).
 *
 * Verifies:
 *   - Wrap + approve + swap multicall entries are emitted in order
 *   - expectedPrc20Out applies the slippage floor correctly
 *   - Fee-tier resolution falls back to factory probe when defaultFeeTier=0
 *   - Quote=0 and zero overflow are rejected
 */
import { decodeFunctionData } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import type { OrchestratorContext } from '../internals/context';
import { buildBridgeSwapEntries } from '../internals/bridge-swap-builder';
import {
  ERC20_EVM,
  UNIV3_SWAP_ROUTER_EVM,
  WPC_EVM,
} from '../../constants/abi';

const WPC = '0x0000000000000000000000000000000000002222' as const;
const PETH = '0x0000000000000000000000000000000000005555' as const;
const UEA = '0x0000000000000000000000000000000000009999' as const;
const FACTORY = '0x0000000000000000000000000000000000003333' as const;
const POOL = '0x0000000000000000000000000000000000004444' as const;
const SWAP_ROUTER = '0x5D548bB9E305AAe0d6dc6e6fdc3ab419f6aC0037';
const QUOTER = '0x83316275f7C2F79BC4E26f089333e88E89093037';

function makeCtx(
  opts: {
    defaultFeeTier?: number;
    quotedOut?: bigint;
    factoryProbeResults?: Record<number, string>;
  } = {}
): OrchestratorContext {
  const defaultFeeTier = opts.defaultFeeTier ?? 500;
  const quotedOut = opts.quotedOut ?? BigInt(1_000_000_000_000_000_000); // 1e18 pETH

  const readContract = jest.fn(async ({ functionName, args }: any) => {
    switch (functionName) {
      case 'UNIVERSAL_CORE':
        return '0x0000000000000000000000000000000000001111';
      case 'WPC':
        return WPC;
      case 'uniswapV3Factory':
        return FACTORY;
      case 'defaultFeeTier':
        return defaultFeeTier;
      case 'getPool': {
        const fee = args[2] as number;
        if (opts.factoryProbeResults) {
          return (
            opts.factoryProbeResults[fee] ??
            '0x0000000000000000000000000000000000000000'
          );
        }
        return POOL;
      }
      case 'quoteExactInputSingle':
        return [quotedOut, BigInt(0), 0, BigInt(0)];
      default:
        throw new Error(`unexpected readContract call: ${functionName}`);
    }
  });

  return {
    pushClient: { readContract } as any,
    universalSigner: {
      account: { chain: CHAIN.ETHEREUM_SEPOLIA, address: '0xowner' },
    } as any,
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls: {},
    printTraces: false,
    accountStatusCache: null,
  } as OrchestratorContext;
}

describe('buildBridgeSwapEntries', () => {
  it('emits [wrap, approve, swap] entries in order with correct shapes', async () => {
    const overflow = BigInt(5_000_000_000_000_000_000); // 5 PC
    const ctx = makeCtx();

    const { entries, expectedPrc20Out, quotedPrc20Out, feeTier } =
      await buildBridgeSwapEntries(ctx, {
        overflowNativePc: overflow,
        destinationPrc20: PETH,
        ueaAddress: UEA,
      });

    expect(entries).toHaveLength(3);

    // Entry 1: WPC.deposit{value: overflow}()
    expect(entries[0].to.toLowerCase()).toBe(WPC.toLowerCase());
    expect(entries[0].value).toBe(overflow);
    const wrap = decodeFunctionData({ abi: WPC_EVM, data: entries[0].data });
    expect(wrap.functionName).toBe('deposit');

    // Entry 2: WPC.approve(SwapRouter, overflow)
    expect(entries[1].to.toLowerCase()).toBe(WPC.toLowerCase());
    expect(entries[1].value).toBe(BigInt(0));
    const approve = decodeFunctionData({
      abi: ERC20_EVM,
      data: entries[1].data,
    });
    expect(approve.functionName).toBe('approve');
    expect((approve.args![0] as string).toLowerCase()).toBe(
      SWAP_ROUTER.toLowerCase()
    );
    expect(approve.args![1]).toBe(overflow);

    // Entry 3: SwapRouter.exactInputSingle({...})
    expect(entries[2].to.toLowerCase()).toBe(SWAP_ROUTER.toLowerCase());
    expect(entries[2].value).toBe(BigInt(0));
    const swap = decodeFunctionData({
      abi: UNIV3_SWAP_ROUTER_EVM,
      data: entries[2].data,
    });
    expect(swap.functionName).toBe('exactInputSingle');
    const p = swap.args![0] as any;
    expect(p.tokenIn.toLowerCase()).toBe(WPC.toLowerCase());
    expect(p.tokenOut.toLowerCase()).toBe(PETH.toLowerCase());
    expect(p.fee).toBe(500);
    expect(p.recipient.toLowerCase()).toBe(UEA.toLowerCase());
    expect(p.amountIn).toBe(overflow);
    expect(p.amountOutMinimum).toBe(expectedPrc20Out);

    // Diagnostic output
    expect(quotedPrc20Out).toBe(BigInt(1e18));
    expect(feeTier).toBe(500);
    // Default slippage = 100 bps = 1%, so expected = quoted * 0.99
    expect(expectedPrc20Out).toBe((quotedPrc20Out * BigInt(9900)) / BigInt(10000));
  });

  it('respects slippageBps override', async () => {
    const overflow = BigInt(1e18);
    const ctx = makeCtx({ quotedOut: BigInt(2e18) });

    const { expectedPrc20Out } = await buildBridgeSwapEntries(ctx, {
      overflowNativePc: overflow,
      destinationPrc20: PETH,
      ueaAddress: UEA,
      slippageBps: 500, // 5%
    });

    // 2e18 * 0.95 = 1.9e18
    expect(expectedPrc20Out).toBe(BigInt(19) * BigInt(1e17));
  });

  it('probes fee tiers when UniversalCore.defaultFeeTier returns 0', async () => {
    const ctx = makeCtx({
      defaultFeeTier: 0,
      factoryProbeResults: {
        100: '0x0000000000000000000000000000000000000000',
        500: POOL, // live at fee=500
        3000: '0x0000000000000000000000000000000000000000',
        10000: '0x0000000000000000000000000000000000000000',
      },
    });

    const { feeTier } = await buildBridgeSwapEntries(ctx, {
      overflowNativePc: BigInt(1e18),
      destinationPrc20: PETH,
      ueaAddress: UEA,
    });

    expect(feeTier).toBe(500);
  });

  it('throws when overflow is zero or negative', async () => {
    const ctx = makeCtx();
    await expect(
      buildBridgeSwapEntries(ctx, {
        overflowNativePc: BigInt(0),
        destinationPrc20: PETH,
        ueaAddress: UEA,
      })
    ).rejects.toThrow(/overflowNativePc must be > 0/);
  });

  it('throws when quoter returns zero (illiquid pool)', async () => {
    const ctx = makeCtx({ quotedOut: BigInt(0) });
    await expect(
      buildBridgeSwapEntries(ctx, {
        overflowNativePc: BigInt(1e18),
        destinationPrc20: PETH,
        ueaAddress: UEA,
      })
    ).rejects.toThrow(/QuoterV2 returned 0/);
  });

  it('throws when no pool found at any fee tier', async () => {
    const ctx = makeCtx({
      defaultFeeTier: 0,
      factoryProbeResults: {
        100: '0x0000000000000000000000000000000000000000',
        500: '0x0000000000000000000000000000000000000000',
        3000: '0x0000000000000000000000000000000000000000',
        10000: '0x0000000000000000000000000000000000000000',
      },
    });

    await expect(
      buildBridgeSwapEntries(ctx, {
        overflowNativePc: BigInt(1e18),
        destinationPrc20: PETH,
        ueaAddress: UEA,
      })
    ).rejects.toThrow(/no WPC\/.* pool found/);
  });
});

// Reference SWAP_ROUTER + QUOTER to keep them used; verifies chain-constant test fixture.
void QUOTER;
