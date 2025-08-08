import {
  generatePrivateKey,
  PrivateKeyAccount,
  privateKeyToAccount,
} from 'viem/accounts';
import { PUSH_NETWORK, CHAIN } from '../src/lib/constants/enums';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  Hex,
  hexToBytes,
  http,
} from 'viem';
import { Keypair } from '@solana/web3.js';
import { PushChain } from '../src';
import { UniversalSigner } from '../src/lib/universal/universal.types';
import { CHAIN_INFO } from '../src/lib/constants/chain';
import dotenv from 'dotenv';
import path from 'path';
import { UniversalTxResponse } from '../src/lib/orchestrator/orchestrator.types';
import { sepolia } from 'viem/chains';
import bs58 from 'bs58';

// Adjust path as needed if your .env is in the root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

describe('PushChain (e2e)', () => {
  const pushNetwork = PUSH_NETWORK.TESTNET_DONUT;
  const to = '0x35B84d6848D16415177c64D64504663b998A6ab4';
  let universalSigner: UniversalSigner;
  describe('Origin - EVM (Except Push)', () => {
    describe(`${CHAIN.ETHEREUM_SEPOLIA}`, () => {
      const originChain = CHAIN.ETHEREUM_SEPOLIA;
      let pushClient: PushChain;

      beforeAll(async () => {
        const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
        if (!privateKey) throw new Error('EVM_PRIVATE_KEY not set');

        const account = privateKeyToAccount(privateKey);
        const walletClient = createWalletClient({
          account,
          transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
        });

        universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
          walletClient,
          {
            chain: originChain,
            library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
          }
        );

        pushClient = await PushChain.initialize(universalSigner, {
          network: pushNetwork,
          progressHook: (val: any) => {
            console.log(val);
          },
        });
      });

      it('should fail to send universal.sendTransaction with invalid feeLockTxHash', async () => {
        await expect(
          pushClient.universal.sendTransaction({
            to,
            feeLockTxHash: '0xABC', // Invalid txHash
            value: BigInt(1e3),
          })
        ).rejects.toThrow();
      }, 30000);

      it('should successfully sendTransaction - Transfer Call', async () => {
        const tx = await pushClient.universal.sendTransaction({
          to,
          value: BigInt(1e3),
        });
        const after = await PushChain.utils.account.convertOriginToExecutor(
          universalSigner.account,
          {
            onlyCompute: true,
          }
        );
        expect(after.deployed).toBe(true);
        await txValidator(
          tx,
          pushClient.universal.origin.address as `0x${string}`,
          to
        );
      }, 300000);
    });
  });
  describe('Origin - Push', () => {
    const originChain = CHAIN.PUSH_TESTNET_DONUT;
    let pushClient: PushChain;
    let account: PrivateKeyAccount;

    beforeAll(async () => {
      const privateKey = process.env['PUSH_PRIVATE_KEY'] as Hex;
      if (!privateKey) throw new Error('PUSH_PRIVATE_KEY not set');

      account = privateKeyToAccount(privateKey);
      const walletClient = createWalletClient({
        account,
        transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
      });

      universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
        walletClient,
        {
          chain: originChain,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );

      pushClient = await PushChain.initialize(universalSigner, {
        network: pushNetwork,
        progressHook: (val: any) => {
          console.log(val);
        },
      });
    });

    it('should sendTransaction', async () => {
      const from = pushClient.universal.account;
      const tx = await pushClient.universal.sendTransaction({
        to,
        value: BigInt(2),
      });
      await txValidator(tx, from, to);
    });
  });
  describe('Origin - SVM', () => {
    describe(`${CHAIN.SOLANA_DEVNET}`, () => {
      const originChain = CHAIN.SOLANA_DEVNET;
      let pushClient: PushChain;

      beforeAll(async () => {
        const privateKeyHex = process.env['SOLANA_PRIVATE_KEY'];
        if (!privateKeyHex) throw new Error('SOLANA_PRIVATE_KEY not set');

        const privateKey = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));

        const account = Keypair.fromSecretKey(privateKey);

        universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
          account,
          {
            chain: originChain,
            library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
          }
        );

        pushClient = await PushChain.initialize(universalSigner, {
          network: pushNetwork,
          progressHook: (val: any) => {
            console.log(val);
          },
        });
      });

      it('should fail to send universal.sendTransaction with invalid feeLockTxHash', async () => {
        await expect(
          pushClient.universal.sendTransaction({
            to,
            feeLockTxHash: '0xABC', // Invalid txHash
            value: BigInt(1e1),
          })
        ).rejects.toThrow();
      }, 30000);

      it('should successfully send universal.sendTransaction', async () => {
        const uea = pushClient.universal.account;
        const tx = await pushClient.universal.sendTransaction({
          to,
          value: BigInt(1),
        });
        const after = await PushChain.utils.account.convertOriginToExecutor(
          universalSigner.account,
          {
            onlyCompute: true,
          }
        );
        expect(after.deployed).toBe(true);
        await txValidator(tx, pushClient.universal.origin.address, to);
      }, 300000);
    });
  });
});

