import { Address } from '../address/address';
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
import { InitSessionKey } from '../generated/txData/init_session_key';
import { UniversalAccount } from '../signer/signer.types';
import { CompleteTxResponse, TxCategory, TxResponse } from '../tx/tx.types';
import { ValidatorCompleteTxResponse } from '../tx/validatorTx.types';

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

export class Utils {
  static account = {
    toUniversal(chainAgnosticAddress: string): UniversalAccount {
      return Utils.toUniversal(chainAgnosticAddress);
    },
    toChainAgnostic(universalAccount: UniversalAccount): string {
      return Utils.toChainAgnostic(universalAccount);
    },
  };

  static block = {
    serialize(block: GeneratedBlock): Uint8Array {
      return Utils.serializeBlock(block);
    },
    deserialize(block: Uint8Array): GeneratedBlock {
      return Utils.deserializeBlock(block);
    },
  };

  static tx = {
    serialize(tx: Transaction): Uint8Array {
      return Utils.serialize(tx);
    },
    deserialize(tx: Uint8Array): Transaction {
      return Utils.deserialize(tx);
    },
    serializeData(
      txData: InitDid | InitSessionKey,
      category: TxCategory
    ): Uint8Array {
      return Utils.serializeData(txData, category);
    },
    deserializeData(
      txData: Uint8Array,
      category: TxCategory
    ): InitDid | InitSessionKey {
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
        : Address.evmToPush(universalAccount.address as `0x${string}`);
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
    txData: InitDid | InitSessionKey,
    category: TxCategory
  ): Uint8Array => {
    switch (category) {
      case TxCategory.INIT_DID: {
        const data = txData as InitDid;
        const initTxData = InitDid.create(data);
        return InitDid.encode(initTxData).finish();
      }
      case TxCategory.INIT_SESSION_KEY: {
        const data = txData as InitSessionKey;
        const initTxData = InitSessionKey.create(data);
        return InitSessionKey.encode(initTxData).finish();
      }
      default: {
        throw new Error('Serialization Not Supported for given TxCategory');
      }
    }
  };

  private static deserializeData = (
    txData: Uint8Array,
    category: TxCategory
  ): InitDid | InitSessionKey => {
    switch (category) {
      case TxCategory.INIT_DID: {
        return InitDid.decode(txData);
      }
      case TxCategory.INIT_SESSION_KEY: {
        return InitSessionKey.decode(txData);
      }
      default: {
        throw new Error('Deserialization Not Supported for given TxCategory');
      }
    }
  };
}
