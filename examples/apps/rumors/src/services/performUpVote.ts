import { PushChain } from '@pushchain/devnet';
import protobuf from 'protobufjs';

export const performUpVote = async (
  pushChain: PushChain,
  wallet: string,
  txnHash: string,
  existingWallets: string[],
  downvoteWallets: string[],
) => {
  try {
    const schema = `
      syntax = "proto3";

      message Upvotes {
        repeated string wallets = 2;
        repeated string downvoteWallets = 3;
      }
    `;

    // Create a protobuf root and load the schema
    const root = await protobuf.parse(schema).root;
    const Upvotes = root.lookupType('Upvotes');

    let updatedWallets: string[];

    if (existingWallets.includes(wallet)) {
      updatedWallets = existingWallets.filter((w) => w !== wallet);
    } else {
      updatedWallets = [...existingWallets, wallet];
    }

    const serializedData = {
      wallets: updatedWallets,
      downvoteWallets: downvoteWallets.filter((w) => w !== wallet),
    };

    // Verify the data against the schema
    const errMsg = Upvotes.verify(serializedData);
    if (errMsg) throw Error(errMsg);

    // Encode the object into a binary format
    const buffer = Upvotes.encode(Upvotes.create(serializedData)).finish();

    // Create an unsigned transaction (keeping the hardcoded recipient address)
    const txHash = await pushChain.tx.send([
      PushChain.utils.account.toUniversal('eip155:1:0xC9C52B3717A8Dfaacd0D33Ce14a916C575eE332A')
    ], {
      category: `RUMORS:${txnHash}`,
      data: Buffer.from(buffer).toString('hex'),
    });

    console.log('🪙🪙Push Wallet Transaction: ', txHash);

    return true;
  } catch (error) {
    console.error('Error in performUpVote:', error);
    throw error;
  }
};
