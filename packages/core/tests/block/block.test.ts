import { Block } from '../../src';
import { config } from '../config';
import { Block as BlockType } from '../../src/lib/generated/block';
import { BlockType as NodeBlockType } from '../../src/lib/block/block.types';

describe('Block Class', () => {
  const env = config.ENV;

  const sampleBlock: BlockType = {
    ts: Date.now(),
    txObj: [],
    signers: [],
    attestToken: new Uint8Array([1, 2, 3, 4]),
  };

  const blockChecker = (block: NodeBlockType) => {
    expect(block).toHaveProperty('blockHash');
    expect(block).toHaveProperty('blockData');
    expect(block).toHaveProperty('blockDataAsJson');
    expect(block).toHaveProperty('blockSize');
    expect(block).toHaveProperty('ts');
    expect(block).toHaveProperty('transactions');
    expect(block).toHaveProperty('totalNumberOfTxns');
  };

  it('should initialize a Block instance', async () => {
    const blockInstance = await Block.initialize(env);
    expect(blockInstance).toBeInstanceOf(Block);
  });

  it('should serialize a BlockType object into a Uint8Array', () => {
    const serializedBlock = Block.serialize(sampleBlock);
    expect(serializedBlock).toBeInstanceOf(Uint8Array);
    expect(serializedBlock.length).toBeGreaterThan(0);
  });

  it('should deserialize a Uint8Array into a BlockType object', () => {
    const serializedBlock = Block.serialize(sampleBlock);
    const deserializedBlock = Block.deserialize(serializedBlock);
    expect(deserializedBlock).toEqual(sampleBlock);
  });

  it('should get blocks with default parameters', async () => {
    const blockInstance = await Block.initialize(env);
    const res = await blockInstance.get();
    expect(res.blocks).toBeInstanceOf(Array);
    res.blocks.forEach((block) => {
      blockChecker(block);
    });
  });

  it('should get blocks with custom parameters', async () => {
    const blockInstance = await Block.initialize(env);
    const res = await blockInstance.get(
      Math.floor(Date.now() / 1000),
      'DESC',
      true,
      10,
      2
    );
    expect(res.blocks).toBeInstanceOf(Array);
    res.blocks.forEach((block) => {
      blockChecker(block);
    });
  });

  it('should search for a block by hash', async () => {
    const blockInstance = await Block.initialize(env);
    const res = await blockInstance.get();
    const blockHash = res.blocks[0].blockHash;
    const searchRes = await blockInstance.search(blockHash);
    expect(searchRes.blocks).toBeInstanceOf(Array);
    expect(searchRes.blocks.length).toEqual(1);
    res.blocks.forEach((block) => {
      blockChecker(block);
    });
  });
});
