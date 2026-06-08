/**
 * Live-data repro for the pETH -> ETH outbound `STF`.
 *
 * The STF is a gas-SIZING bug, not an approval bug. For a pETH -> ETH withdrawal
 * the gateway funds destination gas by swapping the UEA's native PC into pETH
 * (WPC->pETH `exactOutput`), sized by `nativeValueForGas`. `capSwapEstimate`
 * used to cap that to `balance - reserve` whenever the UEA's PC was modest - so
 * a UEA whose PC sat between the 3 PC reserve and the un-buffered swap cost got
 * `nativeValueForGas` sized BELOW what the swap needs, and the swap reverted
 * on-chain with Uniswap `STF` ("STF despite sufficient pETH balance"). The
 * native preflight was self-satisfying, so it never warned.
 *
 * This drives the REAL `estimateNativeValueForSwap` against the live Donut pool:
 *   - ample PC  -> full buffered requirement
 *   - dead-zone PC -> now ALSO the full requirement (not the doomed cap), so the
 *     caller's preflight reports the true shortfall instead of emitting an STF.
 *
 * No funds / no signer needed - reads the live pool only.
 */
import '@e2e/shared/setup';
import { createPublicClient, http, formatEther } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { UNIVERSAL_GATEWAY_PC } from '../../src/lib/constants/abi/universalGatewayPC.evm';
import { UNIVERSAL_CORE_EVM } from '../../src/lib/constants/abi/prc20.evm';
import { getUniversalGatewayPCAddress } from '../../src/lib/orchestrator/internals/helpers';
import { estimateNativeValueForSwap } from '../../src/lib/orchestrator/internals/gas-calculator';
import { runPreflight } from '../../src/lib/orchestrator/internals/preflight';
import { InsufficientUEABalanceError } from '../../src/lib/orchestrator/internals/errors';
import type { OrchestratorContext } from '../../src/lib/orchestrator/internals/context';

const PETH = '0x2971824Db68229D087931155C2b8bB820B275809';
const GAS_RESERVE = BigInt('3000000000000000000'); // 3 PC, mirrors gas-calculator
const DEAD_ZONE_PC = BigInt('20000000000000000000'); // 20 PC - modest UEA balance
const AMPLE_PC = BigInt('100000000000000000000000'); // 100k PC
const BURN_AMOUNT = BigInt('10000000000000000'); // 0.01 pETH
const UEA = '0x1111111111111111111111111111111111111111';

function liveCtx(): OrchestratorContext {
  const pub = createPublicClient({
    transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
  });
  return {
    printTraces: false,
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
    progressHook: () => undefined,
    pushClient: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      readContract: (params: any) => pub.readContract(params),
    },
  } as unknown as OrchestratorContext;
}

async function readLivePethGas(): Promise<{
  ctx: OrchestratorContext;
  universalCore: `0x${string}`;
  gasToken: `0x${string}`;
  gasFee: bigint;
}> {
  const ctx = liveCtx();
  const pub = createPublicClient({
    transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
  });
  const gateway = getUniversalGatewayPCAddress();

  const universalCore = (await pub.readContract({
    address: gateway,
    abi: UNIVERSAL_GATEWAY_PC,
    functionName: 'universalCore',
  })) as `0x${string}`;

  const fees = (await pub.readContract({
    address: universalCore,
    abi: UNIVERSAL_CORE_EVM,
    functionName: 'getOutboundTxGasAndFees',
    args: [PETH, BigInt(0)],
  })) as readonly [`0x${string}`, bigint, bigint, bigint, string, bigint];
  const gasToken = fees[0];
  const gasFee = fees[1];
  expect(gasToken.toLowerCase()).toBe(PETH.toLowerCase()); // same-token route

  return { ctx, universalCore, gasToken, gasFee };
}

