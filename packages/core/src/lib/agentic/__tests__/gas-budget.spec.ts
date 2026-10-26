import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import type { Orchestrator } from '../../orchestrator/orchestrator';
import type { OrchestratorContext } from '../../orchestrator/internals/context';
import { quoteGasPoolCost } from '../../orchestrator/internals/gas-pool-quote';
import { agwGasBudget } from '../execution/gas-budget';
import { createAgenticRuntime } from '../runtime';
import { ADDR } from './fake-chain';

// One shared fn: requireActual re-enters this factory through circular imports.
const mockQuery = jest.fn();
jest.mock('../../orchestrator/internals/gas-calculator', () => ({
  ...jest.requireActual('../../orchestrator/internals/gas-calculator'),
  queryOutboundGasFee: (...args: unknown[]) => mockQuery(...args),
}));
const mockFinalize = jest.fn();
jest.mock('../../orchestrator/internals/svm-rent', () => ({
  ...jest.requireActual('../../orchestrator/internals/svm-rent'),
  ensureSvmFinalizeGasBudgetQuote: (...args: unknown[]) =>
    mockFinalize(...args),
}));
const PC = BigInt(10) ** BigInt(18);

describe('AGW gas budget', () => {
  it('excludes protocolFee, which the wallet attaches separately', () => {
    expect(
      agwGasBudget({ protocolFee: BigInt(3), nativeValueForGas: BigInt(13) })
    ).toBe(BigInt(10));
  });
  it('keeps the over-$10 share the sizer splits off for other routes', () => {
    expect(
      agwGasBudget({
        protocolFee: BigInt(0),
        nativeValueForGas: BigInt(100) * PC,
        sizing: { category: 'C', overflowNativePc: BigInt(806) * PC },
      })
    ).toBe(BigInt(906) * PC);
  });
  it('never attaches less than the pool cost plus 20%, rounded up', () => {
    // A Sepolia-UEA BNB first send: sized 23.00 PC, pool needs 23.65 PC.
    const sized = BigInt('22998723343893328290');
    const pool = BigInt('23653617545786043528');
    expect(
      agwGasBudget({ protocolFee: BigInt(0), nativeValueForGas: sized }, pool)
    ).toBe((pool * BigInt(12) + BigInt(9)) / BigInt(10));
    // The $1 floor still wins when the pool is cheap (the observed case).
    expect(
      agwGasBudget(
        { protocolFee: BigInt(0), nativeValueForGas: BigInt(10) * PC },
        BigInt('2069650875064483730')
      )
    ).toBe(BigInt(10) * PC);
  });
});

describe('pool cost quote', () => {
  const ctx = (reads: Record<string, unknown>) =>
    ({
      pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
      printTraces: false,
      pushClient: {
        readContract: jest.fn(
          async ({ functionName }: { functionName: string }) => {
            const value = reads[functionName];
            if (value instanceof Error) throw value;
            return value;
          }
        ),
      },
    } as unknown as OrchestratorContext);
  it('returns the exact-output WPC amount for the gas fee', async () => {
    const c = ctx({
      WPC: ADDR.other,
      defaultFeeTier: 500,
      quoteExactOutputSingle: [BigInt(7), BigInt(0), 0, BigInt(0)],
    });
    await expect(
      quoteGasPoolCost(c, ADDR.target, ADDR.agent, BigInt(5))
    ).resolves.toBe(BigInt(7));
    expect(
      (c.pushClient.readContract as jest.Mock).mock.calls[2][0].args[0]
    ).toEqual({
      tokenIn: ADDR.other,
      tokenOut: ADDR.agent,
      amount: BigInt(5),
      fee: 500,
      sqrtPriceLimitX96: BigInt(0),
    });
  });
  it('is unknown without a fee tier, a fee or a working quoter', async () => {
    await expect(
      quoteGasPoolCost(
        ctx({ WPC: ADDR.other, defaultFeeTier: 0 }),
        ADDR.target,
        ADDR.agent,
        BigInt(5)
      )
    ).resolves.toBeUndefined();
    await expect(
      quoteGasPoolCost(ctx({}), ADDR.target, ADDR.agent, BigInt(0))
    ).resolves.toBeUndefined();
    await expect(
      quoteGasPoolCost(
        ctx({
          WPC: ADDR.other,
          defaultFeeTier: 500,
          quoteExactOutputSingle: new Error('no pool'),
        }),
        ADDR.target,
        ADDR.agent,
        BigInt(5)
      )
    ).resolves.toBeUndefined();
  });
});

