import '@e2e/shared/setup';
import {
  privateKeyToAccount,
} from 'viem/accounts';
import { PUSH_NETWORK, CHAIN } from '../../src/lib/constants/enums';
import {
  createWalletClient,
  Hex,
  http,
} from 'viem';
import { Keypair } from '@solana/web3.js';
import { PushChain } from '../../src';
import { UniversalSigner } from '../../src/lib/universal/universal.types';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { sepolia } from 'viem/chains';
import bs58 from 'bs58';
import { txValidator } from '@e2e/shared/validators';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import {
  COUNTER_ADDRESS_PAYABLE,
  COUNTER_ABI_PAYABLE,
} from '@e2e/shared/inbound-helpers';

describe('Origin - Push', () => {
  const to = '0x35B84d6848D16415177c64D64504663b998A6ab4';
  let pushClient: PushChain;

  beforeAll(async () => {
    const privateKey = process.env['PUSH_PRIVATE_KEY'] as Hex;
    if (!privateKey) throw new Error('PUSH_PRIVATE_KEY not set');

    const setup = await createEvmPushClient({
      chain: CHAIN.PUSH_TESTNET_DONUT,
      privateKey,
      progressHook: (val) => console.log(val),
    });
    pushClient = setup.pushClient;
  });

  it('should sendTransaction', async () => {
    const from = pushClient.universal.account;
    const tx = await pushClient.universal.sendTransaction({
      to,
      value: BigInt(2),
    });
    await txValidator(tx, from, to);
  });

  // ==========================================================================
  // UTX-01: Value to Self
  // ==========================================================================
  it('should send value to own UEA (UTX-01)', async () => {
    const UEA = pushClient.universal.account;

    const tx = await pushClient.universal.sendTransaction({
      to: UEA,
      value: BigInt(1e3),
    });

    console.log(`TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);
  });

  // ==========================================================================
  // UTX-05: Data to Contract
  // ==========================================================================
  it('should send data-only to counter contract (UTX-05)', async () => {
    const incrementData = PushChain.utils.helpers.encodeTxData({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      abi: COUNTER_ABI_PAYABLE as any[],
      functionName: 'increment',
    });

    const tx = await pushClient.universal.sendTransaction({
      to: COUNTER_ADDRESS_PAYABLE,
      data: incrementData,
    });

    console.log(`TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);
  });

  // ==========================================================================
  // UTX-07: Value + Data to Contract
  // ==========================================================================
  it('should send value + data to counter contract (UTX-07)', async () => {
    const incrementData = PushChain.utils.helpers.encodeTxData({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      abi: COUNTER_ABI_PAYABLE as any[],
      functionName: 'increment',
    });

    const tx = await pushClient.universal.sendTransaction({
      to: COUNTER_ADDRESS_PAYABLE,
      value: BigInt(7),
      data: incrementData,
    });

    console.log(`TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);
  });

  // ==========================================================================
  // UTX-21: Multicall (no funds)
  // ==========================================================================
  it('should execute multicall without funds (UTX-21)', async () => {
    // Multicall on Push Chain sends individual txs per call — needs extra time
    const incrementData = PushChain.utils.helpers.encodeTxData({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      abi: COUNTER_ABI_PAYABLE as any[],
      functionName: 'increment',
    });

    const multicallData = [
      {
        to: COUNTER_ADDRESS_PAYABLE,
        value: BigInt(0),
        data: incrementData,
      },
      {
        to: COUNTER_ADDRESS_PAYABLE,
        value: BigInt(0),
        data: incrementData,
      },
    ];

    const tx = await pushClient.universal.sendTransaction({
      to: COUNTER_ADDRESS_PAYABLE,
      data: multicallData,
    });

    console.log(`TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);
  }, 30000);
});

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
      bs58.decode(privateKeySolana)
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
