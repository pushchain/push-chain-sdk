import { Block } from './block/block';
import { ENV } from './constants';
import { UniversalSigner } from './signer/signer.types';
import { Tx } from './tx/tx';
import { Utils } from './utils';

export class PushChain {
  public static utils = Utils;

  private constructor(public block: Block, public tx: Tx) {}

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
