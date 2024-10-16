import {
  Attachment,
  Email,
  EmailBody,
  EmailHeader,
} from '../generated/txData/email';
import PushNetwork from '@pushprotocol/node-core';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';

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
    account: string,
    startTime: number = Math.floor(Date.now() / 1000), // Current Local Time
    direction: 'ASC' | 'DESC' = 'ASC',
    pageSize = 30,
    page = 1
  ) => {
    const tx = await this.pushNetwork.tx.get(
      startTime,
      direction,
      pageSize,
      page,
      this.TX_CATEGORY
    );
    return tx;
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
