import { TxResponse, CompleteTxResponse } from '../tx/tx.types';

export type CompleteBlockType = {
  blockHash: string;
  blockData: string;
  blockDataAsJson: any;
  blockSize: number;
  ts: number;
  transactions: CompleteTxResponse[];
  totalNumberOfTxns: number;
};

export type CompleteBlockResponse = {
  blocks: CompleteBlockType[];
  lastTs: number;
  totalPages: number;
};

export type BlockResponse = {
  blocks: BlockType[];
  lastTs: number;
  totalPages: number;
};

export type BlockType = {
  blockHash: string;
  ts: number;
  transactions: TxResponse[];
  totalNumberOfTxns: number;
};
