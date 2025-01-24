import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { bech32m } from 'bech32';
import { getAddress } from 'viem';
// import { Address } from '../address/address';
import {
  BlockResponse,
  BlockType,
  CompleteBlockResponse,
  CompleteBlockType,
} from '../block/block.types';
import {
  ValidatorCompleteBlockResponse,
  ValidatorCompleteBlockType,
} from '../block/validatorBlock.types';
import { CHAIN, CHAIN_ID } from '../constants';
import { Block as GeneratedBlock } from '../generated/block';
import { Transaction } from '../generated/tx';
import { InitDid } from '../generated/txData/init_did';
import { UniversalAccount } from '../signer/signer.types';
import { CompleteTxResponse, TxCategory, TxResponse } from '../tx/tx.types';
import { ValidatorCompleteTxResponse } from '../tx/validatorTx.types';

const PUSH_PREFIX = 'push';

/**
 * Returns a random element from a non-empty array.
 *
 * @template T - The type of elements in the array.
 * @param {T[]} array - An array from which to pick a random element.
 * @returns {T} A randomly selected element of the given array.
 * @throws {Error} If the provided array is empty.
 *
 * @example
 * const myArray = [1, 2, 3, 4];
 * const randomItem = getRandomElement(myArray);
 * // randomItem could be any of 1, 2, 3, or 4
 */
export const getRandomElement = <T>(array: T[]): T => {
  if (array.length === 0) {
    throw new Error('Array cannot be empty');
  }
  const randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex];
};

export function toSDKResponse(
  block: ValidatorCompleteBlockResponse
): CompleteBlockResponse {
  return {
    lastTimestamp: block.lastTs,
    totalPages: block.totalPages,
    blocks: block.blocks.map(
      (b: ValidatorCompleteBlockType): CompleteBlockType => ({
        blockHash: b.blockHash,
        timestamp: b.ts,
        totalNumberOfTxns: b.totalNumberOfTxns,
        transactions: b.transactions.map(
          (t: ValidatorCompleteTxResponse): CompleteTxResponse => ({
            hash: t.txnHash,
            fee: t.txnDataAsJson.tx.fee,
            salt: t.txnDataAsJson.tx.salt,
            apiToken: t.txnDataAsJson.tx.apitoken,
            timestamp: +t.ts,
            category: t.category,
            from: t.from,
            recipients: t.recipients.recipients.map((r) => r.address),
            data: new TextDecoder().decode(
              new Uint8Array(Buffer.from(t.txnData, 'hex'))
            ),
            signature: t.sig,
          })
        ),
      })
    ),
  };
}

export function toSimplifiedBlockResponse(
  blockResponse: CompleteBlockResponse
): BlockResponse {
  return {
    totalPages: blockResponse.totalPages,
    lastTimestamp: blockResponse.lastTimestamp,
    blocks: blockResponse.blocks.map(
      (b: CompleteBlockType): BlockType => ({
        blockHash: b.blockHash,
        timestamp: b.timestamp,
        totalNumberOfTxns: b.totalNumberOfTxns,
        transactions: b.transactions.map(
          (t: CompleteTxResponse): TxResponse => ({
            hash: t.hash,
            fee: t.fee,
            timestamp: t.timestamp,
            category: t.category,
            from: t.from,
            recipients: t.recipients,
            data: t.data,
            signature: t.signature,
          })
        ),
      })
    ),
  };
}

/**
 * A collection of utility functions for handling
 * - Account/address conversions
 * - Block (de)serialization
 * - Transaction (de)serialization
 * - Data (de)serialization for different transaction categories
 *
 * @example
 * // Example usage of PushChain.utils.account
 * const chainAgnostic = PushChain.utils.account.toChainAgnostic({
 *   chain: 'ETHEREUM',
 *   chainId: '1',
 *   address: '0xabc123...',
 * });
 * // => 'eip155:1:0xabc123...'
 */
