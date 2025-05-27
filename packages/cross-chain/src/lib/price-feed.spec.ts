import { PriceFeed } from './price-feed';
import { CHAIN } from './constants/enums';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env['EVM_RPC'] || '';

describe('PriceFeed', () => {
  describe('constructor', () => {
    it('should create PriceFeed instance with valid chain', () => {
      const priceFeed = new PriceFeed(CHAIN.ETHEREUM_SEPOLIA, RPC_URL);
      expect(priceFeed).toBeInstanceOf(PriceFeed);
    });

    it('should throw error for unsupported chains', () => {
      expect(() => new PriceFeed(CHAIN.PUSH_TESTNET, RPC_URL)).toThrow(
        `Price feed not available for the chain ${CHAIN.PUSH_TESTNET}`
      );
      expect(() => new PriceFeed(CHAIN.PUSH_MAINNET, RPC_URL)).toThrow(
        `Price feed not available for the chain ${CHAIN.PUSH_MAINNET}`
      );
      expect(() => new PriceFeed(CHAIN.SOLANA_MAINNET, RPC_URL)).toThrow(
        `Price feed not available for the chain ${CHAIN.SOLANA_MAINNET}`
      );
      expect(() => new PriceFeed(CHAIN.SOLANA_TESTNET, RPC_URL)).toThrow(
        `Price feed not available for the chain ${CHAIN.SOLANA_TESTNET}`
      );
      expect(() => new PriceFeed(CHAIN.ETHEREUM_MAINNET, RPC_URL)).toThrow(
        `Price feed not available for the chain ${CHAIN.ETHEREUM_MAINNET}`
      );
    });
  });

  describe('getPrices', () => {
    let priceFeed: PriceFeed;

    beforeEach(() => {
      priceFeed = new PriceFeed(CHAIN.ETHEREUM_SEPOLIA, RPC_URL);
    });

    it('should fetch and return real price data from Chainlink feeds', async () => {
      const result = await priceFeed.getPrice();

      // Verify the structure of the response
      expect(result).toHaveProperty('price');
      expect(typeof result.price).toBe('number');

      // Verify that we got a reasonable price (ETH should be worth more than $100 and less than $10000 in USDC terms)
      const ethUsdcPrice = result.price;
      expect(ethUsdcPrice).toBeGreaterThan(100);
      expect(ethUsdcPrice).toBeLessThan(10000);

      // Verify the price is a valid number
      expect(isNaN(ethUsdcPrice)).toBe(false);
      expect(isFinite(ethUsdcPrice)).toBe(true);
    }, 30000); // 30 second timeout for network calls

    it('should handle network errors gracefully', async () => {
      // Create a PriceFeed with an invalid RPC URL to test error handling
      const invalidPriceFeed = new PriceFeed(
        CHAIN.ETHEREUM_SEPOLIA,
        'https://invalid-rpc-url.com'
      );

      await expect(invalidPriceFeed.getPrice()).rejects.toThrow();
    }, 10000);
  });

  it('should return consistent data structure across multiple calls', async () => {
    const priceFeed = new PriceFeed(CHAIN.ETHEREUM_SEPOLIA, RPC_URL);

    const result1 = await priceFeed.getPrice();
    const result2 = await priceFeed.getPrice();

    // Both results should have the same structure
    expect(Object.keys(result1)).toEqual(Object.keys(result2));
    expect(result1).toHaveProperty('price');
    expect(result2).toHaveProperty('price');

    // Prices should be reasonable (they might differ slightly due to real-time updates)
    const price1 = result1.price;
    const price2 = result2.price;

    expect(price1).toBeGreaterThan(0);
    expect(price2).toBeGreaterThan(0);

    // Prices shouldn't differ by more than 50% (unless there's extreme volatility)
    const priceDifference =
      Math.abs(price1 - price2) / Math.max(price1, price2);
    expect(priceDifference).toBeLessThan(0.5);
  }, 45000);

  it('should handle real Chainlink price feed data correctly', async () => {
    const priceFeed = new PriceFeed(CHAIN.ETHEREUM_SEPOLIA, RPC_URL);
    const result = await priceFeed.getPrice();

    // Verify that the price is formatted correctly (should be a number)
    expect(typeof result.price).toBe('number');

    // Verify that the calculation makes sense (ETH/USDC should be positive)
    const ethUsdcPrice = result.price;
    expect(ethUsdcPrice).toBeGreaterThan(0);

    // Log the actual price for debugging (can be removed in production)
    console.log(`Current ETH/USDC price: ${result.price}`);
  }, 30000);

  it('should fetch Solana price', async () => {
    const priceFeed = new PriceFeed(CHAIN.SOLANA_DEVNET, 'dummy-rpc-url');
    const result = await priceFeed.getPrice();

    // Verify the structure of the response
    expect(result).toHaveProperty('price');
    expect(typeof result.price).toBe('number');

    // Verify that we got a reasonable price (SOL should be worth more than $1 and less than $1000)
    const solPrice = result.price;
    expect(solPrice).toBeGreaterThan(1);
    expect(solPrice).toBeLessThan(1000);

    // Verify the price is a valid number
    expect(isNaN(solPrice)).toBe(false);
    expect(isFinite(solPrice)).toBe(true);

    // Log the actual price for debugging
    console.log(`Current SOL/USDC price: ${result.price}`);
  }, 30000);
});
