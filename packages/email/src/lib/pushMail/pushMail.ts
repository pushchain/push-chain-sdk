import {
  Attachment,
  Email,
  EmailBody,
  EmailHeader,
} from '../generated/txData/email';
import { PushNetwork } from '@pushprotocol/push-chain';
import { ENV } from '@pushprotocol/push-chain/src/lib/constants';
import { Transaction } from '@pushprotocol/push-chain/src/lib/generated/tx';

export class PushMail {
  TX_CATEGORY = 'CUSTOM:PUSH_MAIL';
  private constructor(private pushNetwork: PushNetwork) {}

  static initialize = async (env: ENV = ENV.STAGING) => {
    const pushNetwork = await PushNetwork.initialize(env);
    return new PushMail(pushNetwork);
  };

  private static serializeData = (txData: Email) =>
    Email.encode(Email.create(txData)).finish();

  private static deserializeData = (txData: Uint8Array) => Email.decode(txData);

  /**
   * Get Push Mails
   */
  get = async (
    userAddress: string,
    startTime: number = Math.floor(Date.now()), // Current Local Time
    direction: 'ASC' | 'DESC' = 'DESC',
    pageSize = 30,
    page = 1
  ): Promise<Email[]> => {
    // Fetch data from the network
    const res = await this.pushNetwork.tx.get(
      startTime,
      direction,
      pageSize,
      page,
      userAddress,
      this.TX_CATEGORY
    );

    const pushMail: Email[] = [];
    res.blocks.forEach((block) => {
      // Use map instead of forEach to transform data
      const mails: Email[] = block.blockDataAsJson.txobjList.map(
        (txObj: { tx: Transaction }, index: number) => {
          const mailTxData = PushMail.deserializeData(
            new Uint8Array(Buffer.from(txObj.tx.data as any, 'base64'))
          );
          // Return the transformed mail object
          return {
            txHash: block.transactions[index].txnHash,
            ts: block.ts,
            subject: mailTxData.subject,
            from: txObj.tx.sender,
            to: (txObj.tx as any).recipientsList,
            body: mailTxData.body,
            attachments: mailTxData.attachments,
            headers: mailTxData.headers,
          };
        }
      );

      // Spread the transformed mails into pushMail array
      pushMail.push(...mails);
    });

    // Return the final email list
    return pushMail;
  };

  /**
   * Get Push Mails By sender
   */
  getBySender = async (
    senderAddress: string,
    startTime: number = Math.floor(Date.now()), // Current Local Time
    direction: 'ASC' | 'DESC' = 'DESC',
    pageSize = 30,
    page = 1
  ): Promise<Email[]> => {
    const res = await this.pushNetwork.tx.getBySender(
      senderAddress,
      startTime,
      direction,
      pageSize,
      page,
      this.TX_CATEGORY
    );

    const pushMail: Email[] = [];
    res.blocks.forEach((block) => {
      // Use map instead of forEach to transform data
      const mails: Email[] = block.blockDataAsJson.txobjList.map(
        (txObj: { tx: Transaction }, index: number) => {
          const mailTxData = PushMail.deserializeData(
            new Uint8Array(Buffer.from(txObj.tx.data as any, 'base64'))
          );
          // Return the transformed mail object
          return {
            txHash: block.transactions[index].txnHash,
            ts: block.ts,
            subject: mailTxData.subject,
            from: txObj.tx.sender,
            to: (txObj.tx as any).recipientsList,
            body: mailTxData.body,
            attachments: mailTxData.attachments,
            headers: mailTxData.headers,
          };
        }
      );

      // Spread the transformed mails into pushMail array
      pushMail.push(...mails);
    });

    // Return the final email list
    return pushMail;
  };

  /**
   * Get Push Mails By recipient
   */
  getByRecipient = async (
    recipientAddress: string,
    startTime: number = Math.floor(Date.now()), // Current Local Time
    direction: 'ASC' | 'DESC' = 'DESC',
    pageSize = 30,
    page = 1
  ): Promise<Email[]> => {
    const res = await this.pushNetwork.tx.getByRecipient(
      recipientAddress,
      startTime,
      direction,
      pageSize,
      page,
      this.TX_CATEGORY
    );
    const pushMail: Email[] = [];
    res.blocks.forEach((block) => {
      // Use map instead of forEach to transform data
      const mails: Email[] = block.blockDataAsJson.txobjList.map(
        (txObj: { tx: Transaction }, index: number) => {
          const mailTxData = PushMail.deserializeData(
            new Uint8Array(Buffer.from(txObj.tx.data as any, 'base64'))
          );
          // Return the transformed mail object
          return {
            txHash: block.transactions[index].txnHash,
            ts: block.ts,
            subject: mailTxData.subject,
            from: txObj.tx.sender,
            to: (txObj.tx as any).recipientsList,
            body: mailTxData.body,
            attachments: mailTxData.attachments,
            headers: mailTxData.headers,
          };
        }
      );

      // Spread the transformed mails into pushMail array
      pushMail.push(...mails);
    });

    // Return the final email list
    return pushMail;
  };

  /**
   * Send Push Mail Tx to Push Network
   * @param sesion Session key and sender details
   * @dev In case session is not passed, fn tries to connect with Push Wallet for signature requests
   * @returns Tx Hash
   */
  send = async (
    subject: string,
    body: EmailBody,
    attachments: Attachment[],
    headers: EmailHeader[],
    to: string[],
    signer: {
      account: string;
      signMessage: (dataToBeSigned: Uint8Array) => Promise<Uint8Array>;
    }
  ): Promise<string> => {
    const serializedData = PushMail.serializeData({
      subject,
      body,
      attachments,
      headers,
    });
    const unsignedTx = this.pushNetwork.tx.createUnsigned(
      this.TX_CATEGORY,
      to,
      serializedData
    );
    return await this.pushNetwork.tx.send(unsignedTx, signer);
  };
}
