import { CHAIN, VM } from '../constants/enums';
import { CHAIN_INFO } from '../constants/chain';
import { EvmClient } from '../vm-client/evm-client';

// Minimal ABI for Chainlink AggregatorV3Interface
const aggregatorV3InterfaceABI = [
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'latestRoundData',
    outputs: [
      { internalType: 'uint80', name: 'roundId', type: 'uint80' },
      { internalType: 'int256', name: 'answer', type: 'int256' },
      { internalType: 'uint256', name: 'startedAt', type: 'uint256' },
      { internalType: 'uint256', name: 'updatedAt', type: 'uint256' },
      { internalType: 'uint80', name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Configure feed addresses per chain
const FEED_ADDRESS: Partial<
  Record<
    CHAIN,
    {
      NATIVE_USD: string;
      USDC_USD: string;
    }
  >
> = {
  [CHAIN.ETHEREUM_SEPOLIA]: {
    NATIVE_USD: '0x694AA1769357215DE4FAC081bf1f309aDC325306',
    USDC_USD: '0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E',
  },
};

export class PriceFetch {
  constructor(
    private readonly rpcUrls: Partial<Record<CHAIN, string[]>> = {}
  ) {}

  async getPrice(chain: CHAIN): Promise<bigint> {
    const rpcUrls: string[] =
      this.rpcUrls[chain] || CHAIN_INFO[chain].defaultRPC;

    const vm = CHAIN_INFO[chain].vm;

    switch (vm) {
      case VM.EVM: {
        const priceFeedAddress = FEED_ADDRESS[chain];
        if (!priceFeedAddress) {
          throw new Error(
            `Price Conversion functionality not available for ${chain}`
          );
        }

        const evmClient = new EvmClient({ rpcUrls });

        const ethUsdPrice = await this.fetchPrice(
          priceFeedAddress.NATIVE_USD,
          evmClient
        );

        const usdcUsdPrice = await this.fetchPrice(
          priceFeedAddress.USDC_USD,
          evmClient
        );
        return (ethUsdPrice / usdcUsdPrice) * BigInt(1e8);
      }
      case VM.SVM: {
        if (chain === CHAIN.SOLANA_DEVNET) {
          const url =
            'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd';
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(
              `CoinGecko API error: ${response.status} ${response.statusText}`
            );
          }
          const data = (await response.json()) as { solana: { usd: number } };
          return BigInt(data.solana.usd * 1e8);
        } else {
          throw new Error('Cannot fetch price in USD');
        }
      }
      default: {
        throw new Error(`Unsupported VM ${vm}`);
      }
    }
  }

  /**
   *
   * @param address Chainlink oracle feed address
   * @param vmClient EVM client instance
   * @returns price scaled to 8 decimals (10^8)
   */
  private async fetchPrice(address: string, vmClient: EvmClient) {
    const [, raw] = (await vmClient.readContract({
      address: address as `0x${string}`,
      abi: aggregatorV3InterfaceABI,
      functionName: 'latestRoundData',
      args: [],
    })) as any;

    const decimals = await vmClient.readContract({
      address: address as `0x${string}`,
      abi: aggregatorV3InterfaceABI,
      functionName: 'decimals',
    });

    const rawBigInt = BigInt(raw);
    const actualDecimals = Number(decimals);

    // Normalize to 8 decimals (10^8)
    let normalizedPrice: bigint;
    if (actualDecimals === 8) {
      normalizedPrice = rawBigInt;
    } else if (actualDecimals > 8) {
      normalizedPrice = rawBigInt / BigInt(10 ** (actualDecimals - 8));
    } else {
      normalizedPrice = rawBigInt * BigInt(10 ** (8 - actualDecimals));
    }

    return normalizedPrice;
  }
}
