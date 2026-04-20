/**
 * Unit tests for gas-usd-sizer.ts and pc-usd-oracle.ts (SDK 5.2 gas abstraction).
 *
 * Verifies the A/B/C categorization:
 *   - A: gasUsd <  $1        → floor to $1 worth of native PC
 *   - B: $1 ≤ gasUsd ≤ $10   → happy path, no overflow
 *   - C: gasUsd >  $10       → $10 gas leg + overflow
 *
 * Mocks PriceFetch (destination-native/USD) and pushClient.readContract
 * (WPC/stable QuoterV2) so tests are hermetic.
 */
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import type { OrchestratorContext } from '../internals/context';
import {
  sizeOutboundGas,
  sizeR1PushGas,
  __THRESHOLDS,
} from '../internals/gas-usd-sizer';
import { __resetPcUsdCache } from '../internals/pc-usd-oracle';

// Module-level mock of PriceFetch — returns a fixed destination-native USD price
// per test. 1e8 decimals convention.
const mockGetPrice = jest.fn();
jest.mock('../../price-fetch/price-fetch', () => ({
  PriceFetch: jest.fn().mockImplementation(() => ({
    getPrice: (...args: any[]) => mockGetPrice(...args),
  })),
}));

// Constant QuoterV2 output: "1 WPC = 0.10 USDT" (10 cents).
// In 6-decimal USDT units: 100_000. Normalized to 1e8 USD: 100_000 * 100 = 10_000_000 = $0.10.
const PC_USD_1E8 = BigInt(10_000_000); // $0.10 per WPC
const STABLE_PER_WPC_6D = BigInt(100_000); // 0.10 USDT in 6 decimals

