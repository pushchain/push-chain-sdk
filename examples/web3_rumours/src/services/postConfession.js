import { PushNetwork } from "@pushprotocol/push-chain";

import protobuf from "protobufjs";

import { ethers, BrowserProvider } from "ethers";

/* ConfessionDetails demo data
  const serializedData = {
    post: "Post details",
    address: "0xabc...123",
    upvotes: 20,
    isVisible: true,
  };
*/

export const postConfession = async (wallet, confessionDetails) => {
  try {
    // Initialize PushNetwork class instance
    const userAlice = await PushNetwork.initialize("dev");

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

    // Initialize BrowserProvider for the wallet provider
    const provider = new BrowserProvider(wallet.provider);
    const metamaskSigner = await provider.getSigner();

    // const pk = "0xafcd280386cd585959b642d9e5aefa86890c0af0b1eec0ff4fd0fe4884f3e6d9";
    // const address = "eip155:1:0x76F1AE0d7E6bB39bFE4784627D3575c7397ad6eA";
    const normalizedAddress = ethers.getAddress(
      wallet.accounts[0]?.address
    );
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
    console.log("Confession Transaction Hash:", txHash);
  } catch (error) {
    console.error(error);
  }
};
