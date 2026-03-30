import { createWalletClient, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { PushChain } from './push-chain';
import { CHAIN_INFO } from '../constants/chain';
import { CHAIN } from '../constants/enums';

/** Helper: create a PushChain client with optional blockExplorers override */
async function createClient(blockExplorers?: Partial<Record<CHAIN, string[]>>) {
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
  return PushChain.initialize(signer, {
    network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    ...(blockExplorers ? { blockExplorers } : {}),
  });
}

describe('Explorer Namespace', () => {
  // ── getTransactionUrl ──────────────────────────────────────────────

  it('should get transaction url (default Push Chain)', async () => {
    const pushChainClient = await createClient();
    const txHash = '0x123';
    const url = pushChainClient.explorer.getTransactionUrl(txHash);
    expect(url).toBe(`https://donut.push.network/tx/${txHash}`);
  });

  it('should get transaction url for a specific chain via options.chain', async () => {
    const pushChainClient = await createClient();
    const txHash = '0xabc';

    const ethUrl = pushChainClient.explorer.getTransactionUrl(txHash, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
    });
    expect(ethUrl).toBe(`https://sepolia.etherscan.io/tx/${txHash}`);

    const bnbUrl = pushChainClient.explorer.getTransactionUrl(txHash, {
      chain: CHAIN.BNB_TESTNET,
    });
    expect(bnbUrl).toBe(`https://testnet.bscscan.com/tx/${txHash}`);

    const arbUrl = pushChainClient.explorer.getTransactionUrl(txHash, {
      chain: CHAIN.ARBITRUM_SEPOLIA,
    });
    expect(arbUrl).toBe(`https://sepolia.arbiscan.io/tx/${txHash}`);

    const baseUrl = pushChainClient.explorer.getTransactionUrl(txHash, {
      chain: CHAIN.BASE_SEPOLIA,
    });
    expect(baseUrl).toBe(`https://sepolia.basescan.org/tx/${txHash}`);
  });

  it('should get Solana transaction url with cluster param', async () => {
    const pushChainClient = await createClient();
    const txHash = 'SolTxSig123';

    const solUrl = pushChainClient.explorer.getTransactionUrl(txHash, {
      chain: CHAIN.SOLANA_DEVNET,
    });
    expect(solUrl).toBe(
      `https://explorer.solana.com/tx/${txHash}?cluster=devnet`
    );
  });

  it('should prefer user-provided blockExplorers over built-in', async () => {
    const pushChainClient = await createClient({
      [CHAIN.ETHEREUM_SEPOLIA]: ['https://my-custom-explorer.io'],
    });
    const txHash = '0xdef';

    const url = pushChainClient.explorer.getTransactionUrl(txHash, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
    });
    expect(url).toBe(`https://my-custom-explorer.io/tx/${txHash}`);
  });

  // ── listUrls ───────────────────────────────────────────────────────

  it('should list default block explorer URLs (Push Chain)', async () => {
    const pushChainClient = await createClient();

    const { explorers } = pushChainClient.explorer.listUrls();
    expect(Array.isArray(explorers)).toBe(true);
    expect(explorers).toHaveLength(1);
    expect(explorers[0].chain).toBe(CHAIN.PUSH_TESTNET_DONUT);
    expect(explorers[0].chainName).toBe('PUSH_TESTNET_DONUT');
    expect(explorers[0].urls).toContain('https://donut.push.network');
  });

  it('should list URLs for a specific chain via options.chain', async () => {
    const pushChainClient = await createClient();

    const { explorers } = pushChainClient.explorer.listUrls({
      chain: CHAIN.ETHEREUM_SEPOLIA,
    });
    expect(explorers).toHaveLength(1);
    expect(explorers[0].chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
    expect(explorers[0].chainName).toBe('ETHEREUM_SEPOLIA');
    expect(explorers[0].urls).toContain('https://sepolia.etherscan.io');
  });

  it('should list custom block explorer URLs when provided', async () => {
    const customBlockExplorers = {
      [CHAIN.PUSH_TESTNET_DONUT]: [
        'https://custom-explorer1.push.network',
        'https://custom-explorer2.push.network',
      ],
    };

    const pushChainClient = await createClient(customBlockExplorers);

    const { explorers } = pushChainClient.explorer.listUrls();
    expect(explorers).toHaveLength(1);
    expect(explorers[0].urls).toEqual([
      'https://custom-explorer1.push.network',
      'https://custom-explorer2.push.network',
    ]);
  });

  it('should list URLs for a specific chain from multi-chain config', async () => {
    const multiChainBlockExplorers = {
      [CHAIN.PUSH_TESTNET_DONUT]: ['https://donut-explorer.push.network'],
      [CHAIN.ETHEREUM_SEPOLIA]: ['https://sepolia.etherscan.io'],
      [CHAIN.ARBITRUM_SEPOLIA]: ['https://sepolia.arbiscan.io'],
      [CHAIN.BASE_SEPOLIA]: ['https://sepolia.basescan.org'],
      [CHAIN.SOLANA_DEVNET]: ['https://explorer.solana.com'],
    };

    const pushChainClient = await createClient(multiChainBlockExplorers);

    // Default (no options) → Push Chain
    const { explorers: defaultExplorers } =
      pushChainClient.explorer.listUrls();
    expect(defaultExplorers[0].urls).toEqual([
      'https://donut-explorer.push.network',
    ]);

    // Specific chain
    const { explorers: ethExplorers } = pushChainClient.explorer.listUrls({
      chain: CHAIN.ETHEREUM_SEPOLIA,
    });
    expect(ethExplorers[0].chainName).toBe('ETHEREUM_SEPOLIA');
    expect(ethExplorers[0].urls).toEqual(['https://sepolia.etherscan.io']);
  });

  // ── listAllUrls ────────────────────────────────────────────────────

  it('should list all URLs across all chains', async () => {
    const pushChainClient = await createClient();

    const { explorers } = pushChainClient.explorer.listAllUrls();
    expect(Array.isArray(explorers)).toBe(true);
    expect(explorers.length).toBeGreaterThan(0);

    // Should include Push Chain and external chains
    const chainNames = explorers.map((e) => e.chainName);
    expect(chainNames).toContain('PUSH_TESTNET_DONUT');
    expect(chainNames).toContain('ETHEREUM_SEPOLIA');
    expect(chainNames).toContain('BNB_TESTNET');

    // Each entry should have the right shape
    for (const entry of explorers) {
      expect(entry).toHaveProperty('chain');
      expect(entry).toHaveProperty('chainName');
      expect(entry).toHaveProperty('urls');
      expect(Array.isArray(entry.urls)).toBe(true);
      expect(entry.urls.length).toBeGreaterThan(0);
    }
  });

  it('should override built-in explorers with user-provided in listAllUrls', async () => {
    const customBlockExplorers = {
      [CHAIN.ETHEREUM_SEPOLIA]: ['https://my-etherscan.io'],
    };

    const pushChainClient = await createClient(customBlockExplorers);

    const { explorers } = pushChainClient.explorer.listAllUrls();
    const ethEntry = explorers.find((e) => e.chainName === 'ETHEREUM_SEPOLIA');
    expect(ethEntry).toBeDefined();
    expect(ethEntry!.urls).toEqual(['https://my-etherscan.io']);

    // Built-in chains should still be present
    const pushEntry = explorers.find(
      (e) => e.chainName === 'PUSH_TESTNET_DONUT'
    );
    expect(pushEntry).toBeDefined();
    expect(pushEntry!.urls).toContain('https://donut.push.network');
  });
});
