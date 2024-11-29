import { PushNetwork } from "@pushprotocol/push-chain";

import protobuf from "protobufjs";

import { ethers, BrowserProvider } from "ethers";

export const performUpVote = async (wallet, upVote, txnHash) => {
  try {
    // Initialize PushNetwork class instance
    const userAlice = await PushNetwork.initialize("dev");

    // Define the schema
    const schema = `
          syntax = "proto3";
    
          message Upvotes {
            int32 upvotes = 1;
          }
        `;

    // Create a protobuf root and load the schema
    const root = await protobuf.parse(schema).root;

    // Obtain a message type
    const Upvotes = root.lookupType("Upvotes");

    const serializedData = {
      upvotes: upVote + 1,
    };

    // Verify the data against the schema
    const errMsg = Upvotes.verify(serializedData);
    if (errMsg) throw Error(errMsg);

    // Encode the object into a binary format
    const buffer = Upvotes.encode(Upvotes.create(serializedData)).finish();

    // Create an unsigned transaction
    const unsignedTx = userAlice.tx.createUnsigned(
      `CUSTOM:${txnHash}`,
      ["eip155:1:0xC9C52B3717A8Dfaacd0D33Ce14a916C575eE332A"], // acc 63
      buffer
    );

    // Initialize BrowserProvider for the wallet provider
    const provider = new BrowserProvider(wallet.provider);
    const metamaskSigner = await provider.getSigner();

    const normalizedAddress = ethers.getAddress(wallet.accounts[0]?.address);
    const address = `eip155:1:${normalizedAddress}`;

    const signer = {
      account: address,
      signMessage: async (data) => {
        const signature = await metamaskSigner.signMessage(data);
        return ethers.getBytes(signature);
      },
    };

    // Send a transaction
    const txHash = await userAlice.tx.send(unsignedTx, signer);
    console.log("Upvote Transaction Hash:", txHash);

    return true;
  } catch (error) {
    console.log(error);
  }
};
