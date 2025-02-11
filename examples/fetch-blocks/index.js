// Import Push Chain SDK
import { CONSTANTS, PushChain } from '@pushchain/devnet';

// Initialize the Push Chain SDK
const pushChain = await PushChain.initialize();

// Fetch block by hash
const blockByHash = await pushChain.block.get(
  '28ca25bb8a0b59b76612bcef411984d60f28d0468676fc755ed8f946433d0c64'
);

console.log(blockByHash);

// Fetch the latest 20 blocks
const latestBlocks = await pushChain.block.get('*', {
  limit: 20,
});

console.log(latestBlocks);

// Fetch blocks by dates - yesterday
const blockByData = await pushChain.block.get('*', {
  startTime: Math.floor(Date.now() - 24 * 60 * 60 * 1000),
  order: 'ASC',
});

console.log(blockByData);
