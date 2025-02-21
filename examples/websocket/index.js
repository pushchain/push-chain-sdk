import { PushChain } from '@pushchain/devnet';

const pushChain = await PushChain.initialize();

// Connect to the WebSocket server
await pushChain.ws.connect();
console.log('WebSocket connected.');

// Define a custom filter to only subscribe to blocks that include transactions with the category 'CUSTOM:SAMPLE_TX'
const customFilters = [{ type: 'CATEGORY', value: ['CUSTOM:SAMPLE_TX'] }];

// Subscribe to block updates using the custom filter
await pushChain.ws.subscribe(async (block) => {
  console.log('New block received:', block.blockHash);

  // Iterate over each transaction in the block
  for (const tx of block.transactions) {
    // Check if the transaction category matches our filter
    if (tx.category === 'CUSTOM:SAMPLE_TX') {
      console.log(
        `Found transaction with hash ${tx.hash} and category ${tx.category}`
      );

      try {
        // Fetch the full transaction details using the transaction hash
        const txDetails = await pushChain.tx.get(tx.hash);

        // Assume the fetched result contains a list of blocks and each block contains an array of transactions
        if (txDetails.blocks && txDetails.blocks.length > 0) {
          const fetchedTx = txDetails.blocks[0].transactions[0];
          // Log the transaction data from the fetched transaction details
          console.log('Transaction Data:', fetchedTx.data);
        } else {
          console.log(`No details found for transaction hash ${tx.hash}`);
        }
      } catch (error) {
        console.error('Error fetching transaction details:', error);
      }
    }
  }
}, customFilters);
