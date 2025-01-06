import { Block } from './block/block';
import { PushChainEnvironment } from './constants';
import { Signer } from './signer/signer';
import {
  UniversalSigner,
  ValidatedUniversalSigner,
} from './signer/signer.types';
import { Tx } from './tx/tx';
import { Utils } from './utils';
import { Wallet } from './wallet/wallet';

export class PushChain {
  public static utils = Utils;
  public static signer = Signer;

  private constructor(
    public block: Block,
    public tx: Tx,
    public wallet: Wallet
  ) {}

  static initialize = async (
    universalSigner: UniversalSigner | null = null,
    options: {
      network: PushChainEnvironment;
    } = {
      network: PushChainEnvironment.devnet,
    }
  ): Promise<PushChain> => {
    let validatedUniversalSigner: ValidatedUniversalSigner | null = null;
    if (universalSigner) {
      validatedUniversalSigner = this.signer.create(universalSigner);
    }
    const block = await Block.initialize(options.network);
    const tx = await Tx.initialize(options.network, validatedUniversalSigner);
    const wallet = new Wallet(options.network);
    return new PushChain(block, tx, wallet);
  };
}
