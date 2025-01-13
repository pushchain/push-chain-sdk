import { Block } from './block/block';
import { ENV } from './constants';
import { Signer } from './signer/signer';
import {
  UniversalSigner,
  ValidatedUniversalSigner,
} from './signer/signer.types';
import { Tx } from './tx/tx';
import { Utils } from './utils';

export class PushChain {
  public static utils = Utils;
  public static signer = Signer;

  private constructor(public block: Block, public tx: Tx) {}

  static initialize = async (
    universalSigner: UniversalSigner | null = null,
    options: {
      network: ENV;
    } = {
      network: ENV.DEVNET,
    }
  ): Promise<PushChain> => {
    let validatedUniversalSigner: ValidatedUniversalSigner | null = null;
    if (universalSigner) {
      validatedUniversalSigner = this.signer.create(universalSigner);
    }
    const block = await Block.initialize(options.network);
    const tx = await Tx.initialize(options.network, validatedUniversalSigner);
    return new PushChain(block, tx);
  };
}