describe('Deploy UEA on Push Testnet Edge Cases', () => {
  const pushTestnet = defineChain({
    id: 42101,
    name: 'Push Testnet',
    nativeCurrency: {
      decimals: 18,
      name: 'PC',
      symbol: '$PC',
    },
    rpcUrls: {
      default: {
        http: [
          'https://evm.rpc-testnet-donut-node1.push.org/',
          'https://evm.rpc-testnet-donut-node2.push.org/',
        ],
      },
    },
    blockExplorers: {
      default: {
        name: 'Push Testnet Explorer',
        url: 'https://explorer.testnet.push.org/',
      },
    },
  });
  it('Deploy UEA on Push Testnet to address that has Push Tokens', async () => {
    // Generate random private key
    const randomPrivateKey = generatePrivateKey();
    // From private key, calculate Account
    const randomAccount = privateKeyToAccount(randomPrivateKey);
    // Create WalletClient from Account
    const walletClient = createWalletClient({
      account: randomAccount,
      chain: sepolia,
      transport: http(),
    });
    // Create PushChain client from WalletClient
    const universalSigner = await PushChain.utils.signer.toUniversal(
      walletClient
    );
    const pushChainClient = await PushChain.initialize(universalSigner, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    });
    // Calculate Universal.origin address.
    const universalOrigin =
      await PushChain.utils.account.convertOriginToExecutor({
        address: randomAccount.address,
        chain: CHAIN.ETHEREUM_SEPOLIA,
      });

    // Check balance of Universal.account address
    const publicClientPush = createPublicClient({
      chain: pushTestnet,
      transport: http('https://evm.rpc-testnet-donut-node1.push.org/'),
    });
    const publicClientSepolia = createPublicClient({
      chain: sepolia,
      transport: http(),
    });
    const balanceBeforePush = await publicClientPush.getBalance({
      address: pushChainClient.universal.account,
    });
    console.log('Balance before Push', balanceBeforePush);
    expect(balanceBeforePush).toBe(BigInt('0'));
    const balanceBeforeSepolia = await publicClientSepolia.getBalance({
      address: randomAccount.address,
    });
    expect(balanceBeforeSepolia).toBe(BigInt('0'));
    console.log('Balance before Sepolia', balanceBeforeSepolia);
    // Send 2 Push Token to Universal.account address
    const privateKeyWithPushTokens = process.env['PUSH_PRIVATE_KEY'] as Hex;
    if (!privateKeyWithPushTokens) throw new Error('PUSH_PRIVATE_KEY not set');
    const privateKeyWithSepoliaEth = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!privateKeyWithSepoliaEth) throw new Error('EVM_PRIVATE_KEY not set');
    const accountWithPushTokens = privateKeyToAccount(privateKeyWithPushTokens);
    const accountWithSepoliaTokens = privateKeyToAccount(
      privateKeyWithSepoliaEth
    );
    const walletClientWithPushTokens = createWalletClient({
      account: accountWithPushTokens,
      chain: pushTestnet,
      transport: http('https://evm.rpc-testnet-donut-node1.push.org/'),
    });
    const walletClientSepoliaTokens = createWalletClient({
      account: accountWithSepoliaTokens,
      chain: sepolia,
      transport: http(),
    });
    // Try to send a transaction from that random address. Use walletClientWithPushTokens to send the 2 push tokens to Universal.account address
    const hashPushTokens = await walletClientWithPushTokens.sendTransaction({
      to: universalOrigin.address,
      value: PushChain.utils.helpers.parseUnits('2', 18),
    });
    // Wait for the transaction to be mined
    await publicClientPush.waitForTransactionReceipt({
      hash: hashPushTokens,
    });

    // Try to send Sepolia ETH to random generated address
    const hashSepoliaTokens = await walletClientSepoliaTokens.sendTransaction({
      to: randomAccount.address,
      value: PushChain.utils.helpers.parseUnits('0.7', 14),
    });
    // Wait for transaction to bbe mined
    await publicClientSepolia.waitForTransactionReceipt({
      hash: hashSepoliaTokens,
    });

    // Check balance of Universal.account address
    const balanceAfterPush = await publicClientPush.getBalance({
      address: pushChainClient.universal.account,
    });
    console.log('Balance after Push', balanceAfterPush);
    expect(balanceAfterPush).toBe(BigInt('2000000000000000000'));
    const balanceAfterSepolia = await publicClientSepolia.getBalance({
      address: randomAccount.address,
    });
    console.log('Balance after Sepolia', balanceAfterSepolia);
    expect(balanceAfterSepolia).toBe(BigInt('70000000000000'));

    // Try to send a transaction from that random address. Use walletClientWithPushTokens to send the 2 push tokens to Universal.account address
    const tx = await pushChainClient.universal.sendTransaction({
      to: universalOrigin.address,
      value: PushChain.utils.helpers.parseUnits('0.05', 10),
    });
    expect(tx).toBeDefined();
  }, 100000);
});

