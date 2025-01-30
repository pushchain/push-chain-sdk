// The types below are the raw types returned by Validator nodes

export type ValidatorCompleteTxResponse = {
  txnHash: string;
  ts: string;
  blockHash: string;
  category: string;
  sender: string;
  status: 'SUCCESS' | 'REJECTED';
  from: string;
  recipients: {
    recipients: {
      address: string;
    }[];
  };
  txnData: string;
  txnDataAsJson: {
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
  };
  sig: string;
};
