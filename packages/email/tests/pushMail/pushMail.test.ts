import PushMail from '../../src';
import {
  EmailBody,
  EmailHeader,
  Attachment,
} from '../../src/lib/generated/txData/email';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hexToBytes } from 'viem';
import { Address } from '@pushprotocol/node-core';

describe('PushMail Integration Tests', () => {
  let pushMail: PushMail;

  beforeAll(async () => {
    pushMail = await PushMail.initialize(ENV.DEV);
  });

  describe('initialize', () => {
    it('should initialize PushMail with the default environment', async () => {
      expect(pushMail).toBeInstanceOf(PushMail);
    });
  });

  describe('serializeData and deserializeData', () => {
    it('should correctly serialize and deserialize Email data', () => {
      const emailData = {
        subject: 'Test Email',
        body: {
          content: 'Hello World',
          format: 0, // Assuming BodyFormat 0 for plain text
        },
        attachments: [],
        headers: [],
      };

      const serializedData = (PushMail as any).serializeData(emailData);
      expect(serializedData).toBeInstanceOf(Uint8Array);

      const deserializedData = (PushMail as any).deserializeData(
        serializedData
      );
      expect(deserializedData.subject).toEqual(emailData.subject);
      expect(deserializedData.body?.content).toEqual(emailData.body?.content);
    });
  });

  describe('get', () => {
    it('should retrieve transactions from PushNetwork', async () => {
      const startTime = Math.floor(Date.now() / 1000); // current time in seconds
      const direction = 'ASC';
      const pageSize = 30;
      const page = 1;

      const res = await pushMail.get('', startTime, direction, pageSize, page);

      // Assuming that the test environment might have data, adjust this assertion accordingly
      expect(res).toBeDefined();
      res.blocks.forEach((block) => {
        console.log(block.transactions);
      });
    });
  });

  describe('send', () => {
    it('should send an email and return a transaction hash', async () => {
      const subject = 'Integration Test Email';
      const body: EmailBody = {
        content: 'This is a test email body',
        format: 0, // Assuming BodyFormat 0 for plain text
      };
      const attachments: Attachment[] = [
        { filename: 'test.txt', type: 'text/plain', content: 'base64content' },
      ];
      const headers: EmailHeader[] = [{ key: 'Priority', value: 'High' }];
      const to = [
        `eip155:1:0xD8634C39BBFd4033c0d3289C4515275102423681`,
        `eip155:137:0x605b930c2E3EF55B93f530ac5bF22D68e5D4ED42`,
      ];

      const pk = generatePrivateKey();
      const account = privateKeyToAccount(pk);
      const signer = {
        account: Address.toPushCAIP(account.address, ENV.DEV),
        signMessage: async (data: Uint8Array) => {
          const signature = await account.signMessage({
            message: { raw: data },
          });
          return hexToBytes(signature);
        },
      };

      const txHash = await pushMail.send(
        subject,
        body,
        attachments,
        headers,
        to,
        signer
      );
      expect(typeof txHash).toEqual('string');
    });
  });
});
