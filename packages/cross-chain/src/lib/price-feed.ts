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
  CHAIN.ETHEREUM_SEPOLIA,
  {
    ETH_USD: `0x${string}`;
    USDC_USD: `0x${string}`;
  }
> = {
  [CHAIN.ETHEREUM_SEPOLIA]: {
    ETH_USD: '0x694AA1769357215DE4FAC081bf1f309aDC325306',
    USDC_USD: '0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E',
  },
};

export class PriceFeed {
  private client: PublicClient;
  private addrs: {
    ETH_USD: `0x${string}`;
    USDC_USD: `0x${string}`;
  };

  constructor(chain: CHAIN, rpcUrl: string) {
    if (chain === CHAIN.PUSH_TESTNET || chain === CHAIN.PUSH_MAINNET) {
      throw new Error('Price feed not available for Push Chain');
    } else if (chain === CHAIN.ETHEREUM_SEPOLIA) {
      this.client = createPublicClient({
        chain: sepolia,
        transport: http(rpcUrl),
      });
    } else if (chain === CHAIN.ETHEREUM_MAINNET) {
      throw new Error('Price feed not available for Ethereum Mainnet');
    } else if (
      chain === CHAIN.SOLANA_MAINNET ||
      chain === CHAIN.SOLANA_TESTNET ||
      chain === CHAIN.SOLANA_DEVNET
    ) {
      throw new Error('Price feed not available for Solana Chain');
    } else {
      throw new Error('Invalid chain');
    }

    const cfg = FEED_ADDRESSES[chain];
    if (!cfg) {
      throw new Error(
        `No price feed addresses configured for chain '${chain}'`
      );
    }

    this.addrs = {
      ETH_USD: cfg.ETH_USD,
      USDC_USD: cfg.USDC_USD,
    };
  }

  // Fetches latest value and decimals for a given feed
  private async fetchRaw(
    address: `0x${string}`
  ): Promise<{ value: bigint; decimals: number }> {
    const [, raw] = await this.client.readContract({
      address,
      abi: aggregatorV3InterfaceABI,
      functionName: 'latestRoundData',
      args: [],
    });
    const decimals = await this.client.readContract({
      address,
      abi: aggregatorV3InterfaceABI,
      functionName: 'decimals',
    });
    return { value: raw as bigint, decimals: Number(decimals) };
  }

  async getPrices(): Promise<{
    priceETH_USDC: string;
  }> {
    // For other chains (like Sepolia), calculate ETH/USDC from ETH/USD and USDC/USD
    // USDC/USD
    const { value: rawUSDC, decimals: decUSDC } = await this.fetchRaw(
      this.addrs.USDC_USD
    );
    const priceUSDC_USD = formatUnits(rawUSDC, decUSDC);

    // ETH/USD
    const { value: rawETH, decimals: decETH } = await this.fetchRaw(
      this.addrs.ETH_USD
    );
    const priceETH_USD = formatUnits(rawETH, decETH);

    const priceETH_USDC = (
      Number(priceETH_USD) / Number(priceUSDC_USD)
    ).toString();

    return { priceETH_USDC };
  }
}
