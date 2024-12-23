import { Order, PushChainEnvironment } from '../constants';
import { toSimplifiedBlockResponse } from '../utils';
import { Validator } from '../validator/validator';
import { BlockResponse, SimplifiedBlockResponse } from './block.types';

export class Block {
  private constructor(private validator: Validator) {}

  static initialize = async (env: PushChainEnvironment) => {
    const validator = await Validator.initalize({ env });
    return new Block(validator);
  };

  /**
   * Get Blocks
   */
  get = async (
    reference: string | '*' = '*',
    {
      raw = false,
      startTime = Math.floor(Date.now()),
      order = Order.DESC,
      showDetails = false,
      page = 1,
      limit = 30,
    }: {
      raw?: boolean;
      startTime?: number;
      order?: Order;
      showDetails?: boolean;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<BlockResponse | SimplifiedBlockResponse> => {
    if (reference === '*') {
      const response = await this.validator.call<BlockResponse>(
        'push_getBlocks',
        [startTime, order, showDetails, limit, page]
      );
      if (raw) return response;
      else return toSimplifiedBlockResponse(response);
    } else {
      const response = await this.validator.call<BlockResponse>(
        'push_getBlockByHash',
        [reference]
      );
      if (raw) return response;
      else return toSimplifiedBlockResponse(response);
    }
  };
}
