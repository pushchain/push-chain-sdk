import { PushNetwork } from "@pushprotocol/push-chain";
import protobuf from "protobufjs";
import { Buffer } from "buffer"; // Import the Buffer polyfill
import { calculateVote } from "./calculateVote";

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

    const confessions = [];
    let currentPage = 1;
    const pageSize = 10;

    while (confessions.length < 25) {
      const txRes = await userAlice.tx.get(
        Math.floor(Date.now()),
        "DESC",
        pageSize,
        currentPage,
        undefined,
        "CUSTOM:CONFESSION"
      );

      console.log(txRes);

      if (!txRes || txRes.blocks.length === 0) break;

      for (let i = 0; i < txRes.blocks.length; i++) {
        const block = txRes.blocks[i];
        const upVoteCount = await calculateVote(block.transactions[0].txnHash);

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

        confessions.push({
          ...confessionObj,
          upVoteCount: upVoteCount,
          markdownPost: decodedData.post, // Treat `post` as Markdown
          txnHash: block.transactions[0].txnHash,
        });
      }

      currentPage++;
    }

    // Sort confessions by upvotes in descending order
    return confessions.sort((a, b) => b.upVoteCount - a.upVoteCount);
  } catch (error) {
    console.error("Error fetching confessions:", error);
    return [];
  }
};
