import { Order, PushChainEnvironment } from '../constants';
import { UniversalAccount } from '../signer/signer.types';
import { Validator } from '../validator/validator';
import { Block as BlockType } from '../generated/block';
import { BlockResponse } from './block.types';

export class Block {
  private constructor(private validator: Validator) {}

  static initialize = async (env: PushChainEnvironment) => {
    const validator = await Validator.initalize({ env });
    return new Block(validator);
  };

  static serialize = (block: BlockType): Uint8Array => {
    const parsedBlock = BlockType.create(block);
    return BlockType.encode(parsedBlock).finish();
  };

  static deserialize = (block: Uint8Array): BlockType => {
    return BlockType.decode(block);
  };

  /**
   * Get Blocks
   */
  get = async (
    reference: string | '*' = '*',
    {
      startTime = Math.floor(Date.now() / 1000),
      order = Order.ASC,
      showDetails = false,
      page = 1,
      limit = 30,
    }: {
      startTime?: number;
      order?: Order;
      showDetails?: boolean;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<BlockResponse> => {
    if (reference === '*') {
      return await this.validator.call<BlockResponse>('push_getBlocks', [
        startTime,
        order,
        showDetails,
        limit,
        page,
      ]);
    } else {
      return await this.validator.call<BlockResponse>('push_getBlockByHash', [
        reference,
      ]);
    }
  };
}
