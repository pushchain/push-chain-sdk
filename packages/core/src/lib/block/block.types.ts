import { TxResponse } from '../tx/tx.types';

export type BlockType = {
  blockHash: string;
  blockData: string;
  blockDataAsJson: any;
  blockSize: number;
  ts: number;
  transactions: TxResponse[];
  totalNumberOfTxns: number;
};

export type BlockResponse = {
  blocks: BlockType[];
  lastTs: number;
  totalPages: number;
};
