// Import Push Chain SDK
import { CONSTANTS, PushChain } from '@pushchain/devnet';
// Import utility functions from viem
import { hexToBytes } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

// Generate Private Key
const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

// Create signer. This is the signer that will be used to sign the transaction.
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

// Initialize Push Chain SDK
const pushChain = await PushChain.initialize(signer);
console.log('PushChain SDK initialized.');

// Send Transaction
const tx = await pushChain.tx.send(
  [
    {
      chain: CONSTANTS.CHAIN.SOLANA,
      chainId: CONSTANTS.CHAIN_ID.SOLANA.DEVNET,
      account: 'ySYrGNLLJSK9hvGGpoxg8TzWfRe8ftBtDSMECtx2eJR',
    },
  ],
  {
    category: 'MY_CUSTOM_CATEGORY',
    data: JSON.stringify({
      title: 'Hello old friend from Solana!',
      message: 'Greetings from Ethereum world.',
    }),
  }
);

console.log('Transaction sent successfully! Transaction hash:', tx.txHash);
