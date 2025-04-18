import protobuf from 'protobufjs';
import { Buffer } from 'buffer';
import { calculateVote } from './calculateVote';
import { RumorType, ConfessionType } from '@/common';
import { PushChain } from '@pushchain/devnet';

export const getSingleConfession = async (
  pushChain: PushChain,
  txnHash: string,
) => {
  try {
    const schema = `
      syntax = "proto3";

      message Confession {
        string post = 1;
        string address = 2;
        bool isVisible = 4;
        string timestamp = 5;
      }
    `;

    const root = await protobuf.parse(schema).root;
    const Confession = root.lookupType('Confession');

    let confession: RumorType | null = null;

    const txRes = await pushChain.tx.get(txnHash);

    console.log(txRes);

    if (!txRes || txRes.blocks.length === 0) return null;

    const block = txRes.blocks[0];
    const { upvoteWallets, downvoteWallets } = await calculateVote(
        pushChain,
        block.transactions[0].timestamp.toString(),
    );

    try {
        const dataBytes = new Uint8Array(
            Buffer.from(block.transactions[0].data, "hex")
        );

        const decodedData = Confession.decode(dataBytes);
        const confessionObj = Confession.toObject(decodedData, {
            longs: String,
            enums: String,
            bytes: String,
        });

        confession = {
            ...(confessionObj as ConfessionType),
            markdownPost: (decodedData as any).post,
            txnHash: block.transactions[0].hash,
            upvoteWallets: upvoteWallets,
            downvoteWallets: downvoteWallets,
            timestamp: block.transactions[0].timestamp.toString(),
        };
    } catch (err) {
        console.log(err);
    }

    return confession;
  } catch (error) {
    console.error('Error fetching confessions:', error);
    return null;
  }
};