const txValidator = async (
  tx: UniversalTxResponse,
  from: string,
  to: `0x${string}`
) => {
  expect(tx).toBeDefined();

  // 1. Identity fields
  expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
  expect(tx.origin).toBeDefined();
  expect(tx.origin).toMatch(
    /^[a-zA-Z0-9_-]+:[a-zA-Z0-9]+:(0x[a-fA-F0-9]{40,64}|[1-9A-HJ-NP-Za-km-z]{43,44})$/
  ); // Format: namespace:chainId:address (supports both EVM and Solana)

  // 2. Block Info
  expect(typeof tx.blockNumber).toBe('bigint');
  expect(tx.blockNumber).toBeGreaterThanOrEqual(BigInt(0));
  expect(typeof tx.blockHash).toBe('string');
  expect(typeof tx.transactionIndex).toBe('number');
  expect(typeof tx.chainId).toBe('string');

  // 3. Execution Context
  expect(tx.to?.toLowerCase()).toBe(to.toLowerCase());
  expect(tx.origin.split(':')[2].toLowerCase()).toBe(from.toLowerCase());
  // Always validate that from and to exist and are strings
  expect(tx.from).toBeDefined();
  expect(typeof tx.from).toBe('string');
  if (tx.to) {
    expect(typeof tx.to).toBe('string');
  }
  expect(typeof tx.nonce).toBe('number');

  // 4. Payload
  expect(typeof tx.data).toBe('string');
  expect(tx.data).toMatch(/^0x/);
  expect(typeof tx.value).toBe('bigint');

  // 5. Gas-related (changed from tx.gas to tx.gasLimit)
  expect(typeof tx.gasLimit).toBe('bigint');
  expect(tx.gasLimit).toBeGreaterThanOrEqual(BigInt(0));

  if (tx.maxFeePerGas !== undefined) {
    expect(typeof tx.maxFeePerGas).toBe('bigint');
    expect(tx.maxFeePerGas >= BigInt(0)).toBe(true);
  }

  if (tx.maxPriorityFeePerGas !== undefined) {
    expect(typeof tx.maxPriorityFeePerGas).toBe('bigint');
    expect(tx.maxPriorityFeePerGas >= BigInt(0)).toBe(true);
  }

  expect(Array.isArray(tx.accessList)).toBe(true);

  // 6. Utilities
  expect(typeof tx.wait).toBe('function');

  // 7. Metadata - New fields
  expect(typeof tx.type).toBe('string');
  expect(['99', '2', '1', '0']).toContain(tx.type); // Universal, EIP-1559, EIP-2930, Legacy

  expect(typeof tx.typeVerbose).toBe('string');
  expect(['universal', 'eip1559', 'eip2930', 'eip4844', 'legacy']).toContain(
    tx.typeVerbose
  );

  // Signature object validation
  expect(tx.signature).toBeDefined();
  expect(typeof tx.signature.r).toBe('string');
  expect(typeof tx.signature.s).toBe('string');
  expect(typeof tx.signature.v).toBe('number');
  expect(typeof tx.signature.yParity).toBe('number');
  expect(tx.signature.r).toMatch(/^0x[a-fA-F0-9]+$/);
  expect(tx.signature.s).toMatch(/^0x[a-fA-F0-9]+$/);
  expect([0, 1]).toContain(tx.signature.yParity);

  // 8. Raw Universal Fields (optional)
  if (tx.raw) {
    expect(typeof tx.raw.from).toBe('string');
    expect(typeof tx.raw.to).toBe('string');
    expect(typeof tx.raw.nonce).toBe('number');
    expect(typeof tx.raw.data).toBe('string');
    expect(typeof tx.raw.value).toBe('bigint');
  }

  // Optional: Wait for receipt and confirm it's mined
  const receipt = await tx.wait();
  expect(receipt).toBeDefined();
  expect(receipt.hash).toBe(tx.hash); // Same transaction
  expect(receipt.blockNumber).toBeGreaterThan(BigInt(0));
};