export class Utils {
  /**
   * A namespace for converting addresses and handling UniversalAccount mappings.
   */
  static account = {
    /**
     * Converts a chain-agnostic address (e.g. `eip155:1:0xabc...`) into a UniversalAccount.
     *
     * @param {string} chainAgnosticAddress - A CAIP-formatted string, e.g. 'eip155:1:0xabc...'.
     * @returns {UniversalAccount} A UniversalAccount that identifies the chain, chainId, and address.
     *
     * @example
     * const universalAccount = PushChain.utils.account.toUniversal('push:devnet:push1xkuy...');
     * // => { chain: 'PUSH', chainId: 'DEVNET', address: 'push1xkuy...' }
     */
    toUniversal(chainAgnosticAddress: string): UniversalAccount {
      return Utils.toUniversal(chainAgnosticAddress);
    },

    /**
     * Converts a UniversalAccount into a chain-agnostic address (CAIP) string.
     *
     * @param {UniversalAccount} universalAccount - The universal account to convert.
     * @returns {string} A CAIP-formatted string, e.g. 'eip155:1:0xabc...'.
     *
     * @example
     * const chainAgnosticStr = PushChain.utils.account.toChainAgnostic({
     *   chain: 'ETHEREUM',
     *   chainId: '1',
     *   address: '0xabc123...'
     * });
     * // => 'eip155:1:0xabc123...'
     */
    toChainAgnostic(universalAccount: UniversalAccount): string {
      return Utils.toChainAgnostic(universalAccount);
    },

    /**
     * Converts an EVM (Ethereum) address to a Push (bech32m) address.
     *
     * @param {`0x${string}`} address - A valid EVM address (checksummed or not).
     * @returns {string} A Push (bech32m) address string.
     * @throws {Error} Throws an error if the EVM address is invalid.
     *
     * @example
     * const pushAddr = PushChain.utils.account.evmToPush('0x35B84d6848D16415177c64D64504663b998A6ab4');
     * // => 'push1xkuy66zg69jp29muvnty2prx8wvc5645f9y5ux'
     */
    evmToPushAddress(address: `0x${string}`): string {
      try {
        const words = bech32m.toWords(hexToBytes(getAddress(address).slice(2)));
        return bech32m.encode(PUSH_PREFIX, words);
      } catch (e) {
        throw new Error('Invalid EVM address');
      }
    },

    /**
     * Converts a Push (bech32m) address back to an EVM (Ethereum) address in checksum format.
     *
     * @param {string} address - A valid Push (bech32m) address, e.g. 'push1xkuy66...'
     * @returns {string} The corresponding checksummed EVM address, e.g. '0x35B84d...'
     * @throws {Error} If the Push address is invalid.
     *
     * @example
     * const evmAddr = PushChain.utils.account.pushToEvmAddress('push1xkuy66zg69jp29muvnty2prx8wvc5645f9y5ux');
     * // => '0x35B84d6848D16415177c64D64504663b998A6ab4'
     */
    pushToEvmAddress(address: string): string {
      try {
        const decoded = bech32m.decode(address);
        const bytes = new Uint8Array(bech32m.fromWords(decoded.words));
        return getAddress(`0x${bytesToHex(bytes)}`);
      } catch (e) {
        throw new Error('Invalid Push address');
      }
    },
  };

  /**
   * A namespace for block (de)serialization.
   */
  static block = {
    /**
     * Serializes a GeneratedBlock into a Uint8Array.
     *
     * @param {GeneratedBlock} block - The block data to encode.
     * @returns {Uint8Array} The serialized block in binary format.
     *
     * @example
     * const encodedBlock = PushChain.utils.block.serialize(myBlock);
     */
    serialize(block: GeneratedBlock): Uint8Array {
      return Utils.serializeBlock(block);
    },

    /**
     * Deserializes a Uint8Array back into a GeneratedBlock object.
     *
     * @param {Uint8Array} block - The raw serialized block data.
     * @returns {GeneratedBlock} The decoded block object.
     *
     * @example
     * const decodedBlock = PushChain.utils.block.deserialize(encodedBlock);
     */
    deserialize(block: Uint8Array): GeneratedBlock {
      return Utils.deserializeBlock(block);
    },
  };

  /**
   * A namespace for transaction (de)serialization and handling transaction data.
   */
  static tx = {
    /**
     * Serializes a Transaction into a Uint8Array.
     *
     * @param {Transaction} tx - The transaction object to encode.
     * @returns {Uint8Array} The serialized transaction.
     *
     * @example
     * const serializedTx = PushChain.utils.tx.serialize(myTx);
     */
    serialize(tx: Transaction): Uint8Array {
      return Utils.serialize(tx);
    },

    /**
     * Deserializes a Uint8Array back into a Transaction object.
     *
     * @param {Uint8Array} tx - The raw serialized transaction data.
     * @returns {Transaction} The decoded transaction object.
     *
     * @example
     * const deserializedTx = PushChain.utils.tx.deserialize(serializedTx);
     */
    deserialize(tx: Uint8Array): Transaction {
      return Utils.deserialize(tx);
    },
    /**
     * Serializes transaction data (e.g. `InitDid`) based on the transaction category.
     *
     * @param {InitDid} txData - The transaction data object (e.g., `InitDid`).
     * @param {TxCategory} category - The category of the transaction (e.g. `INIT_DID`).
     * @returns {Uint8Array} The serialized transaction data.
     * @throws {Error} If the category is unsupported for serialization.
     *
     * @example
     * const initDidData = { /* ...  };
     * const serializedData = PushChain.utils.tx.serializeData(initDidData, TxCategory.INIT_DID);
     */
    serializeData(txData: InitDid, category: TxCategory): Uint8Array {
      return Utils.serializeData(txData, category);
    },

    /**
     * Deserializes transaction data (e.g. `InitDid`) from a Uint8Array based on the transaction category.
     *
     * @param {Uint8Array} txData - The serialized transaction data.
     * @param {TxCategory} category - The transaction category (e.g. `INIT_DID`).
     * @returns {InitDid} The deserialized transaction data object.
     * @throws {Error} If the category is unsupported for deserialization.
     *
     * @example
     * const deserializedData = PushChain.utils.tx.deserializeData(serializedData, TxCategory.INIT_DID);
     */
    deserializeData(txData: Uint8Array, category: TxCategory): InitDid {
      return Utils.deserializeData(txData, category);
    },
  };

