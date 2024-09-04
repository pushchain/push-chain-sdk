import { ENV } from '../constants';
import { Validator } from '../validator/validator';
import { Block as BlockType } from '../generated/block';

export class Block {
  private constructor(private validator: Validator) {}

  static initialize = async (env: ENV) => {
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
    startTime: number = Math.floor(Date.now() / 1000), // Current Local Time
    direction: 'ASC' | 'DESC' = 'ASC',
    showDetails = false,
    pageSize = 30,
    page = 1
  ) => {
    return await this.validator.call<BlockType[]>('push_getTransactions', [
      startTime,
      direction,
      showDetails,
      pageSize,
      page,
    ]);
  };

  /**
   * Search Block with a given hash
   * @param txHash
   */
  search = async (blockHash: string) => {
    return await this.validator.call<BlockType>('push_getBlockByHash', [
      blockHash,
    ]);
  };
}
