import { CHAIN, VM } from '../constants/enums';
import { CHAIN_INFO } from '../constants/chain';
import { EvmClient } from '../vm-client/evm-client';
import { SvmClient } from '../vm-client/svm-client';
import { FEE_LOCKER_EVM } from '../constants/abi/feeLocker.evm';
import FEE_LOCKER_SVM from '../constants/abi/feeLocker.json';
import { PublicKey } from '@solana/web3.js';



export class PriceFetch {
  // Pyth SOL/USD price feed ID (same across all networks)
  private static readonly PYTH_SOL_USD_FEED_ID = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';
  
  constructor(
    private readonly rpcUrls: Partial<Record<CHAIN, string[]>> = {}
  ) {}

  /**
   * Derives the Pyth price update account address for a given feed ID
   * This follows Pyth's standard derivation pattern
   */
  private derivePythPriceUpdateAccount(feedId: string): string {
    // Convert hex feed ID to bytes
    const feedIdBytes = Buffer.from(feedId, 'hex');
    
    // Pyth price update accounts are typically derived from the feed ID
    // This is a simplified derivation - in production you might want to use
    // the actual Pyth SDK or check with their documentation for the exact derivation
    const derived = PublicKey.findProgramAddressSync(
      [Buffer.from('price_update'), feedIdBytes],
      new PublicKey('rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ') // Pyth Receiver Program ID
    )[0];
    
    return derived.toString();
  }





  async getPrice(chain: CHAIN): Promise<bigint> {
    const rpcUrls: string[] =
      ['https://weathered-empty-rain.solana-devnet.quiknode.pro/278a5c4fa65bc6656ff0ff65ab2c3d1004fd00f9/']

    const vm = CHAIN_INFO[chain].vm;

    switch (vm) {
      case VM.EVM: {
        // Call locker contract's getEthUsdPrice function
        console.log('chain', chain);
        const lockerContract = CHAIN_INFO[chain].lockerContract;
        if (!lockerContract || lockerContract === 'TBD') {
          throw new Error(
            `Price fetching not available for ${chain} - no locker contract address`
          );
        }

        const evmClient = new EvmClient({ rpcUrls });

        // Call getEthUsdPrice() function from locker contract
        const result = await evmClient.readContract<[bigint, number]>({
          abi: FEE_LOCKER_EVM,
          address: lockerContract as `0x${string}`,
          functionName: 'getEthUsdPrice',
        });

        const [price, decimals] = result;
        
        // Normalize to 8 decimals (10^8) as expected by the system
        let normalizedPrice: bigint;
        if (decimals === 8) {
          normalizedPrice = price;
        } else if (decimals > 8) {
          normalizedPrice = price / BigInt(10 ** (decimals - 8));
        } else {
          normalizedPrice = price * BigInt(10 ** (8 - decimals));
        }

        return normalizedPrice;
      }
      case VM.SVM: {
        // Call locker contract's get_sol_price function
        console.log('chain', chain);
        const lockerContract = CHAIN_INFO[chain].lockerContract;
        if (!lockerContract || lockerContract === 'TBD') {
          throw new Error(
            `Price fetching not available for ${chain} - no locker contract address`
          );
        }

        const svmClient = new SvmClient({ rpcUrls,  });

        // For now, let's read the Locker account using readContract to demonstrate the approach
        // The Locker account is derived from the "locker" seed
        const lockerAccountPubkey = PublicKey.findProgramAddressSync(
          [Buffer.from('locker')],
          new PublicKey(lockerContract)
        )[0];

        // Read the Locker account data using SvmClient.readContract
        const lockerData = await svmClient.readContract<{
          admin: string;
          bump: number;
          vaultBump: number;
        }>({
          abi: FEE_LOCKER_SVM,
          address: lockerContract,
          functionName: 'Locker', // Account type name from IDL
          args: [lockerAccountPubkey.toString()],
        });

        console.log('Locker data:', lockerData);

        // For demonstration, return a hardcoded SOL price (around $240 with 8 decimals)
        // In a real implementation, this would come from the actual price oracle
        const price = BigInt(240);
        const exponent = 0;
        
        // Convert price with exponent to normalized format (8 decimals)
        const normalizedPrice = price * BigInt(10 ** (8 + exponent));
        return normalizedPrice;
      }
      default: {
        throw new Error(`Unsupported VM ${vm}`);
      }
    }
  }


}
