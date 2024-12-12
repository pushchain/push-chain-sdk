import { PushNetwork } from '@pushprotocol/node-core';
import { curve } from 'elliptic';
import { Transaction } from '@pushprotocol/node-core/src/lib/generated/tx';
import { PokerGame } from '../temp_types/types';
import {
  GamesTable,
  GameType,
  PushWalletSigner,
} from '../temp_types/new-types';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';
import BN from 'bn.js';
import { publicKeyToString, stringToPublicKey } from '../encryption';
import BasePoint = curve.base.BasePoint;

/**
 * The `Poker` class is a service for managing poker games on a blockchain network using the Push Network protocol.
 * It allows for the creation, joining public and private poker games, player management, and card shuffling with encryption for added security.
 */
export class Poker {
  TX_CATEGORY_PREFIX = 'POKER:';

  TX_CATEGORY_PREFIX_CREATE_GAME_PUBLIC = `${this.TX_CATEGORY_PREFIX}CREATE_GAME_PUBLIC`;
  TX_CATEGORY_PREFIX_JOIN_GAME_PUBLIC = `${this.TX_CATEGORY_PREFIX}JOIN_GAME_PUBLIC:`; // Then add the txHash
  TX_CATEGORY_PREFIX_START_GAME_PUBLIC = `${this.TX_CATEGORY_PREFIX}START_GAME_PUBLIC:`; // Then add the txHash
  TX_CATEGORY_PREFIX_CREATE_GAME_PRIVATE = `${this.TX_CATEGORY_PREFIX}CREATE_GAME_PRIVATE`;
  TX_CATEGORY_PREFIX_PLAYER_PUBLIC_KEY = `${this.TX_CATEGORY_PREFIX}PLAYER_PUBLIC_KEY:`; // Then add the txHash
  TX_CATEGORY_PREFIX_DECK_ENCRYPT = `${this.TX_CATEGORY_PREFIX}CARDS_ENCRYPT:`; // Then add the txHash
  TX_CATEGORY_PREFIX_DECK_DECRYPT = `${this.TX_CATEGORY_PREFIX}CARDS_DECRYPT:`; // Then add the txHash

  private constructor(private pushNetwork: PushNetwork) {}

  /**
   * @param env - The environment to use. Defaults to `ENV.DEV`.
   */
  static initialize = async (env: ENV = ENV.DEV) => {
    const pushNetwork = await PushNetwork.initialize(env);
    return new Poker(pushNetwork);
  };

  /**
   * Update game status, for example whenever someone places a bet, checks and folds or even **start** a game.
   * @param txHash
   * @param pokerGame
   * @param tos
   * @param signer
   */
  updateGame = async (
    txHash: string,
    pokerGame: PokerGame,
    tos: Set<string>,
    signer: PushWalletSigner
  ) => {
    // TODO: Use protobuf instead of JSON
    const serializePokerGame = new TextEncoder().encode(
      JSON.stringify(pokerGame)
    );
    const unsignedTx = this.pushNetwork.tx.createUnsigned(
      this.TX_CATEGORY_PREFIX + txHash,
      [...tos],
      serializePokerGame
    );
    return await this.pushNetwork.tx.send(unsignedTx, signer);
  };

  /**
   * The most important function of this Poker Class. This function will return a txHash. This txHash will be the identifier
   * of this particular game. Whenever a user wants to join, submit their public key etc., they will be doing that
   * by using this txHash as reference in the category
   * @param game - The game to create.
   * @param tos - The addresses to send the game to. If public, must be one address. If private, can be multiple addresses.
   * @param signer - The signer to sign the transaction.
   * @returns {Promise<string>} A promise that resolves to a string representing the txHash for the game.
   */
  createGame = async (
    game: GameType,
    tos: string[],
    signer: PushWalletSigner
  ): Promise<string> => {
    if (game.type === 'public' && tos.length !== 1)
      throw new Error('Public games must have exactly one recipient');

    // TODO: Do we need to have this body on the transaction? Because the category already convey the info if `public` or `private`
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
            new Uint8Array(
              Buffer.from(txObj.tx.data as unknown as string, 'base64')
            )
          );
          const gameObject: GameType = JSON.parse(decodedGame);

