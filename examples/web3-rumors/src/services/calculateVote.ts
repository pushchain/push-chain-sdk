import { PushNetwork, CONSTANTS } from '@pushprotocol/push-chain';
import protobuf from 'protobufjs';
import { Buffer } from 'buffer';

export const calculateVote = async (txHash: string) => {
  try {
    // Initialize PushNetwork class instance
    const userAlice = await PushNetwork.initialize(CONSTANTS.ENV.DEV);

    // Define the schema
    const schema = `
        syntax = "proto3";
  
        message Upvotes {
          int32 upvotes = 1;
          repeated string wallets = 2;
        }
      `;

    // Create a protobuf root and load the schema
    const root = await protobuf.parse(schema).root;

    // Obtain a message type
    const Upvotes = root.lookupType('Upvotes');

    // Fetch transactions
    const txRes = await userAlice.tx.get(
      Math.floor(Date.now()),
      'DESC',
      10,
      1,
      undefined,
      `CUSTOM:${txHash}`
    );

    if (txRes.blocks.length > 0) {
      const binaryData = Buffer.from(
        txRes.blocks[0].blockDataAsJson.txobjList[0].tx.data,
        'base64'
      );

      const decodedData = Upvotes.decode(binaryData);
      const decodedObject = Upvotes.toObject(decodedData, {
        longs: String,
        enums: String,
        bytes: String,
      });

      const upVoteCount = decodedObject.upvotes || 0;
      const wallets = decodedObject.wallets || [];

      return {
        upVoteCount: upVoteCount,
        wallets,
      };
    }

    return { upVoteCount: 0, wallets: [] };
  } catch (error) {
    console.error('Error at calculateVote():', error);
    return { upVoteCount: 0, wallets: [] };
  }
};