describe('AGW runtime quotes', () => {
  const quote = (gasFee: bigint) => ({
    gasToken: ADDR.agent,
    gasFee,
    protocolFee: BigInt(2),
    nativeValueForGas: BigInt(12),
    gasPrice: BigInt(1),
    gasLimitUsed: BigInt(500000),
    universalCoreAddress: ADDR.target,
    sizing: { category: 'A', overflowNativePc: BigInt(0) },
  });
  const runtime = () => {
    const readContract = jest.fn(
      async ({ functionName }: { functionName: string }) =>
        functionName === 'WPC'
          ? ADDR.other
          : functionName === 'defaultFeeTier'
          ? 500
          : functionName === 'baseGasLimitByChainNamespace'
          ? BigInt(500000)
          : [BigInt(50), BigInt(0), 0, BigInt(0)]
    );
    return createAgenticRuntime(
      {
        getNetwork: () => PUSH_NETWORK.TESTNET_DONUT,
        getRpcUrls: () => ({}),
        pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
        pushClient: { readContract },
      } as unknown as Orchestrator,
      true
    );
  };
  const svm = { wallet: ADDR.owner, burnAmount: BigInt(1) };
  beforeEach(() => {
    mockQuery.mockReset();
    mockFinalize.mockReset();
  });

  it('return the pool-safe budget and keep protocolFee separate', async () => {
    mockQuery.mockResolvedValue(quote(BigInt(5)));
    await expect(
      runtime().quoteOutbound(ADDR.agent, BigInt(0), CHAIN.ETHEREUM_SEPOLIA)
    ).resolves.toEqual({
      protocolFee: BigInt(2),
      nativeValueForGas: BigInt(60),
      gasLimitUsed: BigInt(500000),
      gasFee: BigInt(5),
      poolPcIn: BigInt(50),
    });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.anything(),
      ADDR.agent,
      BigInt(0),
      CHAIN.ETHEREUM_SEPOLIA
    );
  });
  it('refuse an explicit gasLimit below the chain base before quoting', async () => {
    await expect(
      runtime().quoteOutbound(
        ADDR.agent,
        BigInt(100000),
        CHAIN.ETHEREUM_SEPOLIA
      )
    ).rejects.toMatchObject({
      code: 'INVALID_RULE',
      details: { field: 'gasLimit', minimum: BigInt(500000) },
    });
    expect(mockQuery).not.toHaveBeenCalled();
    mockQuery.mockResolvedValue(quote(BigInt(5)));
    await expect(
      runtime().quoteOutbound(
        ADDR.agent,
        BigInt(500000),
        CHAIN.ETHEREUM_SEPOLIA
      )
    ).resolves.toMatchObject({ gasFee: BigInt(5) });
  });
  it('re-quote a Solana budget left short by a gas-price change', async () => {
    mockQuery.mockResolvedValue(quote(BigInt(1)));
    mockFinalize
      .mockImplementationOnce(async ({ onMinimum }) => {
        onMinimum(BigInt(10));
        return quote(BigInt(9));
      })
      .mockImplementationOnce(async ({ onMinimum, quote: q }) => {
        onMinimum(BigInt(10));
        expect(q.gasFee).toBe(BigInt(9));
        return quote(BigInt(10));
      });
    await expect(
      runtime().quoteOutbound(ADDR.agent, BigInt(0), CHAIN.SOLANA_DEVNET, svm)
    ).resolves.toMatchObject({ gasFee: BigInt(10) });
    expect(mockFinalize).toHaveBeenCalledTimes(2);
  });
  it('refuse a Solana budget that stays short after re-quoting', async () => {
    mockQuery.mockResolvedValue(quote(BigInt(1)));
    mockFinalize.mockImplementation(async ({ onMinimum }) => {
      onMinimum(BigInt(10));
      return quote(BigInt(9));
    });
    await expect(
      runtime().quoteOutbound(ADDR.agent, BigInt(0), CHAIN.SOLANA_DEVNET, svm)
    ).rejects.toMatchObject({ code: 'INCONSISTENT_READ' });
  });
});
