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
import { TxResponse } from '../src/lib/vm-client/vm-client.types';
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
      const privateKey = process.env['PUSH_CHAIN_PRIVATE_KEY'] as Hex;
      if (!privateKey) throw new Error('PUSH_CHAIN_PRIVATE_KEY not set');

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
  }, 60000);
});

const txValidator = async (
  tx: TxResponse,
  from: `0x${string}`,
  to: `0x${string}`
) => {
  expect(tx).toBeDefined();

  // Basic fields
  expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
  expect(tx.to?.toLowerCase()).toBe(to.toLowerCase());
  expect(tx.from.toLowerCase()).toBe(from.toLowerCase());

  // Gas-related
  expect(tx.gas).toBeGreaterThanOrEqual(BigInt(0));
  if (tx.maxFeePerGas !== undefined) {
    expect(typeof tx.maxFeePerGas).toBe('bigint');
    expect(tx.maxFeePerGas >= BigInt(0)).toBe(true);
  }

  if (tx.maxPriorityFeePerGas !== undefined) {
    expect(typeof tx.maxPriorityFeePerGas).toBe('bigint');
    expect(tx.maxPriorityFeePerGas >= BigInt(0)).toBe(true);
  }

  // EIP-1559 specifics (optional presence check)
  if (tx.type !== undefined) {
    expect(typeof tx.type).toBe('string');
    expect(['eip1559', 'legacy', 'eip2930']).toContain(tx.type);
  }

  expect(['0x2', '0x63']).toContain(tx.typeHex);

  // Signature components
  expect(tx.r).toMatch(/^0x[a-fA-F0-9]{1,64}$/);
  expect(tx.s).toMatch(/^0x[a-fA-F0-9]{1,64}$/);
  expect([0, 1]).toContain(tx.yParity);
  expect(Number(tx.v)).toBe(tx.yParity);

  // Optional: Wait for receipt and confirm it's mined
  const receipt = await tx.wait();
  expect(receipt.status).toBe('success'); // or use receipt.status === 1 if using viem raw format
  expect(receipt.blockNumber).toBeGreaterThan(BigInt(0));
};

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
