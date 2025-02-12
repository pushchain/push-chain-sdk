import { PushChain } from '../../src';
import { Block } from '../../src/lib/block/block';
import { config } from '../config';
import { Block as BlockType } from '../../src/lib/generated/block';
import { BlockType as SimplifiedNodeBlockType } from '../../src/lib/block/block.types';

describe('Block Class', () => {
  const env = config.ENV;

  const sampleBlock: BlockType = {
    ts: Date.now(),
    txObj: [],
    signers: [],
    attestToken: new Uint8Array([1, 2, 3, 4]),
  };

  const blockChecker = (block: SimplifiedNodeBlockType) => {
    expect(block).toHaveProperty('blockHash');
    expect(block).toHaveProperty('timestamp');
    expect(block).toHaveProperty('transactions');
    expect(block).toHaveProperty('totalNumberOfTxns');
  };

  it('should initialize a Block instance', async () => {
    const pushChain = await PushChain.initialize(null, { network: env });
    expect(pushChain.block).toBeInstanceOf(Block);
  });

  it('should serialize a BlockType object into a Uint8Array', () => {
    const serializedBlock = PushChain.utils.block.serialize(sampleBlock);
    expect(serializedBlock).toBeInstanceOf(Uint8Array);
    expect(serializedBlock.length).toBeGreaterThan(0);
  });

  it('should deserialize a Uint8Array into a BlockType object', () => {
    const serializedBlock = PushChain.utils.block.serialize(sampleBlock);
    const deserializedBlock =
      PushChain.utils.block.deserialize(serializedBlock);
    expect(deserializedBlock).toEqual(sampleBlock);
  });

  it('should get blocks with default parameters', async () => {
    const pushChain = await PushChain.initialize(null, { network: env });
    const res = await pushChain.block.get();
    expect(res.blocks).toBeInstanceOf(Array);
    res.blocks.forEach((block) => {
      blockChecker(block);
    });
  });

  it('should get blocks with custom parameters', async () => {
    const pushChain = await PushChain.initialize(null, { network: env });
    const res = await pushChain.block.get();
    expect(res.blocks).toBeInstanceOf(Array);
    res.blocks.forEach((block) => {
      blockChecker(block);
    });
  });

  it('should search for a block by hash', async () => {
    const pushChain = await PushChain.initialize(null, { network: env });
    const res = await pushChain.block.get();
    const blockHash = res.blocks[0].blockHash;
    const searchRes = await pushChain.block.get(blockHash);
    expect(searchRes.blocks).toBeInstanceOf(Array);
    expect(searchRes.blocks.length).toEqual(1);
    res.blocks.forEach((block) => {
      blockChecker(block);
    });
  });
});
