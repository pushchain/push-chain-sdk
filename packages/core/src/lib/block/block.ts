import { Order, ENV } from '../constants';
import { toSDKResponse, toSimplifiedBlockResponse } from '../utils';
import { Validator } from '../validator/validator';
import { BlockResponse, CompleteBlockResponse } from './block.types';
import { ValidatorCompleteBlockResponse } from './validatorBlock.types';

/**
 * The Block class provides methods to interact with the Push Chain.
 *
 * **Note: ** It is not recommended to use this class directly.
 * Users should use the Block class under `PushChain.block` instead.
 */
export class Block {
  private constructor(private validator: Validator) {}

  get validatorUrl(): string {
    return this.validator.url;
  }

  static initialize = async (env: ENV) => {
    const validator = await Validator.initalize({ env });
    return new Block(validator);
  };

  /**
   * Retrieves blocks from the Push Chain.
   *
   * This method can fetch either a specific block by its reference or a list of blocks
   * based on the provided parameters. By default, it fetches the latest blocks.
   *
   * @param {string | '*'} [reference='*'] - The block reference to fetch. Use '*' to fetch multiple blocks.
   * @param {Object} [options] - Options for fetching blocks.
   * @param {boolean} [options.raw=false] - If true, returns the raw SDK response.
   * @param {number} [options.startTime=Math.floor(Date.now())] - The start time for fetching blocks.
   * @param {Order} [options.order=Order.DESC] - The order in which to fetch blocks (ascending or descending).
   * @param {number} [options.page=1] - The page number for pagination.
   * @param {number} [options.limit=30] - The number of blocks to fetch per page.
   * @returns {Promise<BlockResponse | CompleteBlockResponse>} A promise that resolves to the block data.
   *
   * @example
   * // Fetch the latest 30 blocks
   * const blocks = await pushChain.block.get('*', { limit: 30 });
   *
   * @example
   * // Fetch a specific block by hash
   * const specificBlock = await pushChain.block.get('blockHash123');
   */
  get = async (
    reference: string | '*' = '*',
    {
      raw = false,
      startTime = Math.floor(Date.now()),
      order = Order.DESC,
      page = 1,
      limit = 30,
    }: {
      raw?: boolean;
      startTime?: number;
      order?: Order;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<BlockResponse | CompleteBlockResponse> => {
    let response: ValidatorCompleteBlockResponse;

    if (reference === '*') {
      response = await this.validator.call<ValidatorCompleteBlockResponse>(
        'push_getBlocks',
        [startTime, order, false, limit, page]
      );
    } else {
      response = await this.validator.call<ValidatorCompleteBlockResponse>(
        'push_getBlockByHash',
        [reference]
      );
    }

    const sdkResponse = toSDKResponse(response);
    if (raw) return sdkResponse;
    else return toSimplifiedBlockResponse(sdkResponse);
  };

  public getWebSocketUrl(): string {
    return this.validator.getWebSocketUrl();
  }
}
