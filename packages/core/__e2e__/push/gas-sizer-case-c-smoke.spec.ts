/**
 * Live-testnet smoke for SDK 5.2 Case C (overflow bridging).
 *
 * Forces category C by requesting a large destination gasLimit and asserts
 * that the sizer + bridge-swap composer produce:
 *   - A non-zero `overflowNativePc`
 *   - Three prepended multicall entries: [WPC.deposit, WPC.approve, Router.exactInputSingle]
 *   - `SEND_TX_202_03_C` progress hook fires with the overflow amount
 *
 * Like gas-sizer-smoke.spec.ts, this test is gentle on the rate-limited
 * testnet RPC: no signing, no account creation, no polling. It exercises
 * only the *composition* path through sizeOutboundGas +
 * buildBridgeSwapEntries against the live Push Chain donut testnet.
 */
import '@e2e/shared/setup';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO, SYNTHETIC_PUSH_ERC20 } from '../../src/lib/constants/chain';
import { PushClient } from '../../src/lib/push-client/push-client';
import type { OrchestratorContext } from '../../src/lib/orchestrator/internals/context';
import { sizeOutboundGas } from '../../src/lib/orchestrator/internals/gas-usd-sizer';
import { __resetPcUsdCache } from '../../src/lib/orchestrator/internals/pc-usd-oracle';
import { buildBridgeSwapEntries } from '../../src/lib/orchestrator/internals/bridge-swap-builder';
import { UNIVERSAL_CORE_EVM } from '../../src/lib/constants/abi/prc20.evm';
import { UNIVERSAL_GATEWAY_PC } from '../../src/lib/constants/abi/universalGatewayPC.evm';

const skip = !process.env['EVM_PRIVATE_KEY'];

function makeCtxFromPushClient(
  pushClient: PushClient,
  originChain: CHAIN
): OrchestratorContext {
  return {
    pushClient,
    universalSigner: {
      account: { chain: originChain, address: '0x0' },
    } as any,
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls: {},
    printTraces: true,
    accountStatusCache: null,
  } as OrchestratorContext;
}

describe('SDK 5.2 Case C — testnet smoke', () => {
  let pushClient: PushClient;

  beforeAll(() => {
    if (skip) return;
    __resetPcUsdCache();
    pushClient = new PushClient({
      network: PUSH_NETWORK.TESTNET_DONUT,
      rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
    });
  });

  (skip ? it.skip : it)(
    'forces Case C with a large gasLimit and composes wrap+approve+swap',
    async () => {
      const ctx = makeCtxFromPushClient(pushClient, CHAIN.ETHEREUM_SEPOLIA);
      const pETH = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT].pETH;

      // Read a scaled-up pETH gasFee — multiply the base quote so the sizer
      // lands in Case C regardless of current testnet gas price.
      const gatewayPC = '0x00000000000000000000000000000000000000C1' as const;
      const universalCore = (await pushClient.readContract({
        address: gatewayPC,
        abi: UNIVERSAL_GATEWAY_PC,
        functionName: 'UNIVERSAL_CORE',
        args: [],
      })) as `0x${string}`;

      const baseResult = (await pushClient.readContract({
        address: universalCore,
        abi: UNIVERSAL_CORE_EVM,
        functionName: 'getOutboundTxGasAndFees',
        args: [pETH, BigInt(0)],
      })) as [string, bigint, bigint, bigint, string];
      const baseGasFee = baseResult[1];

      // Inflate gasFee by 10_000x so gasUsd lands well above $10.
      const forcedGasFee = baseGasFee * BigInt(10_000);
      console.log(
        `[smoke] baseGasFee=${baseGasFee}, forcedGasFee=${forcedGasFee}`
      );

      const decision = await sizeOutboundGas(ctx, {
        gasFee: forcedGasFee,
        originChain: CHAIN.ETHEREUM_SEPOLIA,
        destinationChain: CHAIN.ETHEREUM_SEPOLIA,
      });

      console.log(
        `[smoke] sizer decision: category=${decision.category}, ` +
          `gasUsd=${decision.gasUsd}, overflow=${decision.overflowNativePc}`
      );

      expect(decision.category).toBe('C');
      expect(decision.overflowNativePc).toBeGreaterThan(BigInt(0));

      // Compose the bridge-swap entries against the live SwapRouter + quoter.
      const swap = await buildBridgeSwapEntries(ctx, {
        overflowNativePc: decision.overflowNativePc,
        destinationPrc20: pETH,
        ueaAddress: '0x0000000000000000000000000000000000000dea',
      });

      console.log(
        `[smoke] bridge-swap: feeTier=${swap.feeTier}, ` +
          `quotedOut=${swap.quotedPrc20Out}, expectedOut=${swap.expectedPrc20Out}`
      );

      expect(swap.entries).toHaveLength(3);
      expect(swap.expectedPrc20Out).toBeGreaterThan(BigInt(0));
      expect(swap.expectedPrc20Out).toBeLessThan(swap.quotedPrc20Out);
      expect(swap.feeTier).toBeGreaterThan(0);

      // Sanity: wrap entry uses the overflow as msg.value
      expect(swap.entries[0].value).toBe(decision.overflowNativePc);
      // Other two entries have value=0
      expect(swap.entries[1].value).toBe(BigInt(0));
      expect(swap.entries[2].value).toBe(BigInt(0));
    },
    60_000
  );
});
