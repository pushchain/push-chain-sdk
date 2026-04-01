import { CHAIN, VM } from '../constants/enums';
import { CHAIN_INFO } from '../constants/chain';
import { EvmClient } from '../vm-client/evm-client';
import { FEE_LOCKER_EVM } from '../constants/abi/feeLocker.evm';
import FEE_LOCKER_SVM from '../constants/abi/feeLocker.json';
import { Program } from '@coral-xyz/anchor';
import { Connection } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';

// Module-level price cache — survives across PriceFetch instances.
// Chainlink feeds update every 1-2h or on 0.5% price move; 30s TTL is safe.
const PRICE_CACHE_TTL_MS = 30_000;
const priceCache = new Map<CHAIN, { price: bigint; expiry: number }>();

export class PriceFetch {
  constructor(
    private readonly rpcUrls: Partial<Record<CHAIN, string[]>> = {}
  ) {}

  async getPrice(chain: CHAIN): Promise<bigint> {
    const cached = priceCache.get(chain);
    if (cached && Date.now() < cached.expiry) {
      return cached.price;
    }
    const rpcUrls: string[] =
      this.rpcUrls[chain] || CHAIN_INFO[chain].defaultRPC;

    const vm = CHAIN_INFO[chain].vm;
    const { lockerContract } = CHAIN_INFO[chain];
    if (!lockerContract) {
      throw new Error(`Locker contract not configured for chain: ${chain}`);
    }

    let price: bigint;

    switch (vm) {
      case VM.EVM: {
        const evmClient = new EvmClient({ rpcUrls });

        const result = await evmClient.readContract<[bigint, number]>({
          abi: FEE_LOCKER_EVM,
          address: lockerContract as `0x${string}`,
          functionName: 'getEthUsdPrice',
        });

        // getEthUsdPrice returns price scaled to 1e18 and the chainlink feed decimals.
        // Downstream lockFee math expects the price in 8 decimals, so scale down from 1e18 to 1e8.
        const [price1e18] = result;
        price = price1e18 / BigInt(10 ** 10); // 1e18 -> 1e8
        break;
      }
      case VM.SVM: {
        const PRICE_ACCOUNT = new PublicKey(
          '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'
        );

        const connection = new Connection(rpcUrls[0], 'confirmed');
        const provider = new AnchorProvider(
          connection,
          {
            publicKey: new PublicKey(
              'EfQYRThwBu4MsU7Lf3D2e68tCtdwfYj6f66ot1e2HNrq'
            ),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          { commitment: 'confirmed' }
        );

        const program = new Program(FEE_LOCKER_SVM, provider);

        const result = await program.methods['getSolPrice']()
          .accounts({
            priceUpdate: PRICE_ACCOUNT,
          })
          .view();

        if (!result || !result.price) {
          throw new Error('Invalid price data returned');
        }

        // Exponent on this function is always NEGATIVE
        price = BigInt((result.price as BN).toNumber());
        break;
      }
      default: {
        throw new Error(`Unsupported VM ${vm}`);
      }
    }

    priceCache.set(chain, { price, expiry: Date.now() + PRICE_CACHE_TTL_MS });
    return price;
  }
}
