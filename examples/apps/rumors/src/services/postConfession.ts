import { ConfessionType } from '@/common';
import { PushChain } from '@pushchain/devnet';
import protobuf from 'protobufjs';

export const postConfession = async (
  pushChain: PushChain,
  confessionDetails: ConfessionType,
) => {
  try {
    // Define the schema
    const schema = `
      syntax = "proto3";

      message Confession {
        string post = 1;
        string address = 2;
        bool isVisible = 4;
        string timestamp = 5;
      }
    `;

    // Create a protobuf root and load the schema
    const root = await protobuf.parse(schema).root;

    // Obtain a message type
    const Confession = root.lookupType('Confession');

    // Verify the data against the schema
    const errMsg = Confession.verify(confessionDetails);
    if (errMsg) throw Error(errMsg);

    // Encode the object into a binary format
    const buffer = Confession.encode(
      Confession.create(confessionDetails)
    ).finish();
    console.log('Binary Encoded data:', buffer);

    const txRes = await pushChain.tx.send([
      PushChain.utils.account.toUniversal('eip155:1:0xC9C52B3717A8Dfaacd0D33Ce14a916C575eE332A')
    ], {
      category: 'CUSTOM:RUMORS',
      data: Buffer.from(buffer).toString('hex'),
    });

    console.log('🪙🪙Push Wallet Transaction: ', txRes);

    return txRes.txHash;
  } catch (error) {
    console.error('Error in postConfession:', error);
    throw error; // Re-throw the error to handle it in the component
  }
};
