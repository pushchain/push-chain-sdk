import { Block } from './block/block';
import { ENV } from './constants';
import { Tx } from './tx/tx';

export class PushNetwork {
  private constructor(public block: Block, public tx: Tx) {}

  static initialize = async (env: ENV = ENV.STAGING) => {
    const block = await Block.initialize(env);
    const tx = await Tx.initialize(env);
    return new PushNetwork(block, tx);
  };
}
