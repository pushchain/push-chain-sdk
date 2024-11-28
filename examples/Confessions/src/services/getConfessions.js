import { PushNetwork } from "@pushprotocol/push-chain";
import protobuf from "protobufjs";
import { Buffer } from "buffer"; // Import the Buffer polyfill

export const getConfessions = async () => {
  try {
    const userAlice = await PushNetwork.initialize("dev");

    const schema = `
      syntax = "proto3";

      message Confession {
        string post = 1;
        string address = 2;
        int32 upvotes = 3;
        bool isVisible = 4;
      }
    `;

    const root = await protobuf.parse(schema).root;
    const Confession = root.lookupType("Confession");

    const txRes = await userAlice.tx.get(
      Math.floor(Date.now()),
      "DESC",
      10,
      1,
      undefined,
      "CUSTOM:CONFESSION"
    );

    console.log("Raw Data: ", txRes.blocks[0].blockDataAsJson.txobjList[0].tx.data);

    const confessions = [];

    for (let i = 0; i < txRes.blocks.length; i++) {
      const block = txRes.blocks[i];

      const binaryData = Buffer.from(
        block.blockDataAsJson.txobjList[0].tx.data,
        "base64"
      );

      const decodedData = Confession.decode(binaryData);
      const confessionObj = Confession.toObject(decodedData, {
        longs: String,
        enums: String,
        bytes: String,
      });

      // Include the Markdown-compatible post data
      confessions.push({
        ...confessionObj,
        markdownPost: decodedData.post, // Treat `post` as Markdown
      });
    }

    return confessions;
  } catch (error) {
    console.error("Error fetching confessions:", error);
    return [];
  }
};
