import { PushNetwork } from '@pushprotocol/push-chain';
import protobuf from 'protobufjs';

export const performDownVote = async (
  userAlice: PushNetwork,
  wallet: string,
  txnHash: string,
  upvoteWallets: string[],
  existingWallets: string[],
  handleSendSignRequestToPushWallet: (data: Uint8Array) => Promise<Uint8Array>
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
      wallets: upvoteWallets.filter((w) => w !== wallet),
      downvoteWallets: updatedWallets,
    };

    // Verify the data against the schema
    const errMsg = Upvotes.verify(serializedData);
    if (errMsg) throw Error(errMsg);

    // Encode the object into a binary format
    const buffer = Upvotes.encode(Upvotes.create(serializedData)).finish();

    // Create an unsigned transaction (keeping the hardcoded recipient address)
    const unsignedTx = userAlice.tx.createUnsigned(
      `CUSTOM:${txnHash}`,
      ['eip155:1:0xC9C52B3717A8Dfaacd0D33Ce14a916C575eE332A'], // acc 63
      buffer
    );

    console.log('🛠️🛠️PUSH wallet address: ', wallet);

    const signer = {
      account: wallet,
      signMessage: async (data: Uint8Array) => {
        try {
          return await handleSendSignRequestToPushWallet(new Uint8Array(data));
        } catch (error) {
          console.error('Error signing with Push Wallet:', error);
          throw error;
        }
      },
    };

    const txHash = await userAlice.tx.send(unsignedTx, signer);
    console.log('🪙🪙Push Wallet Transaction: ', txHash);

    return true;
  } catch (error) {
    console.error('Error in performUpVote:', error);
    throw error;
  }
};