          return {
            txHash: block.transactions[index].txnHash,
            creator: txObj.tx.sender,
            type: gameObject.type,
            players: new Set<string>()
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

    return response.blocks.length !== 0;
  };

  /**
   * Joins an existing poker game using the provided `txHash` as a reference to the game created in the `createGame` function.
   * This `txHash` serves as the unique identifier for the game, allowing participants to join and submit their public keys.
   * @param txHash
   * @param tos
   * @param signer
   */
  joinGame = async ({
    txHash,
    tos,
    signer,
  }: {
    txHash: string;
    tos: string[];
    signer: PushWalletSigner;
  }) => {
    const unsignedTx = this.pushNetwork.tx.createUnsigned(
      (this.TX_CATEGORY_PREFIX_JOIN_GAME_PUBLIC + txHash).slice(0, 30),
      tos,
      // TODO: Later do `new Uint8Array(0)` to pass 0 uint8 array.
      // The txHash below is being passed only because before is was throwing an error when there was nothing on the data, so passed the txHash just to
      // the transaction to be inserted
      new TextEncoder().encode(JSON.stringify({ txHash }))
      // new Uint8Array(10)
    );
    await this.pushNetwork.tx.send(unsignedTx, signer);
  };

  /**
   * Get Player address order by time they joined the game
   * @param txHash
   * @param creator
   */
  getPlayerOrderForTable = async ({
    txHash,
    creator,
  }: {
    txHash: string;
    creator: string;
  }): Promise<Set<string>> => {
    const response = await this.pushNetwork.tx.getByRecipient(
      creator,
      Math.floor(Date.now()),
      'DESC',
      50,
      1,
      (this.TX_CATEGORY_PREFIX_JOIN_GAME_PUBLIC + txHash).slice(0, 30)
    );
    const players = new Set<string>();
    response.blocks.forEach((block) => {
      block.blockDataAsJson.txobjList.forEach((txObj: { tx: Transaction }) => {
        if (!players.has(txObj.tx.sender)) {
          players.add(txObj.tx.sender);
        }
      });
    });

    return new Set<string>([creator, ...players]); // We do this so we add creator as first element of array
  };

  /**
   * This function is called at the beginning of each match. Each user will submit their public key to the network so we
   * can use for the card's encryption
   */
  submitPublicKey = async (
    txHash: string,
    publicKey: BasePoint,
    tos: string[],
    signer: PushWalletSigner
  ): Promise<string> => {
    const unsignedTx = this.pushNetwork.tx.createUnsigned(
      (this.TX_CATEGORY_PREFIX_PLAYER_PUBLIC_KEY + txHash).slice(0, 30),
      tos,
      new TextEncoder().encode(
        JSON.stringify({ publicKey: publicKeyToString(publicKey) })
      )
    );
    console.log("beforesub",JSON.stringify({ publicKey: publicKeyToString(publicKey) }))
    return await this.pushNetwork.tx.send(unsignedTx, signer);
  };

  /**
   * Get the `playerAddress` public key for the `txHash` game. Returns `null` if transaction not found
   * @param txHash
   * @param playerAddress
   */
  getPlayerPublicKey = async (
    txHash: string,
    playerAddress: string
  ): Promise<BasePoint | null> => {
    const response = await this.pushNetwork.tx.getBySender(
      playerAddress,
      Math.floor(Date.now()),
      'DESC',
      30,
      1,
      (this.TX_CATEGORY_PREFIX_PLAYER_PUBLIC_KEY + txHash).slice(0, 30)
    );
    // We get the first publicKey submitted by that player. We will have only 1 transaction that the user will
    // submit with his public key. There will be more than 1 transaction submitted only in case of a bug
   
    const block = response.blocks[0];
    const transaction = block.blockDataAsJson.txobjList[0] as { tx: Transaction };

    const decodedData = new TextDecoder().decode(
      new Uint8Array(
        Buffer.from(transaction.tx.data as unknown as string, 'base64')
      )
    );
    console.log("decodedData",decodedData)
    console.log("parsed",JSON.parse(decodedData).publicKey)
    return stringToPublicKey(JSON.parse(decodedData).publicKey);
  };

