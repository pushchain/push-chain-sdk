import { PushNetwork } from "@pushprotocol/push-chain";
import protobuf from "protobufjs";
import { ethers, BrowserProvider } from "ethers";

export const postConfession = async (userAlice, wallet, confessionDetails, handleSendSignRequestToPushWallet) => {
  try {
    // Define the schema
    const schema = `
      syntax = "proto3";

      message Confession {
        string post = 1;
        string address = 2;
        int32 upvotes = 3;
        bool isVisible = 4;
      }
    `;

    // Create a protobuf root and load the schema
    const root = await protobuf.parse(schema).root;

    // Obtain a message type
    const Confession = root.lookupType("Confession");

    // Verify the data against the schema
    const errMsg = Confession.verify(confessionDetails);
    if (errMsg) throw Error(errMsg);

    // Encode the object into a binary format
    const buffer = Confession.encode(
      Confession.create(confessionDetails)
    ).finish();
    console.log("Binary Encoded data:", buffer);

    // Create an unsigned transaction
    const unsignedTx = userAlice.tx.createUnsigned(
      "CUSTOM:CONFESSION",
      ["eip155:1:0xC9C52B3717A8Dfaacd0D33Ce14a916C575eE332A"], // acc 63
      buffer
    );
    console.log("Unsigned Transaction:", unsignedTx);

    let txHash;

    // Handle Push Wallet case
    if (typeof wallet === 'string' && handleSendSignRequestToPushWallet) {
      const signer = {
        account: wallet,
        signMessage: async (data) => {
          try {
            return await handleSendSignRequestToPushWallet(new Uint8Array(data));
          } catch (error) {
            console.error("Error signing with Push Wallet:", error);
            throw error;
          }
        },
      };

      txHash = await userAlice.tx.send(unsignedTx, signer);
      console.log("🪙🪙Push Wallet Transaction: ", txHash);
    }
    // Handle regular wallet case (string without Push Wallet)
    else if (typeof wallet === 'string') {
      txHash = await userAlice.tx.send(unsignedTx, {
        account: wallet,
        signMessage: async (data) => {
          return await userAlice.wallet.sign(data);
        },
      });

      console.log("🪙🪙Push Transaction: ", txHash);
    }
    // Handle Metamask case
    else {
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
      txHash = await userAlice.tx.send(unsignedTx, signer);
      console.log("Confession Transaction Hash:", txHash);
    }

    return txHash;
  } catch (error) {
    console.error("Error in postConfession:", error);
    throw error;  // Re-throw the error to handle it in the component
  }
};