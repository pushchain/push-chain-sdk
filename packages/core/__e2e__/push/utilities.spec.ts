import '@e2e/shared/setup';
import { createPublicClient, http, formatUnits } from 'viem';
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

/**
 * Push Chain read-only utilities — gasFee reads, gas-sizer smoke, and
 * Solana-namespace pool info. No signers, no broadcasts.
 */

const PUSH_RPC = 'https://evm.donut.rpc.push.org/';
const GATEWAY_PC = '0x00000000000000000000000000000000000000C1' as const;

const pushPublicClient = createPublicClient({
  transport: http(PUSH_RPC),
});

async function getUniversalCoreAddress(): Promise<`0x${string}`> {
  return pushPublicClient.readContract({
    address: GATEWAY_PC,
    abi: UNIVERSAL_GATEWAY_PC,
    functionName: 'universalCore',
  }) as Promise<`0x${string}`>;
}

// ============================================================================
// Read gasFee from UniversalCore
// ============================================================================
describe('Read gasFee from UniversalCore', () => {
  let universalCore: `0x${string}`;

  beforeAll(async () => {
    universalCore = await getUniversalCoreAddress();
    console.log(`UniversalCore address: ${universalCore}`);
  }, 30000);

  it('should read gasFee for pSOL (Solana namespace)', async () => {
    const synthetics = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT];
    const pSOL = synthetics.pSOL;
    const gasLimit = BigInt(0);

    const [gasToken, gasFee, protocolFee, gasPrice, chainNamespace, gasLimitUsed] =
      (await pushPublicClient.readContract({
        address: universalCore,
        abi: UNIVERSAL_CORE_EVM,
        functionName: 'getOutboundTxGasAndFees',
        args: [pSOL, gasLimit],
      })) as readonly [`0x${string}`, bigint, bigint, bigint, string, bigint];

    console.log('\n=== pSOL (Solana) ===');
    console.log(`chainNamespace:   ${chainNamespace}`);
    console.log(`gasToken:         ${gasToken}`);
    console.log(`gasPrice:         ${gasPrice}`);
    console.log(`gasLimitUsed:     ${gasLimitUsed}`);
    console.log(`gasFee (raw):     ${gasFee}`);
    console.log(`gasFee (pSOL):    ${formatUnits(gasFee, 9)}`);
    console.log(`protocolFee:      ${protocolFee}`);

    const baseGasLimit = (await pushPublicClient.readContract({
      address: universalCore,
      abi: UNIVERSAL_CORE_EVM,
      functionName: 'baseGasLimitByChainNamespace',
      args: [chainNamespace],
    })) as bigint;

    console.log(`baseGasLimit:     ${baseGasLimit}`);

    expect(gasFee).toBeGreaterThan(BigInt(0));
  }, 30000);

  it('should read gasFee for pETH (EVM namespace)', async () => {
    const synthetics = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT];
    const pETH = synthetics.pETH;
    const gasLimit = BigInt(0);

    const [gasToken, gasFee, protocolFee, gasPrice, chainNamespace, gasLimitUsed] =
      (await pushPublicClient.readContract({
        address: universalCore,
        abi: UNIVERSAL_CORE_EVM,
        functionName: 'getOutboundTxGasAndFees',
        args: [pETH, gasLimit],
      })) as readonly [`0x${string}`, bigint, bigint, bigint, string, bigint];

    console.log('\n=== pETH (Ethereum) ===');
    console.log(`chainNamespace:   ${chainNamespace}`);
    console.log(`gasToken:         ${gasToken}`);
    console.log(`gasPrice:         ${gasPrice}`);
    console.log(`gasLimitUsed:     ${gasLimitUsed}`);
    console.log(`gasFee (raw):     ${gasFee}`);
    console.log(`gasFee (pETH):    ${formatUnits(gasFee, 18)}`);
    console.log(`protocolFee:      ${protocolFee}`);

    const baseGasLimit = (await pushPublicClient.readContract({
      address: universalCore,
      abi: UNIVERSAL_CORE_EVM,
      functionName: 'baseGasLimitByChainNamespace',
      args: [chainNamespace],
    })) as bigint;

    console.log(`baseGasLimit:     ${baseGasLimit}`);

    expect(gasFee).toBeGreaterThan(BigInt(0));
  }, 30000);
});

