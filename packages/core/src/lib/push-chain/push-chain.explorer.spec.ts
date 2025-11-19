import { createWalletClient, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { PushChain } from './push-chain';
import { CHAIN_INFO } from '../constants/chain';
import { CHAIN } from '../constants/enums';

describe('Explorer Namespace', () => {
  it('should get transaction url', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      transport: http(
        CHAIN_INFO[PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]
      ),
    });
    const signer = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient,
      {
        chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );
    const pushChainClient = await PushChain.initialize(signer, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    });

    const txHash = '0x123';
    const url = pushChainClient.explorer.getTransactionUrl(txHash);
    expect(url).toBe(`https://donut.push.network/tx/${txHash}`);
  });

  it('should list default block explorer URLs', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      transport: http(
        CHAIN_INFO[PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]
      ),
    });
    const signer = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient,
      {
        chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );
    const pushChainClient = await PushChain.initialize(signer, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    });

    const { urls } = pushChainClient.explorer.listUrls();
    expect(Array.isArray(urls)).toBe(true);
    expect(urls).toContain('https://donut.push.network');
    expect(urls.length).toBeGreaterThan(0);
  });

  it('should list custom block explorer URLs when provided', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      transport: http(
        CHAIN_INFO[PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]
      ),
    });
    const signer = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient,
      {
        chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );

    const customBlockExplorers = {
      [CHAIN.PUSH_TESTNET_DONUT]: [
        'https://custom-explorer1.push.network',
        'https://custom-explorer2.push.network',
      ],
    };

    const pushChainClient = await PushChain.initialize(signer, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      blockExplorers: customBlockExplorers,
    });

    const { urls } = pushChainClient.explorer.listUrls();
    expect(Array.isArray(urls)).toBe(true);
    expect(urls).toEqual([
      'https://custom-explorer1.push.network',
      'https://custom-explorer2.push.network',
    ]);
    expect(urls.length).toBe(2);
  });

  it('should handle multiple chains with different block explorer configurations', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      transport: http(
        CHAIN_INFO[PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]
      ),
    });
    const signer = await PushChain.utils.signer.toUniversalFromKeypair(
      walletClient,
      {
        chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );

    const multiChainBlockExplorers = {
      [CHAIN.PUSH_TESTNET_DONUT]: ['https://donut-explorer.push.network'],
      [CHAIN.ETHEREUM_SEPOLIA]: ['https://sepolia.etherscan.io'],
      [CHAIN.ARBITRUM_SEPOLIA]: ['https://sepolia.arbiscan.io'],
      [CHAIN.BASE_SEPOLIA]: ['https://sepolia.basescan.org'],
      [CHAIN.SOLANA_DEVNET]: ['https://explorer.solana.com'],
    };

    const pushChainClient = await PushChain.initialize(signer, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      blockExplorers: multiChainBlockExplorers,
    });

    const { urls } = pushChainClient.explorer.listUrls();
    expect(Array.isArray(urls)).toBe(true);
    expect(urls).toEqual(['https://donut-explorer.push.network']);
    expect(urls.length).toBe(1);
  });
});