describe('Route 2: pETH -> ETH gas sizing (STF repro, live pool)', () => {
  it('surfaces the full gas requirement for a dead-zone UEA instead of undersizing into STF', async () => {
    const { ctx, universalCore, gasToken, gasFee } = await readLivePethGas();

    const ample = await estimateNativeValueForSwap(
      ctx,
      universalCore,
      gasToken,
      gasFee,
      AMPLE_PC
    );
    const deadZone = await estimateNativeValueForSwap(
      ctx,
      universalCore,
      gasToken,
      gasFee,
      DEAD_ZONE_PC
    );

    console.log(
      `gasFee=${formatEther(gasFee)} pETH | ample-balance sizing=${formatEther(
        ample
      )} PC | 20-PC sizing=${formatEther(deadZone)} PC`
    );

    // wpcNeeded (un-buffered) = ample / 2.2; the swap floor.
    const wpcNeeded = (ample * BigInt(10)) / BigInt(22);

    // The fix: a dead-zone balance no longer collapses to balance-reserve
    // (17 PC, < wpcNeeded). It returns the full requirement, which exceeds the
    // 20 PC balance, so runPreflight sees `required + reserve > balance` and
    // reports the real shortfall rather than letting the swap STF.
    expect(deadZone).toBe(ample);
    expect(deadZone).toBeGreaterThan(DEAD_ZONE_PC);
    expect(deadZone - GAS_RESERVE).toBeGreaterThanOrEqual(wpcNeeded);
    // Sanity: the old behavior (balance - reserve = 17 PC) would have been
    // below the swap floor - confirming this route hits the dead-zone.
    expect(DEAD_ZONE_PC - GAS_RESERVE).toBeLessThan(wpcNeeded);
  }, 60000);

  it('simulates sufficient pETH but low PC and throws a native preflight shortfall', async () => {
    const { ctx, universalCore, gasToken, gasFee } = await readLivePethGas();

    const requiredNativeValue = await estimateNativeValueForSwap(
      ctx,
      universalCore,
      gasToken,
      gasFee,
      DEAD_ZONE_PC
    );
    const oldUndersizedValue = DEAD_ZONE_PC - GAS_RESERVE;

    // This is why the old cap was dangerous: with nativeValueForGas set to
    // balance-reserve, preflight was self-satisfying even though the swap was
    // under-funded and would later revert with STF.
    expect(() =>
      runPreflight({
        ctx,
        ueaAddress: UEA,
        ueaBalance: DEAD_ZONE_PC,
        requiredValue: oldUndersizedValue,
        gasReserve: GAS_RESERVE,
        pathTag: 'R2_EVM',
        burnToken: PETH,
        burnAmount: BURN_AMOUNT,
        prc20Balance: BURN_AMOUNT,
        enforceGasCheck: true,
      })
    ).not.toThrow();

    // The fixed sizing keeps the full pool requirement. With pETH balance
    // sufficient but PC balance too low, strict preflight now fails before
    // broadcast with a native PC shortfall instead of allowing an on-chain STF.
    expect(requiredNativeValue).toBeGreaterThan(DEAD_ZONE_PC);
    try {
      runPreflight({
        ctx,
        ueaAddress: UEA,
        ueaBalance: DEAD_ZONE_PC,
        requiredValue: requiredNativeValue,
        gasReserve: GAS_RESERVE,
        pathTag: 'R2_EVM',
        burnToken: PETH,
        burnAmount: BURN_AMOUNT,
        prc20Balance: BURN_AMOUNT,
        enforceGasCheck: true,
      });
      fail('expected native preflight shortfall');
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientUEABalanceError);
      const shortfall = err as InsufficientUEABalanceError;
      expect(shortfall.reason).toBe('NATIVE');
      expect(shortfall.required).toBe(requiredNativeValue + GAS_RESERVE);
      expect(shortfall.available).toBe(DEAD_ZONE_PC);
      expect(shortfall.shortfall).toBe(
        requiredNativeValue + GAS_RESERVE - DEAD_ZONE_PC
      );
    }
  }, 60000);
});
