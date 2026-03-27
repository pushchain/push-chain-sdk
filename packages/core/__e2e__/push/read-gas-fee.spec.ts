/**
 * Read gasFee, gasPrice, BASE_GAS_LIMIT from UniversalCore on Push Chain.
 *
 * Calls the contract directly via viem — no private SDK access needed.
 * Reads getOutboundTxGasAndFees for pSOL and pETH to show the raw values.
 */
import '@e2e/shared/setup';
import { createPublicClient, http, formatUnits } from 'viem';
import { UNIVERSAL_CORE_EVM } from '../../src/lib/constants/abi/prc20.evm';
import { UNIVERSAL_GATEWAY_PC } from '../../src/lib/constants/abi/universalGatewayPC.evm';
import { SYNTHETIC_PUSH_ERC20 } from '../../src/lib/constants/chain';
import { PUSH_NETWORK } from '../../src/lib/constants/enums';

const PUSH_RPC = 'https://evm.donut.rpc.push.org/';
const GATEWAY_PC = '0x00000000000000000000000000000000000000C1' as const;

const pushPublicClient = createPublicClient({
  transport: http(PUSH_RPC),
});

async function getUniversalCoreAddress(): Promise<`0x${string}`> {
  return pushPublicClient.readContract({
    address: GATEWAY_PC,
    abi: UNIVERSAL_GATEWAY_PC,
    functionName: 'UNIVERSAL_CORE',
  }) as Promise<`0x${string}`>;
}

describe('Read gasFee from UniversalCore', () => {
  let universalCore: `0x${string}`;

  beforeAll(async () => {
    universalCore = await getUniversalCoreAddress();
    console.log(`UniversalCore address: ${universalCore}`);
  }, 30000);

  it('should read gasFee for pSOL (Solana namespace)', async () => {
    const synthetics = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT];
    const pSOL = synthetics.pSOL;
    const gasLimit = BigInt(0); // 0 = contract uses BASE_GAS_LIMIT

    const [gasToken, gasFee, protocolFee, gasPrice, chainNamespace] =
      (await pushPublicClient.readContract({
        address: universalCore,
        abi: UNIVERSAL_CORE_EVM,
        functionName: 'getOutboundTxGasAndFees',
        args: [pSOL, gasLimit],
      })) as [string, bigint, bigint, bigint, string];

    console.log('\n=== pSOL (Solana) ===');
    console.log(`chainNamespace:   ${chainNamespace}`);
    console.log(`gasToken:         ${gasToken}`);
    console.log(`gasPrice:         ${gasPrice}`);
    console.log(`gasFee (raw):     ${gasFee}`);
    console.log(`gasFee (pSOL):    ${formatUnits(gasFee, 9)}`);
    console.log(`protocolFee:      ${protocolFee}`);

    // Also read baseGasLimit for this namespace
    const baseGasLimit = (await pushPublicClient.readContract({
      address: universalCore,
      abi: UNIVERSAL_CORE_EVM,
      functionName: 'baseGasLimitByChainNamespace',
      args: [chainNamespace],
    })) as bigint;

    console.log(`baseGasLimit:     ${baseGasLimit}`);
    console.log(`gasPrice × baseGasLimit = ${gasPrice} × ${baseGasLimit} = ${gasPrice * baseGasLimit}`);

    expect(gasFee).toBeGreaterThan(BigInt(0));
  }, 30000);

  it('should read gasFee for pETH (EVM namespace)', async () => {
    const synthetics = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT];
    const pETH = synthetics.pETH;
    const gasLimit = BigInt(0);

    const [gasToken, gasFee, protocolFee, gasPrice, chainNamespace] =
      (await pushPublicClient.readContract({
        address: universalCore,
        abi: UNIVERSAL_CORE_EVM,
        functionName: 'getOutboundTxGasAndFees',
        args: [pETH, gasLimit],
      })) as [string, bigint, bigint, bigint, string];

    console.log('\n=== pETH (Ethereum) ===');
    console.log(`chainNamespace:   ${chainNamespace}`);
    console.log(`gasToken:         ${gasToken}`);
    console.log(`gasPrice:         ${gasPrice}`);
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
    console.log(`gasPrice × baseGasLimit = ${gasPrice} × ${baseGasLimit} = ${gasPrice * baseGasLimit}`);

    expect(gasFee).toBeGreaterThan(BigInt(0));
  }, 30000);
});