function makeCtx(overrides: Record<string, any> = {}): OrchestratorContext {
  // `readContract` is called in this order by pc-usd-oracle.ts:getPcUsdPrice
  //   1. UNIVERSAL_GATEWAY_PC.UNIVERSAL_CORE
  //   2. UniversalCore.WPC + UniversalCore.defaultFeeTier (Promise.all)
  //   3. QuoterV2.quoteExactInputSingle
  // Use a named-arg mock so order matters less than content.
  const readContract = jest.fn(async ({ functionName }: any) => {
    switch (functionName) {
      case 'UNIVERSAL_CORE':
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
      pushToUSDC: jest.fn((amt: bigint) => (amt * BigInt(10)) / BigInt(100)), // $0.10/PC fallback
      usdcToPush: jest.fn((usd: bigint) => (usd * BigInt(100)) / BigInt(10)), // $0.10/PC fallback
    } as any,
    universalSigner: {
      account: {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: '0xOwner',
      },
    } as any,
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls: {},
    printTraces: false,
    accountStatusCache: null,
    ...overrides,
  } as OrchestratorContext;
}

beforeEach(() => {
  __resetPcUsdCache();
  mockGetPrice.mockReset();
});

describe('sizeOutboundGas — EVM destination (Ethereum Sepolia)', () => {
  const eth3500 = BigInt(3500_0000_0000); // $3,500 in 1e8

  it('Case A: gas < $1 → category A, gasLegNativePc = $1 worth', async () => {
    mockGetPrice.mockResolvedValue(eth3500);
    const ctx = makeCtx();

    // 0.0001 ETH @ $3,500 = $0.35 → below $1 floor
    const gasFee = BigInt(1e14); // 0.0001 ETH (1e18 * 0.0001)

    const decision = await sizeOutboundGas(ctx, {
      gasFee,
      originChain: CHAIN.ETHEREUM_SEPOLIA,
      destinationChain: CHAIN.ETHEREUM_SEPOLIA,
    });

    expect(decision.category).toBe('A');
    expect(decision.gasUsd).toBe(__THRESHOLDS.ONE_USD_8D / BigInt(100) * BigInt(35)); // $0.35
    // $1 / $0.10 per PC = 10 PC = 10e18
    expect(decision.gasLegNativePc).toBe(BigInt(10) * BigInt(1e18));
    expect(decision.overflowNativePc).toBe(BigInt(0));
    expect(decision.overflowUsd).toBe(BigInt(0));
  });

  it('Case B: $1 ≤ gas ≤ $10 → category B, gasLegNativePc = gasUsd equivalent', async () => {
    mockGetPrice.mockResolvedValue(eth3500);
    const ctx = makeCtx();

    // 0.001 ETH @ $3,500 = $3.50 → inside window
    const gasFee = BigInt(1e15); // 0.001 ETH

    const decision = await sizeOutboundGas(ctx, {
      gasFee,
      originChain: CHAIN.ETHEREUM_SEPOLIA,
      destinationChain: CHAIN.ETHEREUM_SEPOLIA,
    });

    expect(decision.category).toBe('B');
    // $3.50 in 1e8 = 350_000_000
    expect(decision.gasUsd).toBe(BigInt(350_000_000));
    // $3.50 / $0.10 per PC = 35 PC
    expect(decision.gasLegNativePc).toBe(BigInt(35) * BigInt(1e18));
    expect(decision.overflowNativePc).toBe(BigInt(0));
  });

  it('Case C: gas > $10 → category C, $10 gas leg + overflow bridged', async () => {
    mockGetPrice.mockResolvedValue(eth3500);
    const ctx = makeCtx();

    // 0.01 ETH @ $3,500 = $35.00 → above $10 cap
    const gasFee = BigInt(1e16); // 0.01 ETH

    const decision = await sizeOutboundGas(ctx, {
      gasFee,
      originChain: CHAIN.ETHEREUM_SEPOLIA,
      destinationChain: CHAIN.ETHEREUM_SEPOLIA,
    });

    expect(decision.category).toBe('C');
    // $35 in 1e8 = 3_500_000_000
    expect(decision.gasUsd).toBe(BigInt(3_500_000_000));
    // Gas leg capped at $10 worth = 100 PC at $0.10/PC
    expect(decision.gasLegNativePc).toBe(BigInt(100) * BigInt(1e18));
    // Overflow = $25 = 250 PC
    expect(decision.overflowNativePc).toBe(BigInt(250) * BigInt(1e18));
    // Overflow USD = $25 in 1e8
    expect(decision.overflowUsd).toBe(BigInt(2_500_000_000));
  });

  it('exactly $1 boundary → Case B (not A)', async () => {
    mockGetPrice.mockResolvedValue(eth3500);
    const ctx = makeCtx();

    // Fee such that gasUsd lands at exactly $1 (1e8). Round up to beat the
    // integer division floor that otherwise yields $0.99999999.
    const gasFee = BigInt(1e18) / BigInt(3500) + BigInt(1);

    const decision = await sizeOutboundGas(ctx, {
      gasFee,
      originChain: CHAIN.ETHEREUM_SEPOLIA,
      destinationChain: CHAIN.ETHEREUM_SEPOLIA,
    });

    expect(decision.category).toBe('B');
    expect(decision.overflowNativePc).toBe(BigInt(0));
  });

  it('exactly $10 boundary → Case B (not C)', async () => {
    mockGetPrice.mockResolvedValue(eth3500);
    const ctx = makeCtx();

    const gasFee = (BigInt(10) * BigInt(1e18)) / BigInt(3500); // $10 worth of ETH

    const decision = await sizeOutboundGas(ctx, {
      gasFee,
      originChain: CHAIN.ETHEREUM_SEPOLIA,
      destinationChain: CHAIN.ETHEREUM_SEPOLIA,
    });

    expect(decision.category).toBe('B');
    expect(decision.overflowNativePc).toBe(BigInt(0));
  });
});

describe('sizeOutboundGas — SVM destination (Solana Devnet)', () => {
  const sol150 = BigInt(150_0000_0000); // $150 in 1e8

  it('Case B on Solana: 0.02 SOL @ $150 = $3.00', async () => {
    mockGetPrice.mockResolvedValue(sol150);
    const ctx = makeCtx();

    // 0.02 SOL in 9 decimals = 2e7
    const gasFee = BigInt(2e7);

    const decision = await sizeOutboundGas(ctx, {
      gasFee,
      originChain: CHAIN.SOLANA_DEVNET,
      destinationChain: CHAIN.SOLANA_DEVNET,
    });

    expect(decision.category).toBe('B');
    expect(decision.gasUsd).toBe(BigInt(300_000_000)); // $3.00
  });
});

describe('sizeOutboundGas — oracle fallback', () => {
  it('falls back to pushClient.usdcToPush when QuoterV2 returns 0', async () => {
    mockGetPrice.mockResolvedValue(BigInt(3500_0000_0000));

    // Make quoter return 0 → getPcUsdPrice returns 0 → usdToPc uses fallback
    const readContract = jest.fn(async ({ functionName }: any) => {
      if (functionName === 'quoteExactInputSingle') {
        return [BigInt(0), BigInt(0), 0, BigInt(0)];
      }
      if (functionName === 'UNIVERSAL_CORE')
        return '0x0000000000000000000000000000000000001111';
      if (functionName === 'WPC')
        return '0x0000000000000000000000000000000000002222';
      if (functionName === 'defaultFeeTier') return 500;
      throw new Error('unexpected');
    });

    const ctx = makeCtx({ pushClient: {
      readContract,
      pushToUSDC: jest.fn(),
      usdcToPush: jest.fn((usd: bigint) => (usd * BigInt(1000)) / BigInt(100)), // fallback rate
    } as any });

    const gasFee = BigInt(1e15); // 0.001 ETH = $3.50 at $3,500

    const decision = await sizeOutboundGas(ctx, {
      gasFee,
      originChain: CHAIN.ETHEREUM_SEPOLIA,
      destinationChain: CHAIN.ETHEREUM_SEPOLIA,
    });

    expect(decision.category).toBe('B');
    // usdcToPush fallback called for the gas leg conversion
    expect((ctx.pushClient as any).usdcToPush).toHaveBeenCalled();
  });

  it('factory probes fee tier when defaultFeeTier returns 0 (real testnet shape)', async () => {
    mockGetPrice.mockResolvedValue(BigInt(3500_0000_0000));

    // Simulate the live testnet: defaultFeeTier(stable) returns 0, factory
    // has the pool at fee=500. We track which fee tiers are probed.
    const probedTiers: number[] = [];
    const readContract = jest.fn(async ({ functionName, args }: any) => {
      switch (functionName) {
        case 'UNIVERSAL_CORE':
          return '0x0000000000000000000000000000000000001111';
        case 'WPC':
          return '0x0000000000000000000000000000000000002222';
        case 'uniswapV3Factory':
          return '0x0000000000000000000000000000000000003333';
        case 'defaultFeeTier':
          return 0; // unset on the contract for stables
        case 'getPool': {
          const fee = args[2] as number;
          probedTiers.push(fee);
          // Only fee=500 has a pool, others return zero address.
          return fee === 500
            ? '0x0000000000000000000000000000000000004444'
            : '0x0000000000000000000000000000000000000000';
        }
        case 'quoteExactInputSingle':
          return [STABLE_PER_WPC_6D, BigInt(0), 0, BigInt(0)];
        default:
          throw new Error(`unexpected readContract call: ${functionName}`);
      }
    });

    const ctx = makeCtx({ pushClient: {
      readContract,
      pushToUSDC: jest.fn(),
      usdcToPush: jest.fn(),
    } as any });

    const decision = await sizeOutboundGas(ctx, {
      gasFee: BigInt(1e15), // $3.50
      originChain: CHAIN.ETHEREUM_SEPOLIA,
      destinationChain: CHAIN.ETHEREUM_SEPOLIA,
    });

    expect(decision.category).toBe('B');
    // Probe stopped at 500 (first tier); did not fall through to 3000/100/10000
    expect(probedTiers).toEqual([500]);
    // Quoter must have been called — oracle actually resolved a price
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'quoteExactInputSingle' })
    );
    // Oracle resolved → should NOT have fallen back to hardcoded usdcToPush
    expect((ctx.pushClient as any).usdcToPush).not.toHaveBeenCalled();
  });

  it('PriceFetch failure → passthrough as Case B at $1 floor', async () => {
    mockGetPrice.mockRejectedValue(new Error('oracle down'));
    const ctx = makeCtx();

    const decision = await sizeOutboundGas(ctx, {
      gasFee: BigInt(1e15),
      originChain: CHAIN.ETHEREUM_SEPOLIA,
      destinationChain: CHAIN.ETHEREUM_SEPOLIA,
    });

    expect(decision.category).toBe('B');
    expect(decision.overflowNativePc).toBe(BigInt(0));
  });
});

