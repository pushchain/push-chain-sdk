import { CHAIN, VM } from '../constants/enums';
import { CHAIN_INFO } from '../constants/chain';
import { EvmClient } from '../vm-client/evm-client';
import { FEE_LOCKER_EVM } from '../constants/abi';

export class PriceFetch {
  constructor(
    private readonly rpcUrls: Partial<Record<CHAIN, string[]>> = {}
  ) {}

  async getPrice(chain: CHAIN): Promise<bigint> {
    const rpcUrls: string[] =
      this.rpcUrls[chain] || CHAIN_INFO[chain].defaultRPC;

    const vm = CHAIN_INFO[chain].vm;
    const { lockerContract } = CHAIN_INFO[chain];
    if (!lockerContract) {
      throw new Error(`Locker contract not configured for chain: ${chain}`);
    }

    switch (vm) {
      case VM.EVM: {
        const evmClient = new EvmClient({ rpcUrls });

        const result = await evmClient.readContract<[bigint, number]>({
          abi: FEE_LOCKER_EVM,
          address: lockerContract as `0x${string}`,
          functionName: 'getEthUsdPrice',
        });

        const [price, decimals] = result;
        return price / BigInt(10 ** decimals);
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
          return BigInt(Math.round(data.solana.usd * 1e8));
        } else {
          throw new Error('Cannot fetch price in USD');
        }
      }
      default: {
        throw new Error(`Unsupported VM ${vm}`);
      }
    }
  }
}
