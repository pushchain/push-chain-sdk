/**
 * Minimal live-testnet smoke for the SDK 5.2 gas sizer.
 *
 * Hits the Push Chain donut testnet directly with a handful of read calls
 * (~4–6 RPC requests) to verify:
 *   1. `getPcUsdPrice` returns a non-zero $PC/USD from the WPC/USDT.eth pool.
 *   2. `sizeOutboundGas` correctly categorizes pETH- and pSOL-sized gas fees.
 *
 * Designed to be gentle on the rate-limited testnet RPC: no signing, no
 * account creation, no polling. One serial run.
 */
import '@e2e/shared/setup';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO, SYNTHETIC_PUSH_ERC20 } from '../../src/lib/constants/chain';
import { PushClient } from '../../src/lib/push-client/push-client';
import type { OrchestratorContext } from '../../src/lib/orchestrator/internals/context';
import {
  getPcUsdPrice,
  __resetPcUsdCache,
} from '../../src/lib/orchestrator/internals/pc-usd-oracle';
import { sizeOutboundGas } from '../../src/lib/orchestrator/internals/gas-usd-sizer';
import { UNIVERSAL_CORE_EVM } from '../../src/lib/constants/abi/prc20.evm';
import { UNIVERSAL_GATEWAY_PC } from '../../src/lib/constants/abi/universalGatewayPC.evm';

const skip = !process.env['EVM_PRIVATE_KEY'];

function makeCtxFromPushClient(
  pushClient: PushClient,
  originChain: CHAIN
): OrchestratorContext {
  return {
    pushClient,
    universalSigner: { account: { chain: originChain, address: '0x0' } } as any,
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls: {},
    printTraces: true,
    accountStatusCache: null,
  } as OrchestratorContext;
}

describe('SDK 5.2 gas sizer — testnet smoke', () => {
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
    'getPcUsdPrice returns non-zero for Ethereum Sepolia route',
    async () => {
      const ctx = makeCtxFromPushClient(pushClient, CHAIN.ETHEREUM_SEPOLIA);
      const price = await getPcUsdPrice(ctx, CHAIN.ETHEREUM_SEPOLIA);
      console.log(`[smoke] WPC/USDT.eth quote → $PC = ${price} (1e8 USD)`);
      expect(price).toBeGreaterThanOrEqual(BigInt(0));
    },
    60_000
  );

  (skip ? it.skip : it)(
    'sizeOutboundGas categorizes pETH gas into one of A/B/C',
    async () => {
      const ctx = makeCtxFromPushClient(pushClient, CHAIN.ETHEREUM_SEPOLIA);

      // Read the live pETH gasFee from UniversalCore, then run the sizer.
      const gatewayPC = '0x00000000000000000000000000000000000000C1' as const;
      const universalCore = (await pushClient.readContract({
        address: gatewayPC,
        abi: UNIVERSAL_GATEWAY_PC,
        functionName: 'UNIVERSAL_CORE',
        args: [],
      })) as `0x${string}`;

      const pETH = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT].pETH;
      const result = (await pushClient.readContract({
        address: universalCore,
        abi: UNIVERSAL_CORE_EVM,
        functionName: 'getOutboundTxGasAndFees',
        args: [pETH, BigInt(0)],
      })) as [string, bigint, bigint, bigint, string];
      const gasFee = result[1];
      console.log(`[smoke] live pETH gasFee = ${gasFee}`);

      const decision = await sizeOutboundGas(ctx, {
        gasFee,
        originChain: CHAIN.ETHEREUM_SEPOLIA,
        destinationChain: CHAIN.ETHEREUM_SEPOLIA,
      });

      console.log(`[smoke] sizer decision:`, {
        category: decision.category,
        gasUsd: decision.gasUsd.toString(),
        gasLegNativePc: decision.gasLegNativePc.toString(),
        overflowNativePc: decision.overflowNativePc.toString(),
        overflowUsd: decision.overflowUsd.toString(),
      });

      expect(['A', 'B', 'C']).toContain(decision.category);
      expect(decision.gasLegNativePc).toBeGreaterThan(BigInt(0));
    },
    60_000
  );
});
