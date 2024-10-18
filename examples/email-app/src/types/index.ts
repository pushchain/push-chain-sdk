interface IEmail {
  from: string;
  to: string[];
  subject: string;
  timestamp: number;
  body: string;
  type?: string;
  attachments?: FileAttachments;
}
interface FileAttachment {
  filename: string;
  type: string;
  content: string;
}

type FileAttachments = FileAttachment[];
export type { IEmail, FileAttachments };
