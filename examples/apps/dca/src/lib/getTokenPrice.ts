import { Chain } from '@covalenthq/client-sdk';
import { goldrushClient } from './utils';

export default async function fetchTokenPrice(
  chainName: Chain,
  tokenContractAddress: string,
  date: string
) {
  try {
    const price = await goldrushClient.PricingService.getTokenPrices(
      chainName,
      'USD',
      tokenContractAddress,
      {
        from: date,
        to: date,
      }
    );

    return price.data?.[0]?.items?.[0]?.price;
  } catch (error) {
    console.error('Error fetching token prices:', error);
    throw error;
  }
}
