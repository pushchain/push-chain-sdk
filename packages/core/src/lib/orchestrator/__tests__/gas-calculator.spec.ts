import { PUSH_NETWORK } from '../../constants/enums';
import type { OrchestratorContext } from '../internals/context';
import {
  estimateNativeValueForSwap,
  capSwapEstimate,
} from '../internals/gas-calculator';

const WPC = '0xE17DD2E0509f99E9ee9469Cf6634048Ec5a3ADe9';
const PSOL = '0x5D525Df2bD99a6e7ec58b76aF2fd95F39874EBed';
const FACTORY = '0x81b8Bca02580C7d6b636051FDb7baAC436bFb454';

function makeCtx(amountIn = BigInt(10)): OrchestratorContext {
  return {
    printTraces: false,
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
    pushClient: {
      readContract: jest.fn(
        async ({
          functionName,
        }: {
          functionName: string;
        }) => {
          if (functionName === 'WPC') return WPC;
          if (functionName === 'uniswapV3Factory') return FACTORY;
          if (functionName === 'defaultFeeTier') return 500;
          if (functionName === 'quoteExactOutputSingle') {
            return [amountIn, BigInt(0), 0, BigInt(0)];
          }
          throw new Error(`unexpected readContract ${functionName}`);
        }
      ),
    },
  } as unknown as OrchestratorContext;
}

describe('estimateNativeValueForSwap', () => {
  it('uses QuoterV2 exact-output before slot0 math', async () => {
    const ctx = makeCtx();

    const out = await estimateNativeValueForSwap(
      ctx,
      '0x00000000000000000000000000000000000000C0',
      PSOL,
      BigInt(960000),
      BigInt('1000000000000000000000000000000')
    );

    expect(out).toBe(BigInt(22));
    expect(ctx.pushClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'quoteExactOutputSingle' })
    );
    expect(ctx.pushClient.readContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'getPool' })
    );
  });

  it('does NOT undersize nativeValueForGas when the UEA PC sits in the STF dead-zone', async () => {
    // Real live-Donut numbers for a pETH -> ETH withdrawal:
    //   wpcNeeded (un-buffered) = 38.89 PC, buffered 2.2x = 85.56 PC.
    // A UEA holding 20 PC (between the 3 PC reserve and ~41.9 PC) used to get
    // nativeValueForGas capped at balance - reserve = 17 PC < 38.89 PC, which
    // made the WPC->pETH exactOutput swap revert on-chain with `STF` while the
    // native preflight was self-satisfying. We now surface the full requirement
    // so the preflight reports the real shortfall instead.
    const wpcNeeded = BigInt('38891686808020834136'); // 38.89 PC
    const buffered = (wpcNeeded * BigInt(22)) / BigInt(10); // 85.56 PC
    const ctx = makeCtx(wpcNeeded);

    const out = await estimateNativeValueForSwap(
      ctx,
      '0x00000000000000000000000000000000000000C0',
      PSOL,
      BigInt(960000),
      BigInt('20000000000000000000') // 20 PC - inside the dead-zone
    );

    expect(out).toBe(buffered); // full requirement, NOT the doomed 17 PC
    const reserve = BigInt('3000000000000000000');
    expect(out - reserve).toBeGreaterThan(wpcNeeded); // would clear the swap if funded
  });
});

describe('capSwapEstimate', () => {
  // Real live-Donut pETH-route magnitudes.
  const wpcNeeded = BigInt('38891686808020834136'); // 38.89 PC (swap floor)
  const result = (wpcNeeded * BigInt(22)) / BigInt(10); // 85.56 PC (2.2x buffer)
  const reserve = BigInt('3000000000000000000'); // 3 PC
  const pc = (n: number) => BigInt(n) * BigInt('1000000000000000000');

  it('returns the full buffered estimate when balance is ample', () => {
    expect(capSwapEstimate(result, pc(2318), reserve, wpcNeeded)).toBe(result);
  });

  it('reduces the buffer to balance-reserve while still above the swap floor', () => {
    const balance = pc(50); // balance-reserve = 47 PC >= 38.89 floor
    expect(capSwapEstimate(result, balance, reserve, wpcNeeded)).toBe(
      balance - reserve
    );
  });

  it('does NOT undersize below the swap floor (the STF bug) - returns true need', () => {
    const balance = pc(20); // balance-reserve = 17 PC < 38.89 floor
    // Old behavior returned 17 PC (-> on-chain STF). New behavior returns the
    // full requirement so the preflight flags the shortfall.
    expect(capSwapEstimate(result, balance, reserve, wpcNeeded)).toBe(result);
  });

  it('returns the full requirement when balance is below the reserve', () => {
    expect(capSwapEstimate(result, pc(1), reserve, wpcNeeded)).toBe(result);
  });

  it('preserves legacy behavior when no floor is supplied (minNeeded defaults to 0)', () => {
    const balance = pc(20);
    expect(capSwapEstimate(result, balance, reserve)).toBe(balance - reserve);
  });
});
