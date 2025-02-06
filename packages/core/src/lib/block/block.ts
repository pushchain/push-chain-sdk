import { ENV } from '../constants';
import { Validator } from '../validator/validator';
import { Block as BlockType } from '../generated/block';
import { BlockResponse } from './block.types';

export class Block {
  private constructor(private validator: Validator) {}

  get validatorUrl(): string {
    return this.validator.url;
  }

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
    return await this.validator.call<BlockResponse>('push_getBlocks', [
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
    return await this.validator.call<BlockResponse>('push_getBlockByHash', [
      blockHash,
    ]);
  };

  public getWebSocketUrl(): string {
    return this.validator.getWebSocketUrl();
  }
}