  /**
   * @param chainAgnosticAddress in CAIP10 - example: eip155:1:0xabc...
   */
  private static toUniversal(chainAgnosticAddress: string): UniversalAccount {
    const [chain, chainId, address] = chainAgnosticAddress.split(':');

    if (chain.toLocaleLowerCase() === 'eip155') {
      if (chainId === '1') {
        return {
          chain: CHAIN.ETHEREUM,
          chainId: CHAIN_ID.ETHEREUM.MAINNET,
          address,
        };
      } else if (chainId === '11155111') {
        return {
          chain: CHAIN.ETHEREUM,
          chainId: CHAIN_ID.ETHEREUM.SEPOLIA,
          address,
        };
      } else
        return {
          chain: CHAIN.ETHEREUM,
          chainId,
          address,
        };
    } else if (chain.toLocaleLowerCase() === 'push') {
      if (chainId.toLocaleLowerCase() === 'mainnet') {
        return {
          chain: CHAIN.PUSH,
          chainId: CHAIN_ID.PUSH.MAINNET,
          address,
        };
      } else if (chainId.toLocaleLowerCase() === 'devnet') {
        return {
          chain: CHAIN.PUSH,
          chainId: CHAIN_ID.PUSH.DEVNET,
          address,
        };
      } else
        return {
          chain: CHAIN.PUSH,
          chainId,
          address,
        };
    } else if (chain.toLocaleLowerCase() === 'solana') {
      if (chainId.toLocaleLowerCase() === '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') {
        return {
          chain: CHAIN.SOLANA,
          chainId: CHAIN_ID.SOLANA.MAINNET,
          address,
        };
      } else if (
        chainId.toLocaleLowerCase() === 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
      ) {
        return {
          chain: CHAIN.SOLANA,
          chainId: CHAIN_ID.SOLANA.DEVNET,
          address,
        };
      } else if (
        chainId.toLocaleLowerCase() === '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z'
      ) {
        return {
          chain: CHAIN.SOLANA,
          chainId: CHAIN_ID.SOLANA.TESTNET,
          address,
        };
      } else
        return {
          chain: CHAIN.SOLANA,
          chainId: chainId,
          address,
        };
    } else
      return {
        chain: chain,
        chainId: chainId,
        address,
      };
  }

  private static toChainAgnostic(universalAccount: UniversalAccount): string {
    let chain = '';
    let address = universalAccount.address;

    if (
      universalAccount.chain.toLocaleLowerCase() ===
      CHAIN.ETHEREUM.toLocaleLowerCase()
    ) {
      chain = 'eip155';
    } else if (
      universalAccount.chain.toLocaleLowerCase() ===
      CHAIN.SOLANA.toLocaleLowerCase()
    )
      chain = 'solana';
    else if (
      universalAccount.chain.toLocaleLowerCase() ===
      CHAIN.PUSH.toLocaleLowerCase()
    ) {
      address = universalAccount.address.startsWith('push')
        ? universalAccount.address
        : Utils.account.evmToPushAddress(
            universalAccount.address as `0x${string}`
          );
      chain = 'push';
    } else {
      chain = universalAccount.chain.toLocaleLowerCase();
      console.log('Chain not in constants');
    }

    return `${chain}:${universalAccount.chainId}:${address}`;
  }

  private static serializeBlock(block: GeneratedBlock): Uint8Array {
    const parsedBlock = GeneratedBlock.create(block);
    return GeneratedBlock.encode(parsedBlock).finish();
  }

  private static deserializeBlock(block: Uint8Array): GeneratedBlock {
    return GeneratedBlock.decode(block);
  }

  private static serialize = (tx: Transaction): Uint8Array => {
    const transaction = Transaction.create(tx);
    return Transaction.encode(transaction).finish();
  };

  private static deserialize = (tx: Uint8Array): Transaction => {
    return Transaction.decode(tx);
  };

  private static serializeData = (
    txData: InitDid,
    category: TxCategory
  ): Uint8Array => {
    switch (category) {
      case TxCategory.INIT_DID: {
        const data = txData as InitDid;
        const initTxData = InitDid.create(data);
        return InitDid.encode(initTxData).finish();
      }
      default: {
        throw new Error('Serialization Not Supported for given TxCategory');
      }
    }
  };

  private static deserializeData = (
    txData: Uint8Array,
    category: TxCategory
  ): InitDid => {
    switch (category) {
      case TxCategory.INIT_DID: {
        return InitDid.decode(txData);
      }
      default: {
        throw new Error('Deserialization Not Supported for given TxCategory');
      }
    }
  };
}
