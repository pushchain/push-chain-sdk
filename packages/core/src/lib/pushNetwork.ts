import { Block } from './block/block';
import { ENV } from './constants';
import { Tx } from './tx/tx';
import { Wallet } from './wallet/wallet';
import { WebSocketClient } from './websocket/websocket-client';

export class PushNetwork {
  private constructor(
    public block: Block,
    public tx: Tx,
    public wallet: Wallet,
    public ws: WebSocketClient
  ) {}

  static initialize = async (env: ENV = ENV.STAGING) => {
    const block = await Block.initialize(env);
    const tx = await Tx.initialize(env);
    const wallet = new Wallet(env);
    const ws = new WebSocketClient(block.getWebSocketUrl());
    return new PushNetwork(block, tx, wallet, ws);
  };
}
