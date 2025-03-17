type Email = {
  from: string;
  to: string[];
  subject: string;
  timestamp: number;
  body: string;
  type?: string;
  attachments?: FileAttachments;
  txHash: string;
};

type FileAttachment = {
  filename: string;
  type: string;
  content: string;
};

type Wallet = {
  address: string;
  chainId: string | null;
  chain: string | null;
};

enum EMAIL_BOX {
  INBOX = 'inbox',
  SENT = 'sent',
}

type RewardsResponseData = {
  activities: {
    [key: string]: {
      activityId: string;
      userWallet: string;
      activityTypeId: string;
      appName: string;
      timestamp: string;
      verificationProof: string;
      data: {
        [key: string]: any;
      };
      createdAt: string;
      updatedAt: string;
    };
  };
};

type FileAttachments = FileAttachment[];
export type {
  Email,
  FileAttachments,
  FileAttachment,
  Wallet,
  RewardsResponseData,
};
export { EMAIL_BOX };
