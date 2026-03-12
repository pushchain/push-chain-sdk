import '@e2e/shared/setup';
import {
  generatePrivateKey,
  PrivateKeyAccount,
  privateKeyToAccount,
} from 'viem/accounts';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import {
  createPublicClient,
  createWalletClient,
  Hex,
  http,
} from 'viem';
import { PushChain } from '../../../src';
import { UniversalSigner } from '../../../src/lib/universal/universal.types';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { sepolia, arbitrumSepolia, baseSepolia, bscTestnet } from 'viem/chains';
import { txValidator } from '@e2e/shared/validators';

describe('PushChain (e2e)', () => {
  const pushNetwork = PUSH_NETWORK.TESTNET_DONUT;
  const to = '0x35B84d6848D16415177c64D64504663b998A6ab4';
  let universalSigner: UniversalSigner;
  let randomAccount: PrivateKeyAccount;
  describe('Origin - EVM (Except Push)', () => {
    describe('ETHEREUM_SEPOLIA', () => {
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

        // Generate random account
        randomAccount = privateKeyToAccount(generatePrivateKey());
        // Try to send Sepolia ETH to random generated address
        const txHash = await walletClient.sendTransaction({
          to: randomAccount.address,
          chain: sepolia,
          value: PushChain.utils.helpers.parseUnits('2', 15),
        });
        const publicClient = createPublicClient({
          chain: sepolia,
          transport: http(),
        });
        await publicClient.waitForTransactionReceipt({
          hash: txHash,
        });
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

    describe('ARBITRUM_SEPOLIA', () => {
      const originChain = CHAIN.ARBITRUM_SEPOLIA;
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

        // Generate random account
        randomAccount = privateKeyToAccount(generatePrivateKey());
        // Try to send Arbitrum Sepolia ETH to random generated address
        const txHash = await walletClient.sendTransaction({
          to: randomAccount.address,
          chain: arbitrumSepolia,
          value: PushChain.utils.helpers.parseUnits('2', 15),
        });
        const publicClient = createPublicClient({
          chain: arbitrumSepolia,
          transport: http(),
        });
        await publicClient.waitForTransactionReceipt({
          hash: txHash,
        });
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

    describe('BASE_SEPOLIA', () => {
      const originChain = CHAIN.BASE_SEPOLIA;
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

        // Generate random account
        randomAccount = privateKeyToAccount(generatePrivateKey());
        // Try to send Base Sepolia ETH to random generated address
        const txHash = await walletClient.sendTransaction({
          to: randomAccount.address,
          chain: baseSepolia,
          value: PushChain.utils.helpers.parseUnits('2', 15),
        });
        const publicClient = createPublicClient({
          chain: baseSepolia,
          transport: http(),
        });
        await publicClient.waitForTransactionReceipt({
          hash: txHash,
        });
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

    describe('BNB_TESTNET', () => {
      const originChain = CHAIN.BNB_TESTNET;
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

        // Generate random account
        randomAccount = privateKeyToAccount(generatePrivateKey());
        // Try to send BNB Testnet ETH to random generated address
        const txHash = await walletClient.sendTransaction({
          to: randomAccount.address,
          chain: bscTestnet,
          value: PushChain.utils.helpers.parseUnits('2', 15),
        });
        const publicClient = createPublicClient({
          chain: bscTestnet,
          transport: http(),
        });
        await publicClient.waitForTransactionReceipt({
          hash: txHash,
        });
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
});
