import { CONSTANTS } from '../constants';
import { CHAIN, PUSH_NETWORK, VM } from '../constants/enums';
import { CHAIN_INFO } from '../constants/chain';
import { Orchestrator } from '../orchestrator/orchestrator';
import { createUniversalSigner } from '../universal/signer';
import { UniversalSigner } from '../universal/universal.types';
import { Utils } from '../utils';
import { utils } from '@coral-xyz/anchor';
import { bytesToHex, TypedData, TypedDataDomain } from 'viem';

/**
 * @class PushChain
 *
 * Entry point to interact with Push Chain in your application.
 * Provides access to cross-chain execution, utilities, and signer abstraction.
 */
export class PushChain {
  /**
   * @static
   * Constants for the PushChain SDK.
   */
  public static CONSTANTS = CONSTANTS;

  /**
   * @static
   * Utility functions for encoding, hashing, and data formatting.
   */
  public static utils = Utils;

  /**
   * Universal namespace containing core transaction and address computation methods
   */
  universal: {
    // pushChainClient.universal.origin. not a function, just a property. => Return UOA wallet address. If from Push chain, both returns above will match. Else, it will tell from which chian it comes from.
    get origin(): ReturnType<Orchestrator['getUOA']>;
    // pushChainClient.universal.account. not a function, just a property. => Return UEA (wallet from push chain). If on push, return Push Chain wallet itself.
    get account(): ReturnType<Orchestrator['computeUEAOffchain']>;
    /**
     * Executes a transaction on Push Chain
     */
    sendTransaction: Orchestrator['execute'];
    /**
     * Signs an arbitrary message
     */
    signMessage: (data: Uint8Array) => Promise<string>;
    /**
     * Signs EIP-712 typed data
     */
    signTypedData: ({
      domain,
      types,
      primaryType,
      message,
    }: {
      domain: TypedDataDomain;
      types: TypedData;
      primaryType: string;
      message: Record<string, any>;
    }) => Promise<string>;
  };

  explorer: {
    getTransactionUrl: (txHash: string) => string;
    listUrls: () => string[];
  };

  private constructor(
    private orchestrator: Orchestrator,
    private universalSigner: UniversalSigner,
    private blockExplorers: Partial<Record<CHAIN, string[]>>
  ) {
    this.orchestrator = orchestrator;

    this.universal = {
      get origin() {
        return orchestrator.getUOA();
      },
      get account() {
        return orchestrator.computeUEAOffchain();
      },
      sendTransaction: orchestrator.execute.bind(orchestrator),
      signMessage: async (data: Uint8Array) => {
        const sigBytes = await universalSigner.signMessage(data);
        const chain = universalSigner.account.chain;
        if (CHAIN_INFO[chain].vm === VM.EVM) {
          return bytesToHex(sigBytes);
        } else if (CHAIN_INFO[chain].vm === VM.SVM) {
          return utils.bytes.bs58.encode(sigBytes);
        }
        return bytesToHex(sigBytes);
      },
      signTypedData: async (...args) => {
        if (typeof universalSigner.signTypedData !== 'function') {
          throw new Error('Typed data signing not supported');
        }
        const signBytes = await universalSigner.signTypedData(...args);
        return bytesToHex(signBytes);
      },
    };

    this.explorer = {
      getTransactionUrl: (txHash: string) => {
        return `https://donut.push.network/tx/${txHash}`;
      },
      listUrls: () => {
        return blockExplorers[CHAIN.PUSH_TESTNET_DONUT] ?? [];
      },
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
      network: PUSH_NETWORK;
      rpcUrls?: Partial<Record<CHAIN, string[]>>;
      blockExplorers?: Partial<Record<CHAIN, string[]>>;
      printTraces?: boolean;
    }
  ): Promise<PushChain> => {
    const validatedUniversalSigner = createUniversalSigner(universalSigner);
    const blockExplorers = options?.blockExplorers ?? {
      [CHAIN.PUSH_TESTNET_DONUT]: ['https://donut.push.network'],
    };
    const orchestrator = new Orchestrator(
      /**
       * Ensures the signer conforms to the UniversalSigner interface.
       */
      validatedUniversalSigner,
      options?.network ?? PUSH_NETWORK.TESTNET_DONUT,
      options?.rpcUrls ?? {},
      options?.printTraces ?? false
    );
    return new PushChain(
      orchestrator,
      validatedUniversalSigner,
      blockExplorers
    );
  };
}
