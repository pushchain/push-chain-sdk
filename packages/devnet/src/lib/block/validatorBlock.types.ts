// The types below are the raw types returned by Validator nodes

import { ValidatorCompleteTxResponse } from '../tx/validatorTx.types';

export type ValidatorCompleteBlockType = {
  blockHash: string;
  blockData: string;
  blockDataAsJson: ValidatorBlockDataAsJson;
  blockSize: number;
  ts: number;
  transactions: ValidatorCompleteTxResponse[];
  totalNumberOfTxns: number;
};

export type ValidatorCompleteBlockResponse = {
  blocks: ValidatorCompleteBlockType[];
  lastTs: number;
  totalPages: number;
};

export type ValidatorBlockDataAsJson = {
  ts: number;
  txobjList: {
    tx: {
      fee: string;
      data: string;
      salt: string;
      type: number;
      sender: string;
      apitoken: string;
      category: string;
      signature: string;
      recipientsList: string[];
    };
    validatordata: {
      vote: number;
    };
    attestordataList: {
      vote: number;
    }[];
  }[];
  attesttoken: string;
  signersList: {
    sig: string;
  }[];
};
