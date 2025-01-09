import { Address } from '../address/address';
import {
  BlockResponse,
  BlockType,
  CompleteBlockResponse,
  CompleteBlockType,
} from '../block/block.types';
import { CHAIN } from '../constants';
import { Block as GeneratedBlock } from '../generated/block';
import { Transaction } from '../generated/tx';
import { InitDid } from '../generated/txData/init_did';
import { InitSessionKey } from '../generated/txData/init_session_key';
import { UniversalAccount } from '../signer/signer.types';
import { CompleteTxResponse, TxCategory, TxResponse } from '../tx/tx.types';

export const getRandomElement = <T>(array: T[]): T => {
  if (array.length === 0) {
    throw new Error('Array cannot be empty');
  }
  const randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex];
};

export function toSimplifiedBlockResponse(
  blockResponse: CompleteBlockResponse
): BlockResponse {
  return {
    totalPages: blockResponse.totalPages,
    lastTs: blockResponse.lastTs,
    blocks: blockResponse.blocks.map(
      (b: CompleteBlockType): BlockType => ({
        blockHash: b.blockHash,
        ts: b.ts,
        totalNumberOfTxns: b.totalNumberOfTxns,
        transactions: b.transactions.map(
          (t: CompleteTxResponse): TxResponse => ({
            txnHash: t.txnHash,
            ts: t.ts,
            blockHash: t.blockHash,
            category: t.category,
            status: t.status,
            from: t.from,
            recipients: t.recipients,
            txnData: new TextDecoder().decode(
              new Uint8Array(Buffer.from(t.txnData as unknown as string, 'hex'))
            ),
            sig: t.sig,
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
    return {
      chain: chain,
      chainId: chainId,
      account: address,
    };
  }

  private static toChainAgnostic(universalAccount: UniversalAccount): string {
    let chain = '';
    let address = universalAccount.account;

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
      address = universalAccount.account.startsWith('push')
        ? universalAccount.account
        : Address.evmToPush(universalAccount.account as `0x${string}`);
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
