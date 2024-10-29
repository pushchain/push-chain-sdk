import PushNetwork from '@pushprotocol/node-core';
import { Transaction } from '@pushprotocol/node-core/src/lib/generated/tx';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';
import { PokerGame } from '../temp_types/types';
import { CreateGame, GamesTable } from '../temp_types/new-types';

export class Poker {
  TX_CATEGORY_PREFIX = 'CUSTOM:POKER:';

  TX_CATEGORY_PREFIX_CREATE_GAME_PUBLIC = 'CUSTOM:POKER:CREATE_GAME_PUBLIC';
  TX_CATEGORY_PREFIX_JOIN_GAME_PUBLIC = 'CUSTOM:POKER:JOIN_GAME_PUBLIC:'; // Then add the txHash
  TX_CATEGORY_PREFIX_START_GAME_PUBLIC = 'CUSTOM:POKER:START_GAME_PUBLIC:'; // Then add the txHash

  TX_CATEGORY_PREFIX_CREATE_GAME_PRIVATE = 'CUSTOM:POKER:CREATE_GAME_PRIVATE';

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
    const randomString = Math.random().toString(36).substring(2, 12);
    const unsignedTx = this.pushNetwork.tx.createUnsigned(
      this.TX_CATEGORY_PREFIX + randomString,
      tos,
      serializePokerGame
    );
    return await this.pushNetwork.tx.send(unsignedTx, signer);
  };

  /**
   * @param game - The game to create.
   * @param tos - The addresses to send the game to. If public, must be one address. If private, can be multiple addresses.
   * @param signer - The signer to sign the transaction.
   */
  createGame = async (
    game: CreateGame,
    tos: string[],
    signer: {
      account: string;
      signMessage: (dataToBeSigned: Uint8Array) => Promise<Uint8Array>;
    }
  ) => {
    if (game.type === 'public' && tos.length !== 1)
      throw new Error('Public games must have exactly one recipient');

    const serializeGame = new TextEncoder().encode(JSON.stringify(game));
    const unsignedTx = this.pushNetwork.tx.createUnsigned(
      game.type === 'public'
        ? this.TX_CATEGORY_PREFIX_CREATE_GAME_PUBLIC
        : this.TX_CATEGORY_PREFIX_CREATE_GAME_PRIVATE,
      tos,
      serializeGame
    );
    return await this.pushNetwork.tx.send(unsignedTx, signer);
  };

  /**
   * @param type - The type of games to get. 'public' or 'private'.
   */
  get = async ({ type }: { type: 'public' | 'private' }) => {
    const response = await this.pushNetwork.tx.get(
      Math.floor(Date.now()),
      'DESC',
      30,
      1,
      undefined,
      type === 'public'
        ? this.TX_CATEGORY_PREFIX_CREATE_GAME_PUBLIC
        : this.TX_CATEGORY_PREFIX_CREATE_GAME_PRIVATE
    );

    const gamesTable: GamesTable[] = [];
    response.blocks.forEach((block) => {
      const games: GamesTable[] = block.blockDataAsJson.txobjList.map(
        (txObj: { tx: Transaction }, index: number) => {
          const decodedGame = new TextDecoder().decode(
            new Uint8Array(Buffer.from(txObj.tx.data as any, 'base64'))
          );
          const gameObject: CreateGame = JSON.parse(decodedGame);

          return {
            txHash: block.transactions[index].txnHash,
            creator: txObj.tx.sender,
            type: gameObject.type,
          };
        }
      );

      gamesTable.push(...games);
    });

    return gamesTable;
  };

  checkIfGameStarted = async ({
    txHash,
    creator,
  }: {
    txHash: string;
    creator: string;
  }) => {
    const response = await this.pushNetwork.tx.get(
      Math.floor(Date.now()),
      'DESC',
      30,
      1,
      creator,
      this.TX_CATEGORY_PREFIX_START_GAME_PUBLIC + txHash
    );

    if (response.blocks.length === 0) return false;
    else return true;
  };

  joinGame = async ({
    txHash,
    tos,
    signer,
  }: {
    txHash: string;
    tos: string[];
    signer: {
      account: string;
      signMessage: (dataToBeSigned: Uint8Array) => Promise<Uint8Array>;
    };
  }) => {
    const unsignedTx = this.pushNetwork.tx.createUnsigned(
      this.TX_CATEGORY_PREFIX_JOIN_GAME_PUBLIC + txHash,
      tos,
      new TextEncoder().encode(JSON.stringify({}))
    );
    await this.pushNetwork.tx.send(unsignedTx, signer);
  };

  getNumberOfPlayers = async ({
    txHash,
    creator,
  }: {
    txHash: string;
    creator: string;
  }) => {
    const response = await this.pushNetwork.tx.get(
      Math.floor(Date.now()),
      'DESC',
      30,
      1,
      creator,
      this.TX_CATEGORY_PREFIX_JOIN_GAME_PUBLIC + txHash
    );

    return response.blocks.length + 1; // +1 because the creator is also a player
  };
}
