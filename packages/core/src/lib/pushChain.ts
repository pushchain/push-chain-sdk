import { Block } from './block/block';
import { ENV } from './constants';
import { UniversalSigner } from './signer/signer.types';
import { Tx } from './tx/tx';
import { Utils } from './utils';
import { WebSocketClient } from './websocket/websocket-client';

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

  /**
   * Provides access to WebSocket functionality.
   */
  public ws: WebSocketClient;

  private constructor(block: Block, tx: Tx, ws: WebSocketClient) {
    this.tx = tx;
    this.block = block;
    this.ws = ws;
  }

  /**
   * Initializes the PushChain class with the given UniversalSigner and network options.
   *
   * @param {UniversalSigner | null} [universalSigner=null] - The UniversalSigner instance.
   * This is only required for write operations. If you only need to perform read operations,
   * you can pass `null`.
   * @param {Object} [options] - The options for initializing the PushChain.
   * @param {boolean} [options.printTraces=false] - Console logs the requests to nodes
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
      printTraces?: boolean;
    } = {
      network: ENV.DEVNET,
      printTraces: false,
    }
  ): Promise<PushChain> => {
    const block = await Block.initialize(options.network);
    const tx = await Tx.initialize(
      options.network,
      universalSigner,
      options.printTraces
    );
    const ws = new WebSocketClient(block.getWebSocketUrl());
    return new PushChain(block, tx, ws);
  };
}