describe('UniversalTxReceipt Type Validation', () => {
  const pushNetwork = PUSH_NETWORK.TESTNET_DONUT;
  const to = '0x35B84d6848D16415177c64D64504663b998A6ab4';
  let fromEVM: `0x${string}`;
  let fromPush: `0x${string}`;
  let fromSolana: string;
  let universalSignerPush: UniversalSigner;
  let universalSignerSepolia: UniversalSigner;
  let universalSignerSolana: UniversalSigner;
  let pushClientPush: PushChain;
  let pushClientSepolia: PushChain;
  let pushClientSolana: PushChain;

  beforeAll(async () => {
    const privateKeyEVM = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!privateKeyEVM) throw new Error('EVM_PRIVATE_KEY not set');
    const privateKeyPush = process.env['PUSH_PRIVATE_KEY'] as Hex;
    if (!privateKeyPush) throw new Error('EVM_PRIVATE_KEY not set');
    const privateKeySolana = process.env['SOLANA_PRIVATE_KEY'];
    if (!privateKeySolana) throw new Error('SOLANA_PRIVATE_KEY not set');
    const accountSolana = Keypair.fromSecretKey(
      hexToBytes(`0x${privateKeySolana}`)
    );
    fromEVM = privateKeyToAccount(privateKeyEVM).address;
    fromPush = privateKeyToAccount(privateKeyPush).address;
    fromSolana = accountSolana.publicKey.toBase58();

    const walletClientPush = createWalletClient({
      account: privateKeyToAccount(privateKeyPush),
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET].defaultRPC[0]),
    });
    const walletClientSepolia = createWalletClient({
      account: privateKeyToAccount(privateKeyEVM),
      chain: sepolia,
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });

    universalSignerPush = await PushChain.utils.signer.toUniversal(
      walletClientPush
    );
    universalSignerSepolia = await PushChain.utils.signer.toUniversal(
      walletClientSepolia
    );
    universalSignerSolana = await PushChain.utils.signer.toUniversalFromKeypair(
      accountSolana,
      {
        chain: CHAIN.SOLANA_DEVNET,
        library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
      }
    );
    pushClientPush = await PushChain.initialize(universalSignerPush, {
      network: pushNetwork,
    });
    pushClientSepolia = await PushChain.initialize(universalSignerSepolia, {
      network: pushNetwork,
    });
    pushClientSolana = await PushChain.initialize(universalSignerSolana, {
      network: pushNetwork,
    });
  });

  describe('Response Type Structure', () => {
    it('should return UniversalTxReceipt with all required fields', async () => {
      const txPush = await pushClientPush.universal.sendTransaction({
        to,
        value: BigInt(1000),
      });
      const txSepolia = await pushClientSepolia.universal.sendTransaction({
        to,
        value: BigInt(1000),
      });
      const txSolana = await pushClientSolana.universal.sendTransaction({
        to,
        value: BigInt(1000),
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      await txPush.wait();
      await txSepolia.wait();
      await txSolana.wait();

      // Use the existing txValidator function with skipAddressValidation
      await txValidator(txPush, fromPush, to);
      await txValidator(txSepolia, fromEVM, to);
      await txValidator(txSolana, fromSolana, to);
    }, 60000);

    it('should have valid origin field format', async () => {
      const txPush = await pushClientPush.universal.sendTransaction({
        to,
        value: BigInt(100),
      });
      const txSepolia = await pushClientSepolia.universal.sendTransaction({
        to,
        value: BigInt(100),
      });
      const txSolana = await pushClientSolana.universal.sendTransaction({
        to,
        value: BigInt(100),
      });

      await txPush.wait();
      await txSepolia.wait();
      await txSolana.wait();

      // Use txValidator for comprehensive validation (includes origin format validation)
      await txValidator(txPush, fromPush, to);
      await txValidator(txSepolia, fromEVM, to);
      await txValidator(txSolana, fromSolana, to);

      // Additional specific origin content validations
      expect(txPush.origin).toContain('eip155'); // EVM namespace
      expect(txSepolia.origin).toContain('eip155'); // EVM namespace
      expect(txSolana.origin).toContain('solana'); // Solana namespace
      expect(txPush.origin).toContain('42101'); // Push chain ID
      expect(txSepolia.origin).toContain('11155111'); // Push chain ID
      expect(txSolana.origin).toContain('EtWTRABZaYq6iMfeYKouRu166VU2xqa1'); // Push chain ID
      expect(txPush.origin).toContain(txPush.from);
      expect(txSepolia.origin).not.toContain(txSepolia.from);
      expect(txSolana.origin).not.toContain(txSolana.from);
      expect(txPush.origin).toContain(universalSignerPush.account.address);
      expect(txSepolia.origin.toLowerCase()).toContain(
        universalSignerSepolia.account.address.toLowerCase()
      );
      expect(txSolana.origin.toLowerCase()).toContain(
        universalSignerSolana.account.address.toLowerCase()
      );
    }, 60000);

    it('should have raw transaction data when available', async () => {
      const testTo = '0x35B84d6848D16415177c64D64504663b998A6ab4';
      const testValue = BigInt(300);
      const testData = '0x1234';
      const txPush = await pushClientPush.universal.sendTransaction({
        to: testTo,
        value: testValue,
        data: testData,
      });
      await txValidator(txPush, fromPush, to);

      // Additional specific raw data validations
      if (txPush.raw) {
        expect(txPush.raw.to).toBe(testTo);
        expect(txPush.raw.value).toBe(testValue);
        expect(txPush.raw.data).toBe(testData);
        expect(txPush.raw.from).toBe(universalSignerPush.account.address);
      }
    }, 60000);

    it('should maintain wait function compatibility', async () => {
      const tx = await pushClientPush.universal.sendTransaction({
        to,
        value: BigInt(150),
      });

      expect(typeof tx.wait).toBe('function');

      // Wait function should return UniversalTxReceipt
      const waitResult = await tx.wait();

      // --- Identity ---
      expect(waitResult.hash).toBeDefined();
      expect(typeof waitResult.hash).toBe('string');

      // --- Block Info ---
      expect(waitResult.blockNumber).toBeDefined();
      expect(typeof waitResult.blockNumber).toBe('bigint');
      expect(waitResult.blockNumber).toBeGreaterThanOrEqual(BigInt(0));
      expect(waitResult.blockHash).toBeDefined();
      expect(typeof waitResult.blockHash).toBe('string');
      expect(waitResult.transactionIndex).toBeDefined();
      expect(typeof waitResult.transactionIndex).toBe('number');
      expect(waitResult.transactionIndex).toBeGreaterThanOrEqual(0);

      // --- Execution Context ---
      expect(waitResult.from).toBeDefined();
      expect(typeof waitResult.from).toBe('string');
      expect(waitResult.from).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(waitResult.to).toBeDefined();
      expect(typeof waitResult.to).toBe('string');
      expect(waitResult.to).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(
        waitResult.contractAddress === null ||
          typeof waitResult.contractAddress === 'string'
      ).toBe(true);
      if (waitResult.contractAddress) {
        expect(waitResult.contractAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      }

      // --- Gas & Usage ---
      expect(waitResult.gasPrice).toBeDefined();
      expect(typeof waitResult.gasPrice).toBe('bigint');
      expect(waitResult.gasPrice).toBeGreaterThanOrEqual(BigInt(0));
      expect(waitResult.gasUsed).toBeDefined();
      expect(typeof waitResult.gasUsed).toBe('bigint');
      expect(waitResult.gasUsed).toBeGreaterThanOrEqual(BigInt(0));
      expect(waitResult.cumulativeGasUsed).toBeDefined();
      expect(typeof waitResult.cumulativeGasUsed).toBe('bigint');
      expect(waitResult.cumulativeGasUsed).toBeGreaterThanOrEqual(BigInt(0));

      // --- Logs ---
      expect(Array.isArray(waitResult.logs)).toBe(true);
      expect(waitResult.logsBloom).toBeDefined();
      expect(typeof waitResult.logsBloom).toBe('string');

      // --- Outcome ---
      expect([0, 1]).toContain(waitResult.status);

      // --- Raw ---
      expect(waitResult.raw).toBeDefined();
      expect(typeof waitResult.raw).toBe('object');
      expect(waitResult.raw.from).toBeDefined();
      expect(typeof waitResult.raw.from).toBe('string');
      expect(waitResult.raw.from).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(waitResult.raw.to).toBeDefined();
      expect(typeof waitResult.raw.to).toBe('string');
      expect(waitResult.raw.to).toMatch(/^0x[a-fA-F0-9]{40}$/);
    }, 60000);
  });
});

/** CLI COMMANDS
 
TO GENERATE UNSIGNED TX
  pchaind tx bank send acc1 push1f5th78lzntc2h0krzqn5yldvwg43lcrgkqxtsv 1000npush \
  --generate-only --output json > unsigned.json

TO SIGN THE TX & GENERATE SIGNED TX ( VIA ACC 1 )
  pchaind tx sign unsigned.json \
  --from acc1 --chain-id localchain_9000-1 \
  --keyring-backend test \
  --output-document signed.json

TO ENCODE TX
  pchaind tx encode signed.json

TO DECODE TX
  pchaind tx decode base64EncodedString

 */
