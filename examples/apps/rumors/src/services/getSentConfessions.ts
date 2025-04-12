import protobuf from 'protobufjs';
import { Buffer } from 'buffer';
import { calculateVote } from './calculateVote';
import { RumorType, ConfessionType } from '@/common';
import { PushChain, UniversalAccount } from '@pushchain/devnet';
import { ORDER } from '@pushchain/devnet/src/lib/constants';

export const getSentConfessions = async (
  pushChain: PushChain,
  universalAddress: UniversalAccount,
  page: number,
  pageSize: number
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

    const confessions: RumorType[] = [];

    const txRes = await pushChain.tx.get(universalAddress, {
      category: 'CUSTOM:RUMORS',
      startTime: Math.floor(Date.now()),
      order: ORDER.DESC,
      page: page,
      limit: pageSize,
      filterMode: 'sender',
    });

    console.log(txRes);

    if (!txRes || txRes.blocks.length === 0) return [];

    for (let i = 0; i < txRes.blocks.length; i++) {
      const block = txRes.blocks[i];
      const { upvoteWallets, downvoteWallets } = await calculateVote(
        pushChain,
        block.transactions[0].hash
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
  
        confessions.push({
          ...(confessionObj as ConfessionType),
          markdownPost: (decodedData as any).post,
          txnHash: block.transactions[0].hash,
          upvoteWallets: upvoteWallets,
          downvoteWallets: downvoteWallets,
        });
      } catch (err) {
        console.log(err);
      }
    }

    return confessions;
  } catch (error) {
    console.error('Error fetching confessions:', error);
    return [];
  }
};
