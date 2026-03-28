/**
 * Read the Uniswap V3 pool address and pSOL balance for the Solana namespace.
 */
import '@e2e/shared/setup';
import { createPublicClient, http, formatUnits } from 'viem';
import { UNIVERSAL_GATEWAY_PC } from '../../src/lib/constants/abi/universalGatewayPC.evm';
import { SYNTHETIC_PUSH_ERC20 } from '../../src/lib/constants/chain';
import { PUSH_NETWORK } from '../../src/lib/constants/enums';

const PUSH_RPC = 'https://evm.donut.rpc.push.org/';
const pSOL = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT].pSOL;
const GATEWAY_PC = '0x00000000000000000000000000000000000000C1' as const;

const UNIVERSAL_CORE_ABI = [
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
] as const;

const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

const client = createPublicClient({ transport: http(PUSH_RPC) });

// Solana devnet chain namespace (from PRC20's SOURCE_CHAIN_NAMESPACE)
const SOLANA_NAMESPACE = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

describe('Read Uniswap V3 pool info for Solana namespace', () => {
  it('should read pool address and balances', async () => {
    // 1. Get UniversalCore address
    const universalCore = await client.readContract({
      address: GATEWAY_PC,
      abi: UNIVERSAL_GATEWAY_PC,
      functionName: 'UNIVERSAL_CORE',
    }) as `0x${string}`;
    console.log(`UniversalCore: ${universalCore}`);

    // 2. Get pool address for Solana namespace
    const poolAddress = await client.readContract({
      address: universalCore,
      abi: UNIVERSAL_CORE_ABI,
      functionName: 'gasPCPoolByChainNamespace',
      args: [SOLANA_NAMESPACE],
    }) as `0x${string}`;
    console.log(`\nUniswap V3 Pool (WPC/pSOL): ${poolAddress}`);

    // 3. Get WPC address
    const wpcAddress = await client.readContract({
      address: universalCore,
      abi: UNIVERSAL_CORE_ABI,
      functionName: 'WPC',
    }) as `0x${string}`;
    console.log(`WPC (Wrapped Push Coin): ${wpcAddress}`);

    // 4. Get gas token for Solana
    const gasToken = await client.readContract({
      address: universalCore,
      abi: UNIVERSAL_CORE_ABI,
      functionName: 'gasTokenPRC20ByChainNamespace',
      args: [SOLANA_NAMESPACE],
    }) as `0x${string}`;
    console.log(`Gas token (pSOL): ${gasToken}`);

    // 5. Read pSOL balance of the pool
    const poolPsolBalance = await client.readContract({
      address: pSOL,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [poolAddress],
    }) as bigint;
    console.log(`\nPool pSOL balance: ${poolPsolBalance} raw (${formatUnits(poolPsolBalance, 9)} pSOL)`);

    // 6. Read WPC balance of the pool
    const poolWpcBalance = await client.readContract({
      address: wpcAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [poolAddress],
    }) as bigint;
    console.log(`Pool WPC balance:  ${poolWpcBalance} raw (${formatUnits(poolWpcBalance, 18)} WPC)`);

    // 7. Read gas config
    const gasPrice = await client.readContract({
      address: universalCore,
      abi: UNIVERSAL_CORE_ABI,
      functionName: 'gasPriceByChainNamespace',
      args: [SOLANA_NAMESPACE],
    }) as bigint;
    const baseGasLimit = await client.readContract({
      address: universalCore,
      abi: UNIVERSAL_CORE_ABI,
      functionName: 'baseGasLimitByChainNamespace',
      args: [SOLANA_NAMESPACE],
    }) as bigint;

    const gasFee = gasPrice * baseGasLimit;
    console.log(`\ngasPrice: ${gasPrice}`);
    console.log(`baseGasLimit: ${baseGasLimit}`);
    console.log(`gasFee = ${gasPrice} × ${baseGasLimit} = ${gasFee} raw (${formatUnits(gasFee, 9)} pSOL)`);
    console.log(`\n>>> Pool has ${formatUnits(poolPsolBalance, 9)} pSOL, needs ${formatUnits(gasFee, 9)} pSOL per outbound tx`);

    if (poolPsolBalance < gasFee) {
      const deficit = gasFee - poolPsolBalance;
      console.log(`>>> DEFICIT: pool needs ${formatUnits(deficit, 9)} more pSOL`);
      console.log(`\n>>> To fund: transfer pSOL to the pool address: ${poolAddress}`);
    } else {
      console.log(`>>> Pool has enough liquidity ✓`);
    }

    expect(poolAddress).not.toBe('0x0000000000000000000000000000000000000000');
  }, 30000);
});
