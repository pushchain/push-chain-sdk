import { PushNetwork, CONSTANTS } from '@pushprotocol/push-chain';
import protobuf from 'protobufjs';
import { Buffer } from 'buffer';
import { calculateVote } from './calculateVote';
import { RumorType, ConfessionType } from '@/common';

export const getSentConfessions = async (
  wallet: string,
  page: number,
  pageSize: number
) => {
  try {
    const userAlice = await PushNetwork.initialize(CONSTANTS.ENV.DEV);

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

    const txRes = await userAlice.tx.getBySender(
      wallet,
      Math.floor(Date.now()),
      'DESC',
      pageSize,
      page,
      'CUSTOM:CONFESSION'
    );

    console.log(txRes);

    if (!txRes || txRes.blocks.length === 0) return [];

    for (let i = 0; i < txRes.blocks.length; i++) {
      const block = txRes.blocks[i];
      const { upVoteCount, wallets } = await calculateVote(
        block.transactions[0].txnHash
      );

      const binaryData = Buffer.from(
        block.blockDataAsJson.txobjList[0].tx.data,
        'base64'
      );

      const decodedData = Confession.decode(binaryData);
      const confessionObj = Confession.toObject(decodedData, {
        longs: String,
        enums: String,
        bytes: String,
      });

      confessions.push({
        ...(confessionObj as ConfessionType),
        upVoteCount: upVoteCount,
        markdownPost: (decodedData as any).post,
        txnHash: block.transactions[0].txnHash,
        wallets: wallets,
      });
    }

    return confessions;
  } catch (error) {
    console.error('Error fetching confessions:', error);
    return [];
  }
};
