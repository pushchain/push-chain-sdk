import protobuf from 'protobufjs';
import { Buffer } from 'buffer';
import { PushChain } from '@pushchain/devnet';
import { ORDER } from '@pushchain/devnet/src/lib/constants';

export const calculateVote = async (
  pushChain: PushChain,
  txHash: string
) => {
  try {
    // Define the schema
    const schema = `
        syntax = "proto3";
  
        message Upvotes {
          repeated string wallets = 2;
          repeated string downvoteWallets = 3;
        }
      `;

    // Create a protobuf root and load the schema
    const root = await protobuf.parse(schema).root;

    // Obtain a message type
    const Upvotes = root.lookupType('Upvotes');

    // Fetch transactions
    const txRes = await pushChain.tx.get('*', {
      raw: true,
      category: `RUMORS:${txHash}`,
      startTime: Math.floor(Date.now()),
      order: ORDER.DESC,
      page: 1,
      limit: 1,
    });

    if (txRes.blocks.length > 0) {

      try {
        const dataBytes = new Uint8Array(
          Buffer.from(txRes.blocks[0].transactions[0].data, "hex")
        );
  
        const decodedData = Upvotes.decode(dataBytes);
        const decodedObject = Upvotes.toObject(decodedData, {
          longs: String,
          enums: String,
          bytes: String,
        });
  
        const upvoteWallets = decodedObject.wallets || [];
        const downvoteWallets = decodedObject.downvoteWallets || [];
  
        return {
          upvoteWallets,
          downvoteWallets,
        };
      } catch (err) {
        console.log(err);
      }
    }

    return { upvoteWallets: [], downvoteWallets: [] };
  } catch (error) {
    console.error('Error at calculateVote():', error);
    return { upvoteWallets: [], downvoteWallets: [] };
  }
};
