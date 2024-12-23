import { Address } from '../address/address';
import { Block as GeneratedBlock } from '../generated/block';
import {
  BlockResponse,
  BlockType,
  SimplifiedBlockResponse,
  SimplifiedBlockType,
} from '../block/block.types';
import { Chain, EvmChainId, PushChainId, SolanaChainId } from '../constants';
import { Transaction } from '../generated/tx';
import { InitDid } from '../generated/txData/init_did';
import { InitSessionKey } from '../generated/txData/init_session_key';
import { UniversalAccount } from '../signer/signer.types';
import { SimplifiedTxResponse, TxCategory, TxResponse } from '../tx/tx.types';

export const getRandomElement = <T>(array: T[]): T => {
  if (array.length === 0) {
    throw new Error('Array cannot be empty');
  }
  const randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex];
};

export function toSimplifiedBlockResponse(
  blockResponse: BlockResponse
): SimplifiedBlockResponse {
  return {
    totalPages: blockResponse.totalPages,
    lastTs: blockResponse.lastTs,
    blocks: blockResponse.blocks.map(
      (b: BlockType): SimplifiedBlockType => ({
        blockHash: b.blockHash,
        ts: b.ts,
        totalNumberOfTxns: b.totalNumberOfTxns,
        transactions: b.transactions.map(
          (t: TxResponse): SimplifiedTxResponse => ({
            txnHash: t.txnHash,
            ts: t.ts,
            blockHash: t.blockHash,
            category: t.category,
            status: t.status,
            from: t.from,
            recipients: t.recipients,
            txnData: t.txnData,
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

    switch (chain) {
      case 'eip155':
        if (!Object.values(EvmChainId).includes(chainId as EvmChainId)) {
          throw new Error(`Invalid chainId "${chainId}" for EVM chain`);
        }
        return {
          chain: Chain.Evm,
          chainId: chainId as EvmChainId,
          account: address,
        };

      case 'solana':
        if (!Object.values(SolanaChainId).includes(chainId as SolanaChainId)) {
          throw new Error(`Invalid chainId "${chainId}" for Solana chain`);
        }
        return {
          chain: Chain.Solana,
          chainId: chainId as SolanaChainId,
          account: address,
        };

      case 'push':
        if (!Object.values(PushChainId).includes(chainId as PushChainId)) {
          throw new Error(`Invalid chainId "${chainId}" for Push chain`);
        }
        return {
          chain: Chain.Push,
          chainId: chainId as PushChainId,
          account: address,
        };

      default:
        throw new Error('Invalid Chain');
    }
  }

  private static toChainAgnostic(universalAccount: UniversalAccount): string {
    let chain = '';
    let address = universalAccount.account;

    if (universalAccount.chain === Chain.Evm) {
      chain = 'eip155';
    } else if (universalAccount.chain === Chain.Solana) chain = 'solana';
    else if (universalAccount.chain === Chain.Push) {
      address = universalAccount.account.startsWith('push')
        ? universalAccount.account
        : Address.evmToPush(universalAccount.account as `0x${string}`);
      chain = 'push';
    } else throw new Error('Invalid chain');

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
