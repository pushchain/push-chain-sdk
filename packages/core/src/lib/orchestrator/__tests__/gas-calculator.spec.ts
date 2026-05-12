import { PUSH_NETWORK } from '../../constants/enums';
import type { OrchestratorContext } from '../internals/context';
import { estimateNativeValueForSwap } from '../internals/gas-calculator';

const WPC = '0xE17DD2E0509f99E9ee9469Cf6634048Ec5a3ADe9';
const PSOL = '0x5D525Df2bD99a6e7ec58b76aF2fd95F39874EBed';
const FACTORY = '0x81b8Bca02580C7d6b636051FDb7baAC436bFb454';

function makeCtx(): OrchestratorContext {
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
            return [BigInt(10), BigInt(0), 0, BigInt(0)];
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
});
