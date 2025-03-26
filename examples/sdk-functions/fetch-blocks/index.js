// Import Push Chain SDK
import { CONSTANTS, PushChain } from '@pushchain/devnet';

// Initialize the Push Chain SDK
const pushChain = await PushChain.initialize();
console.log('PushChain SDK initialized successfully for block operations.');

// Fetch block by hash
const blockHash =
  '28ca25bb8a0b59b76612bcef411984d60f28d0468676fc755ed8f946433d0c64';
const blockByHash = await pushChain.block.get(blockHash);
console.log(`Fetched block by hash (${blockHash}):`, blockByHash);

// Fetch the latest 5 blocks
const latestBlocks = await pushChain.block.get('*', {
  limit: 5,
});
console.log('Fetched the latest 20 blocks:', latestBlocks);

// Fetch blocks by dates - yesterday
const startTime = Math.floor(Date.now() - 24 * 60 * 60 * 1000);
const blockByDate = await pushChain.block.get('*', {
  startTime: startTime,
  order: 'ASC',
});
console.log(
  `Fetched blocks from yesterday (starting at ${new Date(
    startTime
  ).toISOString()}):`,
  blockByDate
);
