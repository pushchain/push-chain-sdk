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
  http,
} from 'viem';
import { Keypair } from '@solana/web3.js';
import { PushChain } from '../src';
import { UniversalSigner } from '../src/lib/universal/universal.types';
import { CHAIN_INFO } from '../src/lib/constants/chain';
import dotenv from 'dotenv';
import path from 'path';
import { UniversalTxResponse } from '../src/lib/vm-client/vm-client.types';
import { sepolia } from 'viem/chains';

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
        const uea = pushClient.universal.account;
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
          pushClient['orchestrator']['pushClient'].getSignerAddress()
            .evmAddress,
          uea
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
          value: BigInt(1e18),
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
          pushClient['orchestrator']['pushClient'].getSignerAddress()
            .evmAddress,
          uea
        );
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
      value: PushChain.utils.helpers.parseUnits('0.07', 18),
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
    expect(balanceAfterSepolia).toBe(BigInt('70000000000000000'));

    // Try to send a transaction from that random address. Use walletClientWithPushTokens to send the 2 push tokens to Universal.account address
    const tx = await pushChainClient.universal.sendTransaction({
      to: universalOrigin.address,
      value: PushChain.utils.helpers.parseUnits('0.05', 18),
    });
    expect(tx).toBeDefined();
  }, 100000);
});

