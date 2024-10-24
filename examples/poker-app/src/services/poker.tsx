import PushNetwork from '@pushprotocol/node-core';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';
import { PokerGame } from '../temp_types/types';

export class Poker {
  TX_CATEGORY_PREFIX = 'CUSTOM:POKER:';

  private constructor(private pushNetwork: PushNetwork) {}

  /**
   * @param env - The environment to use. Defaults to `ENV.DEV`.
   */
  static initialize = async (env: ENV = ENV.DEV) => {
    const pushNetwork = await PushNetwork.initialize(env);
    return new Poker(pushNetwork);
  };

  send = async (
    pokerGame: PokerGame,
    tos: string[],
    signer: {
      account: string;
      signMessage: (dataToBeSigned: Uint8Array) => Promise<Uint8Array>;
    }
  ) => {
    // TODO: Use protobuf instead of JSON
    const serializePokerGame = new TextEncoder().encode(
      JSON.stringify(pokerGame)
    );
    const randomString = Math.random().toString(36).substring(2, 12); // Generates a random string
    const unsignedTx = this.pushNetwork.tx.createUnsigned(
      this.TX_CATEGORY_PREFIX + randomString,
      tos,
      serializePokerGame
    );
    return await this.pushNetwork.tx.send(unsignedTx, signer);
  };
}
