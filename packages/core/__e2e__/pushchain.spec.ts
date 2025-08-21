import {
  generatePrivateKey,
  PrivateKeyAccount,
  privateKeyToAccount,
} from 'viem/accounts';
import { PUSH_NETWORK, CHAIN } from '../src/lib/constants/enums';
import {
  createPublicClient,
  createWalletClient,
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
  const pushNetwork = PUSH_NETWORK.LOCALNET;
  const to = '0x35B84d6848D16415177c64D64504663b998A6ab4';
  let universalSigner: UniversalSigner;
  let randomAccount: PrivateKeyAccount;
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
          transport: http('http://localhost:9545'),
        });

        universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
          walletClient,
          {
            chain: originChain,
            library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
          }
        );
        console.log("universal signer : ", universalSigner)

        pushClient = await PushChain.initialize(universalSigner, {
          network: pushNetwork,
          rpcUrls: {[CHAIN.ETHEREUM_SEPOLIA] : ["http://localhost:9545"]},
          progressHook: (val: any) => {
            console.log(val);
          },
        });

        // Generate random account
        randomAccount = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
        console.log("hgay ", randomAccount.address)
        // Try to send Sepolia ETH to random generated address
        const txHash = await walletClient.sendTransaction({
          to: randomAccount.address,
          chain: sepolia,
          value: PushChain.utils.helpers.parseUnits('1', 14),
        });
        console.log("txhash", txHash)
        const publicClient = createPublicClient({
          chain: sepolia,
          transport: http('http://localhost:9545'),
        });
        await publicClient.waitForTransactionReceipt({
          hash: txHash,
        });
        console.log("done 1")
      }, 100000);

      it('should fail to send universal.sendTransaction with invalid feeLockTxHash', async () => {
        await expect(
          pushClient.universal.sendTransaction({
            to,
            feeLockTxHash: '0xABC', // Invalid txHash
            value: BigInt(1e3),
          })
        ).rejects.toThrow();
      }, 30000);

      it('should fail to send universal.sendTransaction with fundGas property', async () => {
        await expect(
          pushClient.universal.sendTransaction({
            to,
            value: BigInt(1e3),
            fundGas: {
              chainToken: '0x1234567890123456789012345678901234567890',
            },
          })
        ).rejects.toThrow('Unsupported token');
      }, 30000);

      it('should successfully send universal.sendTransaction without fundGas (default behavior)', async () => {
        const tx = await pushClient.universal.sendTransaction({
          to : '0x35B84d6848D16415177c64D64504663b998A6ab4',
          value: BigInt(1e3),
          // fundGas not provided - should work fine
        });
        console.log("tan :", tx);
        expect(tx).toBeDefined();
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        await txValidator(
          tx,
          pushClient.universal.origin.address as `0x${string}`,
          to
        );
      }, 300000);

      it('should successfully sendTransaction - Transfer Call', async () => {
        const tx = await pushClient.universal.sendTransaction({
          to : '0x35B84d6848D16415177c64D64504663b998A6ab4',
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

      it('should successfully sendTransaction to funded undeployed UEA', async () => {
        const walletClient = createWalletClient({
          account: randomAccount,
          transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
        });
        const randomUniversalSigner =
          await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
            chain: originChain,
            library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
          });
        const UEA = await PushChain.utils.account.convertOriginToExecutor(
          randomUniversalSigner.account,
          {
            onlyCompute: true,
          }
        );

        // Fund Undeployed UEA - 1PC
        await pushClient.universal.sendTransaction({
          to: UEA.address,
          value: BigInt(1e18),
        });

        // Send Tx Via Random Address
        const randomPushClient = await PushChain.initialize(
          randomUniversalSigner,
          {
            network: pushNetwork,
          }
        );
        await randomPushClient.universal.sendTransaction({
          to,
          value: BigInt(1e6),
        });
      }, 300000);
    });
  });
  describe('Origin - Push', () => {
    const originChain = CHAIN.PUSH_LOCALNET;
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

    it('should fail to send universal.sendTransaction with fundGas property from Push origin', async () => {
      await expect(
        pushClient.universal.sendTransaction({
          to,
          value: BigInt(2),
          fundGas: { chainToken: '0x1234567890123456789012345678901234567890' },
        })
      ).rejects.toThrow('Unsupported token');
    }, 30000);

    it('should sendTransaction', async () => {
      const from = pushClient.universal.account;
      const tx = await pushClient.universal.sendTransaction({
        to,
        value: BigInt(2),
      });
      console.log("sine ", tx)
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

        const privateKey = bs58.decode(privateKeyHex);

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

      it('should fail to send universal.sendTransaction with fundGas property from Solana origin', async () => {
        await expect(
          pushClient.universal.sendTransaction({
            to,
            value: BigInt(1e1),
            fundGas: {
              chainToken: '0x1234567890123456789012345678901234567890',
            },
          })
        ).rejects.toThrow('Unsupported token');
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
  const pushNetwork = PUSH_NETWORK.LOCALNET;
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
      transport: http(CHAIN_INFO[CHAIN.PUSH_LOCALNET].defaultRPC[0]),
    });
    console.log("cjjj ", CHAIN_INFO[CHAIN.PUSH_LOCALNET].defaultRPC[0])
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
      rpcUrls:{[CHAIN.ETHEREUM_SEPOLIA] : ['http://localhost:9545'], [CHAIN.PUSH_LOCALNET] : ['http://localhost:8545']}
    });
    pushClientSepolia = await PushChain.initialize(universalSignerSepolia, {
      network: pushNetwork,
      rpcUrls:{[CHAIN.ETHEREUM_SEPOLIA] : ['http://localhost:9545'], [CHAIN.PUSH_LOCALNET] : ['http://localhost:8545']}
    });
    pushClientSolana = await PushChain.initialize(universalSignerSolana, {
      network: pushNetwork,
      rpcUrls:{[CHAIN.ETHEREUM_SEPOLIA] : ['http://localhost:9545'], [CHAIN.PUSH_LOCALNET] : ['http://localhost:8545']}
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