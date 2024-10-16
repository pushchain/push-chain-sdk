import { Block } from './block/block';
import { ENV } from './constants';
import { Tx } from './tx/tx';
import { Wallet } from './wallet/wallet';

export class PushNetwork {
  private constructor(
    public block: Block,
    public tx: Tx,
    public wallet: Wallet
  ) {}

  static initialize = async (env: ENV = ENV.STAGING) => {
    const block = await Block.initialize(env);
    const tx = await Tx.initialize(env);
    const wallet = new Wallet(env);
    return new PushNetwork(block, tx, wallet);
  };
}
