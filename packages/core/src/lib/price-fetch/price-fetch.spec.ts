import { PriceFetch } from './price-fetch';
import { CHAIN } from '../constants/enums';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

describe('PriceFetch', () => {
  let priceFetcher: PriceFetch;

  beforeAll(() => {
    priceFetcher = new PriceFetch();
  });

  describe('getPrice', () => {
    it('fetches ETH price from Sepolia contract', async () => {
      const price = await priceFetcher.getPrice(CHAIN.ETHEREUM_SEPOLIA);
      
      expect(typeof price).toBe('bigint');
      expect(price).toBeGreaterThan(BigInt(0));
      console.log(`ETH Price (normalized to 8 decimals): ${price}`);
    });

    it('fetches SOL price from Solana contract', async () => {
      const price = await priceFetcher.getPrice(CHAIN.SOLANA_DEVNET);
      
      expect(typeof price).toBe('bigint');
      expect(price).toBeGreaterThan(BigInt(0));
      console.log(`SOL Price (normalized to 8 decimals): ${price}`);
    });

    it('throws error for chain without locker contract', async () => {
      await expect(
        priceFetcher.getPrice(CHAIN.ETHEREUM_MAINNET)
      ).rejects.toThrow('Price fetching not available');
    });

    it('throws error for unsupported chains', async () => {
      await expect(
        priceFetcher.getPrice(CHAIN.SOLANA_TESTNET)
      ).rejects.toThrow();
    });
  });
});
