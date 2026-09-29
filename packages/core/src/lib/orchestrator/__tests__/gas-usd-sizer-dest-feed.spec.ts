/**
 * `sizeOutboundGas` and `computeGasUsd` price the destination gas fee in USD.
 * The fee is denominated in the destination native (pETH / pBNB / pSOL), so
 * the feed must be the destination's own feed. These tests pin that selection
 * for a BNB destination, where the EVM default (ETH) is wrong by the ETH/BNB
 * ratio rather than by a rounding error.
 */
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import type { OrchestratorContext } from '../internals/context';
import { sizeOutboundGas } from '../internals/gas-usd-sizer';
import { __resetPcUsdCache } from '../internals/pc-usd-oracle';

const mockGetPrice = jest.fn();
jest.mock('../../price-fetch/price-fetch', () => ({
  PriceFetch: jest.fn().mockImplementation(() => ({
    getPrice: (...args: any[]) => mockGetPrice(...args),
  })),
}));

// Constant QuoterV2 output: "1 WPC = 0.10 USDT" (10 cents), matching the
// sibling gas-usd-sizer.spec.ts so both specs price against the same PC rate.
const STABLE_PER_WPC_6D = BigInt(100_000);

function makeCtx(): OrchestratorContext {
  const readContract = jest.fn(async ({ functionName }: any) => {
    switch (functionName) {
      case 'universalCore':
        return '0x0000000000000000000000000000000000001111';
      case 'WPC':
        return '0x0000000000000000000000000000000000002222';
      case 'uniswapV3Factory':
        return '0x0000000000000000000000000000000000003333';
      case 'defaultFeeTier':
        return 500;
      case 'getPool':
        return '0x0000000000000000000000000000000000004444';
      case 'quoteExactInputSingle':
        return [STABLE_PER_WPC_6D, BigInt(0), 0, BigInt(0)];
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
      account: { chain: CHAIN.ETHEREUM_SEPOLIA, address: '0xOwner' },
    } as any,
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls: {},
    printTraces: false,
    accountStatusCache: null,
  } as OrchestratorContext;
}

// Distinct per-chain prices so a mis-selected feed is visible in the result.
// 1e8 USD convention.
const ETH_USD = BigInt(3000_0000_0000); // $3,000
const BNB_USD = BigInt(600_0000_0000); // $600

beforeEach(() => {
  __resetPcUsdCache();
  mockGetPrice.mockReset();
  mockGetPrice.mockImplementation(async (chain: CHAIN) => {
    if (chain === CHAIN.SOLANA_DEVNET) return BigInt(150_0000_0000);
    if (chain === CHAIN.BNB_TESTNET) return BNB_USD;
    return ETH_USD;
  });
});

describe('sizeOutboundGas — destination price feed selection', () => {
  it('prices an Ethereum destination off the ETH feed', async () => {
    const decision = await sizeOutboundGas(makeCtx(), {
      gasFee: BigInt(1e14), // 0.0001 ETH
      originChain: CHAIN.ETHEREUM_SEPOLIA,
      destinationChain: CHAIN.ETHEREUM_SEPOLIA,
    });

    expect(mockGetPrice).toHaveBeenCalledWith(CHAIN.ETHEREUM_SEPOLIA);
    expect(decision.gasUsd).toBe(BigInt(30_000_000)); // $0.30
  });

  it('prices a BNB destination off the BNB feed, not the EVM default', async () => {
    const decision = await sizeOutboundGas(makeCtx(), {
      gasFee: BigInt(1e14), // 0.0001 BNB
      originChain: CHAIN.ETHEREUM_SEPOLIA,
      destinationChain: CHAIN.BNB_TESTNET,
    });

    expect(mockGetPrice).toHaveBeenCalledWith(CHAIN.BNB_TESTNET);
    expect(decision.gasUsd).toBe(BigInt(6_000_000)); // $0.06 at $600/BNB
  });

  it('keeps a BNB fee in the Case B band rather than inflating it into Case C', async () => {
    const decision = await sizeOutboundGas(makeCtx(), {
      gasFee: BigInt(1e16), // 0.01 BNB = $6.00 at the BNB feed
      originChain: CHAIN.ETHEREUM_SEPOLIA,
      destinationChain: CHAIN.BNB_TESTNET,
    });

    // Priced off ETH this same fee reads as $30.00, which crosses the $10
    // Case C threshold and inflates the deposited gas leg.
    expect(decision.gasUsd).toBe(BigInt(600_000_000)); // $6.00
    expect(decision.category).toBe('B');
    expect(decision.overflowNativePc).toBe(BigInt(0));
  });

  it('falls back to the testnet counterpart for a chain with no configured feed', async () => {
    const decision = await sizeOutboundGas(makeCtx(), {
      gasFee: BigInt(1e14),
      originChain: CHAIN.ETHEREUM_SEPOLIA,
      destinationChain: CHAIN.SOLANA_TESTNET,
    });

    expect(mockGetPrice).toHaveBeenCalledWith(CHAIN.SOLANA_DEVNET);
    expect(decision.gasUsd).toBeGreaterThan(BigInt(0));
  });
});