const txValidator = async (
  tx: UniversalTxResponse,
  from: `0x${string}`,
  to: `0x${string}`
) => {
  expect(tx).toBeDefined();

  // 1. Identity fields
  expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
  expect(tx.origin).toBeDefined();
  expect(tx.origin).toMatch(/^[a-zA-Z0-9_-]+:[0-9]+:0x[a-fA-F0-9]{40}$/); // Format: namespace:chainId:address

  // 2. Block Info
  expect(typeof tx.blockNumber).toBe('bigint');
  expect(tx.blockNumber).toBeGreaterThanOrEqual(BigInt(0));
  expect(typeof tx.blockHash).toBe('string');
  expect(typeof tx.transactionIndex).toBe('number');
  expect(typeof tx.chainId).toBe('number');

  // 3. Execution Context
  expect(tx.to?.toLowerCase()).toBe(to.toLowerCase());
  expect(tx.from.toLowerCase()).toBe(from.toLowerCase());
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
  expect(['universal', 'EIP-1559', 'EIP-2930', 'legacy']).toContain(
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
  let universalSigner: UniversalSigner;
  let pushClient: PushChain;

  beforeAll(async () => {
    const privateKey =
      '0x890ddbe894a269bb58d68b652d7989205b02d0c9ba915625da2aad464e47e0aa';
    if (!privateKey) throw new Error('EVM_PRIVATE_KEY not set');

    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET].defaultRPC[0]),
    });

    universalSigner = await PushChain.utils.signer.toUniversal(walletClient);

    pushClient = await PushChain.initialize(universalSigner, {
      network: pushNetwork,
    });
  });

  describe('Response Type Structure', () => {
    it('should return UniversalTxReceipt with all required fields', async () => {
      const tx = await pushClient.universal.sendTransaction({
        to,
        value: BigInt(1000),
      });

      // Verify it's the new type, not the old TxResponse
      expect(tx).toBeDefined();

      // 1. Identity
      expect(tx.hash).toBeDefined();
      expect(typeof tx.hash).toBe('string');
      expect(tx.origin).toBeDefined();
      expect(typeof tx.origin).toBe('string');

      // 2. Block Info
      expect(tx.blockNumber).toBeDefined();
      expect(typeof tx.blockNumber).toBe('bigint');
      expect(tx.blockHash).toBeDefined();
      expect(typeof tx.blockHash).toBe('string');
      expect(tx.transactionIndex).toBeDefined();
      expect(typeof tx.transactionIndex).toBe('number');
      expect(tx.chainId).toBeDefined();
      expect(typeof tx.chainId).toBe('number');

      // 3. Execution Context
      expect(tx.from).toBeDefined();
      expect(typeof tx.from).toBe('string');
      expect(tx.to).toBeDefined();
      expect(typeof tx.to).toBe('string');
      expect(tx.nonce).toBeDefined();
      expect(typeof tx.nonce).toBe('number');

      // 4. Payload
      expect(tx.data).toBeDefined();
      expect(typeof tx.data).toBe('string');
      expect(tx.value).toBeDefined();
      expect(typeof tx.value).toBe('bigint');

      // 5. Gas
      expect(tx.gasLimit).toBeDefined();
      expect(typeof tx.gasLimit).toBe('bigint');
      expect(tx.accessList).toBeDefined();
      expect(Array.isArray(tx.accessList)).toBe(true);

      // 6. Utilities
      expect(tx.wait).toBeDefined();
      expect(typeof tx.wait).toBe('function');

      // 7. Metadata
      expect(tx.type).toBeDefined();
      expect(typeof tx.type).toBe('string');
      expect(tx.typeVerbose).toBeDefined();
      expect(typeof tx.typeVerbose).toBe('string');
      expect(tx.signature).toBeDefined();
      expect(typeof tx.signature).toBe('object');
    }, 60000);

    it('should have valid origin field format', async () => {
      const tx = await pushClient.universal.sendTransaction({
        to,
        value: BigInt(100),
      });

      // Origin should follow format: namespace:chainId:address
      expect(tx.origin).toMatch(/^[a-zA-Z0-9_-]+:[0-9]+:0x[a-fA-F0-9]{40}$/);

      // Should contain the chain info
      expect(tx.origin).toContain('eip155'); // EVM namespace
      expect(tx.origin).toContain('42101'); // Push chain ID
      expect(tx.origin.toLowerCase()).toContain(
        universalSigner.account.address.toLowerCase()
      );
    }, 60000);

    it('should have valid signature object', async () => {
      const tx = await pushClient.universal.sendTransaction({
        to,
        value: BigInt(100),
      });

      const signature = tx.signature;

      // Check signature properties
      expect(signature.r).toBeDefined();
      expect(signature.s).toBeDefined();
      expect(signature.v).toBeDefined();
      expect(signature.yParity).toBeDefined();

      // Check types
      expect(typeof signature.r).toBe('string');
      expect(typeof signature.s).toBe('string');
      expect(typeof signature.v).toBe('number');
      expect(typeof signature.yParity).toBe('number');

      // Check formats
      expect(signature.r).toMatch(/^0x[a-fA-F0-9]+$/);
      expect(signature.s).toMatch(/^0x[a-fA-F0-9]+$/);
      expect([0, 1]).toContain(signature.yParity);
    }, 60000);

    it('should have raw transaction data when available', async () => {
      const testTo = '0x35B84d6848D16415177c64D64504663b998A6ab4';
      const testValue = BigInt(300);
      const testData = '0x1234';
      const tx = await pushClient.universal.sendTransaction({
        to: testTo,
        value: testValue,
        data: testData,
      });

      if (tx.raw) {
        // Verify raw values match the transaction parameters
        expect(tx.raw.to).toBe(testTo);
        expect(tx.raw.value).toBe(testValue);
        expect(tx.raw.data).toBe(testData);

        // Verify from address matches the signer's address
        expect(tx.raw.from).toBe(universalSigner.account.address);

        // Verify nonce is a valid number
        expect(typeof tx.raw.nonce).toBe('number');
        expect(tx.raw.nonce).toBeGreaterThanOrEqual(0);
      }
    }, 60000);

    it('should maintain wait function compatibility', async () => {
      const tx = await pushClient.universal.sendTransaction({
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

  describe('Orchestrator execute method validation', () => {
    it('should return UniversalTxReceipt from orchestrator.execute', async () => {
      // Access the orchestrator directly to test the execute method
      const orchestrator = (pushClient as any).orchestrator;

      const executeParams = {
        to: to as `0x${string}`,
        value: BigInt(100),
        data: '0x' as `0x${string}`,
      };

      const result = await orchestrator.execute(executeParams);

      // Verify it returns UniversalTxReceipt
      expect(result).toBeDefined();
      expect(result.hash).toBeDefined();
      expect(result.origin).toBeDefined();
      expect(result.signature).toBeDefined();
      expect(result.typeVerbose).toBeDefined();
      expect(typeof result.gasLimit).toBe('bigint');
      expect(typeof result.data).toBe('string');

      // Should not have old TxResponse fields
      expect((result as any).input).toBeUndefined();
      expect((result as any).gas).toBeUndefined();
      expect((result as any).typeHex).toBeUndefined();
    }, 60000);

    it('should handle different transaction types correctly', async () => {
      const orchestrator = (pushClient as any).orchestrator;

      // Test with different gas settings to potentially trigger different tx types
      const executeParams = {
        to: to as `0x${string}`,
        value: BigInt(50),
        maxFeePerGas: BigInt(2000000000),
        maxPriorityFeePerGas: BigInt(1000000000),
      };

      const result = await orchestrator.execute(executeParams);

      expect(result.type).toBeDefined();
      expect(result.typeVerbose).toBeDefined();

      // Should be one of the valid types
      expect(['99', '2', '1', '0']).toContain(result.type);
      expect(['universal', 'EIP-1559', 'EIP-2930', 'legacy']).toContain(
        result.typeVerbose
      );

      // Gas fields should be properly set
      if (result.maxFeePerGas) {
        expect(typeof result.maxFeePerGas).toBe('bigint');
      }
      if (result.maxPriorityFeePerGas) {
        expect(typeof result.maxPriorityFeePerGas).toBe('bigint');
      }
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
