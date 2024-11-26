interface AlchemyAddress {
  network: string;
  address: string;
}
interface PriceResponse {
  data: {
    prices: { value: string }[];
    error: string | null;
  }[];
}

export default async function fetchTokenPrices(addresses: AlchemyAddress[]) {
  const options = {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ addresses }),
  };

  try {
    const response = await fetch(
      `https://api.g.alchemy.com/prices/v1/${import.meta.env.VITE_ALCHEMY_API_KEY}/tokens/by-address`,
      options
    );
    const priceJson: PriceResponse = await response.json();
    const value = priceJson.data[0]?.prices[0]?.value;
    return value ? Number(value) : null;
  } catch (error) {
    console.error('Error fetching token prices:', error);
    throw error;
  }
}
