interface IEmail {
  from: string;
  to: string[];
  subject: string;
  timestamp: number;
  body: string;
  type?: string;
  attachments?: FileAttachments;
  txHash: string;
}

interface FileAttachment {
  filename: string;
  type: string;
  content: string;
}

interface Wallet {
  address: string;
  chainId: string | null;
  chain: string | null;
}

enum EMAIL_BOX {
  INBOX = 'inbox',
  SENT = 'sent',
}

type FileAttachments = FileAttachment[];
export type { IEmail, FileAttachments, FileAttachment, Wallet };
export { EMAIL_BOX };
