// Import Push Chain SDK
import { CONSTANTS, PushChain } from '@pushchain/devnet';

// Initialize the Push Chain SDK
const pushChain = await PushChain.initialize();
console.log('PushChain SDK initialized successfully.');

const categoryName = "CUSTOM:RUMORS";
var pageCount = 1;
const limitCount = 30;

console.log(`Fetching ${categoryName}...`)

var totalTxInCategory = 0;
var prevTxInCategory = -1;

while(prevTxInCategory != totalTxInCategory) {
  prevTxInCategory = totalTxInCategory;

  console.log(`Fetching ${categoryName}...`);

  const txByCategory = await pushChain.tx.get('*', {
    category: categoryName,
    page: pageCount,
    limit: limitCount
  });

  // Log each block and its transaction count
  txByCategory.blocks.forEach(block => {
    console.log(`Block ${block.blockHash}: ${block.totalNumberOfTxns} transaction(s)`);
    totalTxInCategory += block.totalNumberOfTxns;
  });

  console.log(`\nPage ${pageCount} summary:`);
  console.log(`Number of blocks in this page: ${txByCategory.blocks.length}`);
  console.log(`Total transactions so far: ${totalTxInCategory}\n`);

  pageCount++;
}
