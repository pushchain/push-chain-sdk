import { Block } from './block/block';
import { ENV } from './constants';
import { UniversalSigner } from './signer/signer.types';
import { Tx } from './tx/tx';
import { Utils } from './utils';

/**
 * The PushChain class provides access to the Push Chain's functionality.
 * It includes methods for interacting with blocks and transactions.
 *
 * @example
 * const pushChain = await PushChain.initialize();
 * const blocks = await pushChain.block.get('*', { limit: 30 }); // Fetch the latest 30 blocks
 * const transactions = await pushChain.tx.get(universalAccount, { limit: 30 }); // Fetch the latest 30 transactions for a specific account
 */
export class PushChain {
  /**
   * Provides access to utility methods in PushChain.
   */
  public static utils = Utils;

  /**
   * Provides access to transaction-related methods in PushChain.
   */
  public tx: Tx;

  /**
   * Provides access to block-related methods in PushChain.
   */
  public block: Block;

  private constructor(block: Block, tx: Tx) {
    this.tx = tx;
    this.block = block;
  }

  /**
   * Initializes the PushChain class with the given UniversalSigner and network options.
   *
   * @param {UniversalSigner | null} [universalSigner=null] - The UniversalSigner instance.
   * This is only required for write operations. If you only need to perform read operations,
   * you can pass `null`.
   * @param {Object} [options] - The options for initializing the PushChain.
   * @param {ENV} [options.network=ENV.DEVNET] - The network environment.
   * @returns {Promise<PushChain>} A promise that resolves to the initialized PushChain instance.
   *
   * @example
   * // Initialize for read-only operations
   * const pushChain = await PushChain.initialize(env);
   *
   * // Initialize for write operations with a signer
   * const pushChainWithSigner = await PushChain.initialize(env, signer);
   */
  static initialize = async (
    universalSigner: UniversalSigner | null = null,
    options: {
      network: ENV;
    } = {
      network: ENV.DEVNET,
    }
  ): Promise<PushChain> => {
    const block = await Block.initialize(options.network);
    const tx = await Tx.initialize(options.network, universalSigner);
    return new PushChain(block, tx);
  };
}