  publishEncryptedShuffledCards = async (
    txHash: string,
    creator: string,
    encryptedShuffledCards: Set<BN>,
    signer: PushWalletSigner
  ): Promise<string> => {
    // Convert Set<BN> to an array of strings
    const deckArray = Array.from(encryptedShuffledCards, (card) => card.toString(10));
    const dataToStore = JSON.stringify({ deck: deckArray });
  
    const unsignedTx = this.pushNetwork.tx.createUnsigned(
      (this.TX_CATEGORY_PREFIX_DECK_ENCRYPT + txHash).slice(0, 30),
      [creator],
      new TextEncoder().encode(dataToStore)
    );
  
    return await this.pushNetwork.tx.send(unsignedTx, signer);
  };

  /**
   * Get the latest deck from particular user. Returns `null` if there is none
   * @param gameTransactionHash game identifier
   * @param address the address of the last player who have submitted the encrypted deck.
   */
  getEncryptedShuffledCards = async (
    gameTransactionHash: string,
    address: string
  ): Promise<Set<BN> | null> => {
    const response = await this.pushNetwork.tx.getBySender(
      address,
      Math.floor(Date.now()),
      'DESC',
      30,
      1,
      (this.TX_CATEGORY_PREFIX_DECK_ENCRYPT + gameTransactionHash).slice(0, 30)
    );
  
    if (response.blocks.length === 0) return null;
    const block = response.blocks[0];
    const transaction = block.blockDataAsJson.txobjList[0] as { tx: Transaction };
  
    const decodedData = new TextDecoder().decode(
      new Uint8Array(Buffer.from(transaction.tx.data as unknown as string, 'base64'))
    );
  
    const parsed = JSON.parse(decodedData); // { deck: string[] }
    const deckSet = new Set<BN>(parsed.deck.map((cardStr: string) => new BN(cardStr, 10)));
  
    return deckSet;
  };

  publishDecryptedShuffledCards = async (
    txHash: string,
    creator: string,
    decryptedShuffledCards: Set<BN>,
    signer: PushWalletSigner
  ): Promise<string> => {
    const deckArray = Array.from(decryptedShuffledCards, (card) => card.toString(10));
    const dataToStore = JSON.stringify({ deck: deckArray });
  
    const unsignedTx = this.pushNetwork.tx.createUnsigned(
      (this.TX_CATEGORY_PREFIX_DECK_DECRYPT + txHash).slice(0, 30),
      [creator],
      new TextEncoder().encode(dataToStore)
    );
  
    return await this.pushNetwork.tx.send(unsignedTx, signer);
  };
  

  getDecryptedShuffledCards = async (
    gameTransactionHash: string,
    address: string
  ): Promise<Set<BN> | null> => {
    const response = await this.pushNetwork.tx.getBySender(
      address,
      Math.floor(Date.now()),
      'DESC',
      30,
      1,
      (this.TX_CATEGORY_PREFIX_DECK_DECRYPT + gameTransactionHash).slice(0, 30)
    );
  
    if (response.blocks.length === 0) return null;
    const block = response.blocks[0];
    const transaction = block.blockDataAsJson.txobjList[0] as { tx: Transaction };
  
    const decodedData = new TextDecoder().decode(
      new Uint8Array(Buffer.from(transaction.tx.data as unknown as string, 'base64'))
    );
  
    const parsed = JSON.parse(decodedData); // { deck: string[] }
    const deckSet = new Set<BN>(parsed.deck.map((cardStr: string) => new BN(cardStr, 10)));
  
    return deckSet;
  };

  async getGameState(txHash: string): Promise<PokerGame | null> {
    const response = await this.pushNetwork.tx.get(
      Math.floor(Date.now()),
      'DESC',
      30,
      1,
      undefined,
      (this.TX_CATEGORY_PREFIX + txHash).slice(0, 30)
    );
  
    if (response.blocks.length === 0) return null;
  
    const block = response.blocks[0];
    const transaction = block.blockDataAsJson.txobjList[0] as { tx: Transaction };
    const decodedData = new TextDecoder().decode(
      new Uint8Array(Buffer.from(transaction.tx.data as unknown as string, 'base64'))
    );
    return JSON.parse(decodedData) as PokerGame;
  }
}
