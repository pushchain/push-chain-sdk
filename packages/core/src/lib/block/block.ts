import { Order, ENV } from '../constants';
import { toSDKResponse, toSimplifiedBlockResponse } from '../utils';
import { Validator } from '../validator/validator';
import { BlockResponse, CompleteBlockResponse } from './block.types';
import { ValidatorCompleteBlockResponse } from './validatorBlock.types';

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
}
