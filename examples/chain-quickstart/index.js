// Import required modules
import { PushChain, CONSTANTS } from '@pushchain/devnet';
import { hexToBytes } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

// ====================================================================
// Initialize Push Chain SDK without a signer. This is used for *read-only* operations.
// ====================================================================
const pushChainReadOnly = await PushChain.initialize();
console.log(
  'Initialized PushChain in read-only mode. Fetching the latest transaction:'
);
console.log(await pushChainReadOnly.tx.get('*', { limit: 1 }));

// ====================================================================
// Initialize Push Chain SDK with a signer. This is used for *read-write* operations.
// ====================================================================

// Generate Private Key
const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

const signer = {
  chain: CONSTANTS.CHAIN.ETHEREUM,
  chainId: CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA,
  address: account.address, // Ethereum address derived from the private key
  signMessage: async (data) => {
    const signature = await account.signMessage({
      message: { raw: data }, // Data to be signed
    });
    return hexToBytes(signature); // Convert signature to a byte array
  },
};

// Initialize the SDK with the Signer
const pushChainReadWrite = await PushChain.initialize(signer);
console.log('Initialized PushChain with a signer for read-write operations.');
console.log('Signer details:', {
  chain: signer.chain,
  chainId: signer.chainId,
  address: signer.address,
});

const tx = await pushChainReadWrite.tx.send(
  [
    {
      chain: CONSTANTS.CHAIN.SOLANA,
      chainId: CONSTANTS.CHAIN_ID.SOLANA.DEVNET,
      account: 'ySYrGNLLJSK9hvGGpoxg8TzWfRe8ftBtDSMECtx2eJR',
    },
  ],
  {
    category: 'MY_CUSTOM_CATEGORY',
    data: 'Hi!',
  }
);

console.log('Transaction sent successfully! Transaction hash:', tx.txHash);
