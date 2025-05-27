import { createPublicClient, http, PublicClient } from 'viem';
import { formatUnits } from 'viem';
import { CHAIN } from './constants/enums';
import { sepolia } from 'viem/chains';

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
const FEED_ADDRESSES: Record<
  CHAIN.ETHEREUM_SEPOLIA | CHAIN.SOLANA_DEVNET,
  {
    NATIVE_USD: string;
    USDC_USD: string;
  }
> = {
  [CHAIN.ETHEREUM_SEPOLIA]: {
    NATIVE_USD: '0x694AA1769357215DE4FAC081bf1f309aDC325306',
    USDC_USD: '0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E',
  },
  [CHAIN.SOLANA_DEVNET]: {
    NATIVE_USD: '99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR',
    USDC_USD: '2EmfL3MqL3YHABudGNmajjCpR13NNEn9Y4LWxbDm6SwR',
  },
};

export class PriceFeed {
  private evmClient: PublicClient | null = null;
  private chain: CHAIN;
  private addresses: {
    native: string;
    usdc: string;
  };

  constructor(chain: CHAIN, rpcUrl: string) {
    if (!rpcUrl) {
      throw new Error('RPC URL is required');
    }

    if (!(chain in FEED_ADDRESSES)) {
      throw new Error(`Price feed not available for the chain ${chain}`);
    }

    if (chain === CHAIN.ETHEREUM_SEPOLIA) {
      this.evmClient = createPublicClient({
        chain: sepolia,
        transport: http(rpcUrl),
      });
    } else if (chain === CHAIN.SOLANA_DEVNET) {
      // For now do nothing
    } else {
      throw new Error('Invalid chain');
    }
    this.chain = chain;
    this.addresses = {
      native: FEED_ADDRESSES[chain].NATIVE_USD,
      usdc: FEED_ADDRESSES[chain].USDC_USD,
    };
  }

  // Fetches latest value and decimals for a given feed
  private async fetchRaw(
    address: string
  ): Promise<{ value: bigint; decimals: number }> {
    if (!this.evmClient) {
      throw new Error('EVM client not initialized');
    }
    const [, raw] = await this.evmClient.readContract({
      address: address as `0x${string}`,
      abi: aggregatorV3InterfaceABI,
      functionName: 'latestRoundData',
      args: [],
    });
    const decimals = await this.evmClient.readContract({
      address: address as `0x${string}`,
      abi: aggregatorV3InterfaceABI,
      functionName: 'decimals',
    });
    return { value: raw as bigint, decimals: Number(decimals) };
  }

  async getPrice(): Promise<{
    price: number;
  }> {
    if (this.chain === CHAIN.ETHEREUM_SEPOLIA) {
      // For other chains (like Sepolia), calculate ETH/USDC from ETH/USD and USDC/USD
      // USDC/USD
      const { value: rawUSDC, decimals: decUSDC } = await this.fetchRaw(
        this.addresses.usdc
      );
      const priceUSDC_USD = formatUnits(rawUSDC, decUSDC);

      // ETH/USD
      const { value: rawETH, decimals: decETH } = await this.fetchRaw(
        this.addresses.native
      );
      const priceETH_USD = formatUnits(rawETH, decETH);

      const price = Number(priceETH_USD) / Number(priceUSDC_USD);

      return { price };
    } else if (this.chain === CHAIN.SOLANA_DEVNET) {
      const url =
        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd';
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `CoinGecko API error: ${response.status} ${response.statusText}`
        );
      }
      const data = (await response.json()) as { solana: { usd: number } };
      return { price: data.solana.usd };
    } else {
      throw new Error('Invalid chain');
    }
  }
}