// Mock pool reads return $0.10 per WPC, so USD conversions work like:
//   1 UPC wei * $0.10/PC / 1e18 = 1e-19 USD per wei. To land at specific
//   USD targets (8-dec), input pushGasFeeWei = usd_8d * 1e10 / pcUsdPrice_8d.
//   With pcUsdPrice = 1e7 ($0.10), that's pushGasFeeWei = usd_8d * 1000.
// Simpler: pass the UPC wei amount directly and assert the oracle multiplied it.
describe('sizeR1PushGas — R1 Push-chain gas sizing', () => {
  it('Case A: pushGasUsd < $1 → category A, paddedDepositUsd = $1', async () => {
    const ctx = makeCtx();

    // $0.10 per PC. 3 PC = $0.30. Below $1 floor.
    const pushGasFeeWei = BigInt(3) * BigInt(1e18);

    const decision = await sizeR1PushGas(ctx, {
      pushGasFeeWei,
      originChain: CHAIN.ETHEREUM_SEPOLIA,
    });

    expect(decision.category).toBe('A');
    expect(decision.pushGasUsd).toBe(BigInt(30_000_000)); // $0.30 in 8d
    expect(decision.paddedDepositUsd).toBe(__THRESHOLDS.ONE_USD_8D); // padded to $1
  });

  it('Case B: $1 ≤ pushGasUsd ≤ $10 → category B, paddedDepositUsd = pushGasUsd (pass-through)', async () => {
    const ctx = makeCtx();

    // $0.10 per PC. 50 PC = $5.00. Inside $1-$10 window.
    const pushGasFeeWei = BigInt(50) * BigInt(1e18);

    const decision = await sizeR1PushGas(ctx, {
      pushGasFeeWei,
      originChain: CHAIN.ETHEREUM_SEPOLIA,
    });

    expect(decision.category).toBe('B');
    expect(decision.pushGasUsd).toBe(BigInt(500_000_000)); // $5.00 in 8d
    expect(decision.paddedDepositUsd).toBe(BigInt(500_000_000));
  });

  it('Case C: pushGasUsd > $10 → category C, paddedDepositUsd = pushGasUsd (pass-through, no cap)', async () => {
    const ctx = makeCtx();

    // $0.10 per PC. 500 PC = $50.00. Above $10 → Case C pass-through.
    const pushGasFeeWei = BigInt(500) * BigInt(1e18);

    const decision = await sizeR1PushGas(ctx, {
      pushGasFeeWei,
      originChain: CHAIN.ETHEREUM_SEPOLIA,
    });

    expect(decision.category).toBe('C');
    expect(decision.pushGasUsd).toBe(BigInt(5_000_000_000)); // $50.00 in 8d
    expect(decision.paddedDepositUsd).toBe(BigInt(5_000_000_000)); // no cap applied
  });

  it('boundary: pushGasUsd === $1 exactly → category B (not A)', async () => {
    const ctx = makeCtx();

    // $0.10 per PC. 10 PC = $1.00 exactly.
    const pushGasFeeWei = BigInt(10) * BigInt(1e18);

    const decision = await sizeR1PushGas(ctx, {
      pushGasFeeWei,
      originChain: CHAIN.ETHEREUM_SEPOLIA,
    });

    expect(decision.category).toBe('B');
    expect(decision.pushGasUsd).toBe(__THRESHOLDS.ONE_USD_8D);
    expect(decision.paddedDepositUsd).toBe(__THRESHOLDS.ONE_USD_8D);
  });

  it('boundary: pushGasUsd === $10 exactly → category B (not C)', async () => {
    const ctx = makeCtx();

    // $0.10 per PC. 100 PC = $10.00 exactly.
    const pushGasFeeWei = BigInt(100) * BigInt(1e18);

    const decision = await sizeR1PushGas(ctx, {
      pushGasFeeWei,
      originChain: CHAIN.ETHEREUM_SEPOLIA,
    });

    expect(decision.category).toBe('B');
    expect(decision.pushGasUsd).toBe(__THRESHOLDS.TEN_USD_8D);
    expect(decision.paddedDepositUsd).toBe(__THRESHOLDS.TEN_USD_8D);
  });
});
