import { Order, ENV } from '../constants';
import { toSimplifiedBlockResponse } from '../utils';
import { Validator } from '../validator/validator';
import { BlockResponse, CompleteBlockResponse } from './block.types';

export class Block {
  private constructor(private validator: Validator) {}

  static initialize = async (env: ENV) => {
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
    if (reference === '*') {
      const response = await this.validator.call<CompleteBlockResponse>(
        'push_getBlocks',
        [startTime, order, false, limit, page]
      );
      if (raw) return response;
      else return toSimplifiedBlockResponse(response);
    } else {
      const response = await this.validator.call<CompleteBlockResponse>(
        'push_getBlockByHash',
        [reference]
      );
      if (raw) return response;
      else return toSimplifiedBlockResponse(response);
    }
  };
}
