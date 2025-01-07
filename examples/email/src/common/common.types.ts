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

type FileAttachments = FileAttachment[];
export type { Email, FileAttachments, FileAttachment, Wallet };
export { EMAIL_BOX };
