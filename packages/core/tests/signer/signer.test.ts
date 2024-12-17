import { hexToBytes } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { PushChain } from '../../src';
import { CONSTANTS } from '../../src';
import {
  UniversalAccount,
  UniversalSigner,
} from '../../src/lib/signer/signer.types';

describe('Signer Class', () => {
  it('should initialize a Signer instance', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    const universalSigner: UniversalSigner = {
      chain: CONSTANTS.Chain.Ethereum.sepolia.name,
      chainId: CONSTANTS.Chain.Ethereum.sepolia.chainId,
      account: account.address,
      signMessage: async (data: Uint8Array) => {
        const signature = await account.signMessage({
          message: { raw: data },
        });
        return hexToBytes(signature);
      },
    };

    const signer = PushChain.signer.create(universalSigner);
    const pushChain = await PushChain.initialize(signer, {
      network: CONSTANTS.PushChainEnvironment.devnet,
    });

    const recipientAddresses = [
      privateKeyToAccount(generatePrivateKey()).address,
      privateKeyToAccount(generatePrivateKey()).address,
    ];

    const recipients: UniversalAccount[] = [
      {
        chain: CONSTANTS.Chain.Ethereum.sepolia.name,
        chainId: CONSTANTS.Chain.Ethereum.sepolia.chainId,
        account: recipientAddresses[0],
      },
      {
        chain: CONSTANTS.Chain.Ethereum.sepolia.name,
        chainId: CONSTANTS.Chain.Ethereum.sepolia.chainId,
        account: recipientAddresses[1],
      },
    ];

    const txHash = await pushChain.tx.send(recipients, {
      category: 'test-category',
      data: new TextEncoder().encode('Hello world!'),
    });

    expect(typeof txHash).toBe('string');
  });
});
