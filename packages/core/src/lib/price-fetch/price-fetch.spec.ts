import { PriceFetch } from './price-fetch';
import { CHAIN } from '../constants/enums';

describe('PriceFetch', () => {
  const priceFetcher = new PriceFetch();

  it('fetches ETH/USDC price on Ethereum Sepolia', async () => {
    const price = await priceFetcher.getPrice(CHAIN.ETHEREUM_SEPOLIA);
    expect(typeof price).toBe('bigint');
    console.log(price);
    expect(price > BigInt(0)).toBe(true);
  });

  it('fetches SOL/USD price on Solana Devnet', async () => {
    const price = await priceFetcher.getPrice(CHAIN.SOLANA_DEVNET);
    expect(typeof price).toBe('bigint');
    console.log(price);
    expect(price > BigInt(0)).toBe(true);
  });

  it('throws for unsupported chains', async () => {
    await expect(priceFetcher.getPrice(CHAIN.SOLANA_TESTNET)).rejects.toThrow(
      `Locker contract not configured for chain: ${CHAIN.SOLANA_TESTNET}`
    );
  });
});
