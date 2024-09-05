import { Block } from '../../src';
import { config } from '../config';
import { Block as BlockType } from '../../src/lib/generated/block';

describe('Block Class', () => {
  const env = config.ENV;

  // TODO : @Shoaib to add a valid sample block data
  const sampleBlock: BlockType = {
    ts: Date.now(),
    txObj: [],
    signers: [],
    attestToken: new Uint8Array([1, 2, 3, 4]),
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
    const blocks = await blockInstance.get();
    expect(blocks).toBeInstanceOf(Array);
    if (blocks.length > 0) {
      expect(blocks[0]).toHaveProperty('ts');
      expect(blocks[0]).toHaveProperty('txObj');
      expect(blocks[0]).toHaveProperty('signers');
    }
  });

  it('should get blocks with custom parameters', async () => {
    const blockInstance = await Block.initialize(env);
    const blocks = await blockInstance.get(
      Math.floor(Date.now() / 1000),
      'DESC',
      true,
      10,
      2
    );
    expect(blocks).toBeInstanceOf(Array);
    if (blocks.length > 0) {
      expect(blocks[0]).toHaveProperty('ts');
      expect(blocks[0]).toHaveProperty('txObj');
      expect(blocks[0]).toHaveProperty('signers');
    }
  });

  it('should search for a block by hash', async () => {
    const blockInstance = await Block.initialize(env);
    const blockHash = 'sample-block-hash';
    const block = await blockInstance.search(blockHash);
    expect(block).toBeInstanceOf(Object);
    expect(block).toHaveProperty('ts');
    expect(block).toHaveProperty('txObj');
    expect(block).toHaveProperty('signers');
  });
});
