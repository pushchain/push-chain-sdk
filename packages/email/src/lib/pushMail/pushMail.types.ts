import { Attachment, EmailBody, EmailHeader } from '../generated/txData/email';

export type Email = {
  // To provide redirect URL for the Transaction
  txHash: string;
  ts: number;
  subject: string;
  from: string;
  to: string[];
  body: EmailBody;
  attachments: Attachment[];
  headers: EmailHeader[];
};
