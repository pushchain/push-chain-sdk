import { CHAIN, PUSH_NETWORK } from './constants/enums';
import { Orchestrator } from './orchestrator/orchestrator';
import { createUniversalSigner } from './universal/signer';
import { UniversalSigner } from './universal/universal.types';
import { Utils } from './utils';
import * as viem from 'viem';

/**
 * @class PushChain
 *
 * Entry point to interact with Push Chain in your application.
 * Provides access to cross-chain execution, utilities, and signer abstraction.
 */
export class PushChain {
  /**
   * @static
   * Utility functions for encoding, hashing, and data formatting.
   */
  public static utils = Utils;

  /**
   * @static
   * Exposes viem utilities to the SDK user for convenience.
   */
  static viem = viem;

  private orchestartor: Orchestrator;

  /**
   * Universal namespace containing core transaction and address computation methods
   */
  universal: {
    // pushChainClient.universal.origin. not a function, just a property. => Return UOA wallet address. If from Push chain, both returns above will match. Else, it will tell from which chian it comes from.
    get origin(): ReturnType<Orchestrator['getUOA']>;
    // pushChainClient.universal.account. not a function, just a property. => Return UEA (wallet from push chain). If on push, return Push Chain wallet itself.
    get account(): ReturnType<Orchestrator['getNMSCAddress']>;
    /**
     * Executes a transaction on Push Chain
     */
    sendTransaction: Orchestrator['execute'];
    // /**
    //  * Computes the NMSC address for the universal signer on Push
    //  */
    // getNMSCAddress: Orchestrator['getNMSCAddress'];
  };

  private constructor(orchestartor: Orchestrator) {
    this.orchestartor = orchestartor;

    // Initialize Universal namespace with bound methods
    this.universal = {
      get origin() {
        return orchestartor.getUOA();
      },
      get account() {
        return orchestartor.getNMSCAddress();
      },
      sendTransaction: this.orchestartor.execute.bind(this.orchestartor),
      // getNMSCAddress: this.orchestartor.getNMSCAddress.bind(this.orchestartor),
    };
  }

  /**
   * @method initialize
   * Initializes the PushChain SDK with a universal signer and optional config.
   *
   * @param universalSigner
   * @param options - Optional settings to configure the SDK instance.
   *   - network: PushChain network to target (e.g., TESTNET_DONUT, MAINNET).
   *   - rpcUrls: Custom RPC URLs mapped by chain IDs.
   *   - printTraces: Whether to print internal trace logs for debugging.
   *
   * @returns An initialized instance of PushChain.
   */
  static initialize = async (
    universalSigner: UniversalSigner,
    options?: {
      network?: PUSH_NETWORK;
      rpcUrls?: Partial<Record<CHAIN, string>>;
      printTraces?: boolean;
    }
  ) => {
    const orchestartor = new Orchestrator(
      /**
       * Ensures the signer conforms to the UniversalSigner interface.
       */
      createUniversalSigner(universalSigner),
      options?.network || PUSH_NETWORK.TESTNET_DONUT,
      options?.rpcUrls || {},
      options?.printTraces || false
    );
    return new PushChain(orchestartor);
  };
}
