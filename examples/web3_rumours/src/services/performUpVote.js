import { PushNetwork } from "@pushprotocol/push-chain";
import protobuf from "protobufjs";
import { ethers, BrowserProvider } from "ethers";

export const performUpVote = async (userAlice, wallet, upVote, txnHash, handleSendSignRequestToPushWallet) => {
  try {
    const schema = `
      syntax = "proto3";

      message Upvotes {
        int32 upvotes = 1;
      }
    `;

    // Create a protobuf root and load the schema
    const root = await protobuf.parse(schema).root;
    const Upvotes = root.lookupType("Upvotes");

    const serializedData = {
      upvotes: upVote + 1,
    };

    // Verify the data against the schema
    const errMsg = Upvotes.verify(serializedData);
    if (errMsg) throw Error(errMsg);

    // Encode the object into a binary format
    const buffer = Upvotes.encode(Upvotes.create(serializedData)).finish();

    // Create an unsigned transaction (keeping the hardcoded recipient address)
    const unsignedTx = userAlice.tx.createUnsigned(
      `CUSTOM:${txnHash}`,
      ["eip155:1:0xC9C52B3717A8Dfaacd0D33Ce14a916C575eE332A"], // acc 63
      buffer
    );

    console.log("🛠️🛠️PUSH wallet address: ", wallet);

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

      txHash = await userAlice.tx.send(unsignedTx, signer);
      console.log("🪙🪙Upvote Transaction Hash:", txHash);
    }

    return true;
  } catch (error) {
    console.error("Error in performUpVote:", error);
    throw error;
  }
};