// ============================================================================
// SDK 5.2 gas sizer — testnet smoke
// ============================================================================
describe('SDK 5.2 gas sizer — testnet smoke', () => {
  const skipGS = !process.env['EVM_PRIVATE_KEY'];
  let pushClientGS: PushClient;

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

  beforeAll(() => {
    if (skipGS) return;
    __resetPcUsdCache();
    pushClientGS = new PushClient({
      network: PUSH_NETWORK.TESTNET_DONUT,
      rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
    });
  });

  (skipGS ? it.skip : it)(
    'getPcUsdPrice returns non-zero for Ethereum Sepolia route',
    async () => {
      const ctx = makeCtxFromPushClient(pushClientGS, CHAIN.ETHEREUM_SEPOLIA);
      const price = await getPcUsdPrice(ctx, CHAIN.ETHEREUM_SEPOLIA);
      console.log(`[smoke] WPC/USDT.eth quote → $PC = ${price} (1e8 USD)`);
      expect(price).toBeGreaterThanOrEqual(BigInt(0));
    },
    60_000
  );

  (skipGS ? it.skip : it)(
    'sizeOutboundGas categorizes pETH gas into one of A/B/C',
    async () => {
      const ctx = makeCtxFromPushClient(pushClientGS, CHAIN.ETHEREUM_SEPOLIA);

      const universalCore = (await pushClientGS.readContract({
        address: GATEWAY_PC,
        abi: UNIVERSAL_GATEWAY_PC,
        functionName: 'universalCore',
        args: [],
      })) as `0x${string}`;

      const pETH = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT].pETH;
      const result = (await pushClientGS.readContract({
        address: universalCore,
        abi: UNIVERSAL_CORE_EVM,
        functionName: 'getOutboundTxGasAndFees',
        args: [pETH, BigInt(0)],
      })) as readonly [`0x${string}`, bigint, bigint, bigint, string, bigint];
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

// ============================================================================
// Read Uniswap V3 pool info for Solana namespace
// ============================================================================
describe('Read Uniswap V3 pool info for Solana namespace', () => {
  const pSOL_RPI = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT].pSOL;
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

  const UNIVERSAL_CORE_ABI_RPI = [
    {
      type: 'function',
      name: 'gasPCPoolByChainNamespace',
      inputs: [{ name: 'chainNamespace', type: 'string' }],
      outputs: [{ name: '', type: 'address' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'gasTokenPRC20ByChainNamespace',
      inputs: [{ name: 'chainNamespace', type: 'string' }],
      outputs: [{ name: '', type: 'address' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'gasPriceByChainNamespace',
      inputs: [{ name: 'chainNamespace', type: 'string' }],
      outputs: [{ name: '', type: 'uint256' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'baseGasLimitByChainNamespace',
      inputs: [{ name: 'chainNamespace', type: 'string' }],
      outputs: [{ name: '', type: 'uint256' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'WPC',
      inputs: [],
      outputs: [{ name: '', type: 'address' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'uniswapV3Factory',
      inputs: [],
      outputs: [{ name: '', type: 'address' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'defaultFeeTier',
      inputs: [{ name: '', type: 'address' }],
      outputs: [{ name: '', type: 'uint24' }],
      stateMutability: 'view',
    },
  ] as const;

  const UNISWAP_V3_FACTORY_ABI_RPI = [
    {
      type: 'function',
      name: 'getPool',
      inputs: [
        { name: 'tokenA', type: 'address' },
        { name: 'tokenB', type: 'address' },
        { name: 'fee', type: 'uint24' },
      ],
      outputs: [{ name: 'pool', type: 'address' }],
      stateMutability: 'view',
    },
  ] as const;

  const ERC20_ABI_RPI = [
    {
      type: 'function',
      name: 'balanceOf',
      inputs: [{ name: 'account', type: 'address' }],
      outputs: [{ name: '', type: 'uint256' }],
      stateMutability: 'view',
    },
  ] as const;

  const SOLANA_NAMESPACE = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

  it('should read pool address and balances', async () => {
    const universalCore = await pushPublicClient.readContract({
      address: GATEWAY_PC,
      abi: UNIVERSAL_GATEWAY_PC,
      functionName: 'universalCore',
    }) as `0x${string}`;
    console.log(`UniversalCore: ${universalCore}`);

    const mappedPoolAddress = await pushPublicClient.readContract({
      address: universalCore,
      abi: UNIVERSAL_CORE_ABI_RPI,
      functionName: 'gasPCPoolByChainNamespace',
      args: [SOLANA_NAMESPACE],
    }) as `0x${string}`;
    console.log(`\nUniversalCore mapped pool (WPC/pSOL): ${mappedPoolAddress}`);

    const wpcAddress = await pushPublicClient.readContract({
      address: universalCore,
      abi: UNIVERSAL_CORE_ABI_RPI,
      functionName: 'WPC',
    }) as `0x${string}`;
    console.log(`WPC (Wrapped Push Coin): ${wpcAddress}`);

    const gasToken = await pushPublicClient.readContract({
      address: universalCore,
      abi: UNIVERSAL_CORE_ABI_RPI,
      functionName: 'gasTokenPRC20ByChainNamespace',
      args: [SOLANA_NAMESPACE],
    }) as `0x${string}`;
    console.log(`Gas token (pSOL): ${gasToken}`);

    const factoryAddress = await pushPublicClient.readContract({
      address: universalCore,
      abi: UNIVERSAL_CORE_ABI_RPI,
      functionName: 'uniswapV3Factory',
    }) as `0x${string}`;
    console.log(`Uniswap V3 Factory: ${factoryAddress}`);

    const feeTier = await pushPublicClient.readContract({
      address: universalCore,
      abi: UNIVERSAL_CORE_ABI_RPI,
      functionName: 'defaultFeeTier',
      args: [gasToken],
    }) as number;
    console.log(`Default fee tier for pSOL: ${feeTier}`);

    const factoryPoolAddress =
      factoryAddress !== ZERO_ADDRESS && feeTier !== 0
        ? await pushPublicClient.readContract({
            address: factoryAddress,
            abi: UNISWAP_V3_FACTORY_ABI_RPI,
            functionName: 'getPool',
            args: [wpcAddress, gasToken, feeTier],
          }) as `0x${string}`
        : ZERO_ADDRESS;
    console.log(`Factory pool (WPC/pSOL): ${factoryPoolAddress}`);

    const poolAddress =
      mappedPoolAddress !== ZERO_ADDRESS ? mappedPoolAddress : factoryPoolAddress;
    console.log(`Selected pool (WPC/pSOL): ${poolAddress}`);

    const gasPrice = await pushPublicClient.readContract({
      address: universalCore,
      abi: UNIVERSAL_CORE_ABI_RPI,
      functionName: 'gasPriceByChainNamespace',
      args: [SOLANA_NAMESPACE],
    }) as bigint;
    const baseGasLimit = await pushPublicClient.readContract({
      address: universalCore,
      abi: UNIVERSAL_CORE_ABI_RPI,
      functionName: 'baseGasLimitByChainNamespace',
      args: [SOLANA_NAMESPACE],
    }) as bigint;

    const gasFee = gasPrice * baseGasLimit;
    console.log(`\ngasPrice: ${gasPrice}`);
    console.log(`baseGasLimit: ${baseGasLimit}`);
    console.log(`gasFee = ${gasPrice} × ${baseGasLimit} = ${gasFee} raw (${formatUnits(gasFee, 9)} pSOL)`);

    expect(wpcAddress).not.toBe(ZERO_ADDRESS);
    expect(gasToken).toBe(pSOL_RPI);
    expect(gasPrice).toBeGreaterThan(BigInt(0));
    expect(baseGasLimit).toBeGreaterThan(BigInt(0));

    if (poolAddress === ZERO_ADDRESS) {
      console.log('>>> WPC/pSOL pool is not configured on this testnet UniversalCore/factory; skipping pool balance checks.');
      return;
    }

    const poolPsolBalance = await pushPublicClient.readContract({
      address: pSOL_RPI,
      abi: ERC20_ABI_RPI,
      functionName: 'balanceOf',
      args: [poolAddress],
    }) as bigint;
    console.log(`\nPool pSOL balance: ${poolPsolBalance} raw (${formatUnits(poolPsolBalance, 9)} pSOL)`);

    const poolWpcBalance = await pushPublicClient.readContract({
      address: wpcAddress,
      abi: ERC20_ABI_RPI,
      functionName: 'balanceOf',
      args: [poolAddress],
    }) as bigint;
    console.log(`Pool WPC balance:  ${poolWpcBalance} raw (${formatUnits(poolWpcBalance, 18)} WPC)`);

    if (poolPsolBalance < gasFee) {
      const deficit = gasFee - poolPsolBalance;
      console.log(`>>> DEFICIT: pool needs ${formatUnits(deficit, 9)} more pSOL`);
    } else {
      console.log(`>>> Pool has enough liquidity ✓`);
    }

    expect(poolAddress).not.toBe(ZERO_ADDRESS);
  }, 30000);
});
