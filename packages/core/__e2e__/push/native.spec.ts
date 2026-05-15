import '@e2e/shared/setup';
import {
  generatePrivateKey,
  privateKeyToAccount,
} from 'viem/accounts';
import { PUSH_NETWORK, CHAIN } from '../../src/lib/constants/enums';
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatUnits,
  Hex,
  http,
  parseEther,
} from 'viem';
import { Keypair } from '@solana/web3.js';
import { PushChain } from '../../src';
import { UniversalSigner } from '../../src/lib/universal/universal.types';
import { CHAIN_INFO, SYNTHETIC_PUSH_ERC20 } from '../../src/lib/constants/chain';
import { sepolia } from 'viem/chains';
import bs58 from 'bs58';
import { txValidator } from '@e2e/shared/validators';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { createProgressTracker } from '@e2e/shared/progress-tracker';
import { formatPc } from '../../src/lib/formatters';
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

// ============================================================================
// EOA → UEA Transfers
// EOA sending value to another EOA's UEA, and EOA sending value to its own UEA.
// Both use fresh wallets (undeployed UEAs) funded on origin + Push Chain.
// ============================================================================
describe('EOA → UEA Transfers', () => {
  const SEPOLIA_RPC_E2U = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];
  const PUSH_RPC_E2U = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0];

  const privateKeyE2U = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E_E2U = !privateKeyE2U;

  let mainPushClient: PushChain;
  let mainWalletClient: ReturnType<typeof createWalletClient>;

  const sepoliaPublicClient = createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC_E2U),
  });

  const pushPublicClient = createPublicClient({
    transport: http(PUSH_RPC_E2U),
  });

  beforeAll(async () => {
    if (skipE2E_E2U) return;

    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey: privateKeyE2U,
      progressHook: (v) => console.log('[main]', v.id, v.title),
    });
    mainPushClient = setup.pushClient;
    mainWalletClient = setup.walletClient;
  }, 120_000);

  it('should transfer value from random EOA to a different random UEA', async () => {
    if (skipE2E_E2U) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    const tracker = createProgressTracker();

    const senderKey = generatePrivateKey();
    const senderAccount = privateKeyToAccount(senderKey);
    console.log(`\nSender EOA: ${senderAccount.address}`);

    const fundSenderHash = await mainWalletClient.sendTransaction({
      to: senderAccount.address,
      value: BigInt(1e15),
      account: mainWalletClient.account!,
      chain: sepolia,
    });
    await sepoliaPublicClient.waitForTransactionReceipt({ hash: fundSenderHash });
    console.log(`Sender funded on Sepolia: ${fundSenderHash}`);

    const senderWalletClient = createWalletClient({
      account: senderAccount,
      chain: sepolia,
      transport: http(SEPOLIA_RPC_E2U),
    });
    const senderSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      senderWalletClient,
      {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );
    const senderPushClient = await PushChain.initialize(senderSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: tracker.hook,
    });
    const senderUEA = senderPushClient.universal.account;
    console.log(`Sender UEA: ${senderUEA}`);

    const receiverKey = generatePrivateKey();
    const receiverAccount = privateKeyToAccount(receiverKey);
    console.log(`Receiver EOA: ${receiverAccount.address}`);

    const receiverWalletClient = createWalletClient({
      account: receiverAccount,
      chain: sepolia,
      transport: http(SEPOLIA_RPC_E2U),
    });
    const receiverSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      receiverWalletClient,
      {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );
    const receiverUEA = await PushChain.utils.account.convertOriginToExecutor(
      receiverSigner.account,
      { onlyCompute: true }
    );
    console.log(`Receiver UEA: ${receiverUEA.address} (deployed: ${receiverUEA.deployed})`);

    const sendAmount = BigInt(100);
    console.log(`\nSending ${sendAmount} wei from sender UEA → receiver UEA...`);

    const tx = await senderPushClient.universal.sendTransaction({
      to: receiverUEA.address,
      value: sendAmount,
    });

    console.log(`TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
    expect(receipt.status).toBe(1);

    const receiverBalance = await pushPublicClient.getBalance({
      address: receiverUEA.address,
    });
    console.log(`Receiver UEA balance after transfer: ${receiverBalance} wei`);
    expect(receiverBalance).toBeGreaterThanOrEqual(sendAmount);

    console.log('\n=== Progress Events ===');
    for (const { event } of tracker.events) {
      console.log(`  [${event.id}] (${event.level}) ${event.title}: ${event.message}`);
    }
  }, 300_000);

  it('should transfer value from random EOA to its own UEA (self-transfer)', async () => {
    if (skipE2E_E2U) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    const tracker = createProgressTracker();

    const freshKey = generatePrivateKey();
    const freshAccount = privateKeyToAccount(freshKey);
    console.log(`\nFresh EOA: ${freshAccount.address}`);

    const fundHash = await mainWalletClient.sendTransaction({
      to: freshAccount.address,
      value: BigInt(1e15),
      account: mainWalletClient.account!,
      chain: sepolia,
    });
    await sepoliaPublicClient.waitForTransactionReceipt({ hash: fundHash });
    console.log(`Fresh wallet funded on Sepolia: ${fundHash}`);

    const freshWalletClient = createWalletClient({
      account: freshAccount,
      chain: sepolia,
      transport: http(SEPOLIA_RPC_E2U),
    });
    const freshSigner = await PushChain.utils.signer.toUniversalFromKeypair(
      freshWalletClient,
      {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      }
    );
    const freshPushClient = await PushChain.initialize(freshSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: tracker.hook,
    });
    const freshUEA = freshPushClient.universal.account;
    console.log(`Fresh UEA: ${freshUEA}`);

    const codeBefore = await pushPublicClient.getCode({ address: freshUEA });
    const balanceBefore = await pushPublicClient.getBalance({ address: freshUEA });
    console.log(`UEA deployed before: ${codeBefore !== undefined}`);
    console.log(`UEA balance before:  ${balanceBefore} wei`);

    const sendAmount = BigInt(1e3);
    console.log(`\nSending ${sendAmount} wei to self UEA...`);

    const tx = await freshPushClient.universal.sendTransaction({
      to: freshUEA,
      value: sendAmount,
    });

    console.log(`TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
    expect(receipt.status).toBe(1);

    const codeAfter = await pushPublicClient.getCode({ address: freshUEA });
    console.log(`UEA deployed after: ${codeAfter !== undefined}`);

    console.log('\n=== Progress Events ===');
    for (const { event } of tracker.events) {
      console.log(`  [${event.id}] (${event.level}) ${event.title}: ${event.message}`);
    }
  }, 300_000);
});

// ============================================================================
// Transfer ALL tokens from UEA to EOA (Push Chain native multicall)
// ============================================================================
describe('Transfer ALL tokens from UEA to EOA', () => {
  const PUSH_RPC_TALL = 'https://evm.donut.rpc.push.org/';
  const TOKENS_TALL = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT];

  const TOKEN_LIST: { name: string; address: `0x${string}`; decimals: number }[] = [
    { name: 'pETH', address: TOKENS_TALL.pETH, decimals: 18 },
    { name: 'pETH.base', address: TOKENS_TALL.pETH_BASE, decimals: 18 },
    { name: 'pETH.arb', address: TOKENS_TALL.pETH_ARB, decimals: 18 },
    { name: 'pBNB', address: TOKENS_TALL.pBNB, decimals: 18 },
    { name: 'pSOL', address: TOKENS_TALL.pSOL, decimals: 9 },
    { name: 'USDT.eth', address: TOKENS_TALL.USDT_ETH, decimals: 6 },
    { name: 'USDT.arb', address: TOKENS_TALL.USDT_ARB, decimals: 6 },
    { name: 'USDT.sol', address: TOKENS_TALL.USDT_SOL, decimals: 6 },
    { name: 'USDT.bsc', address: TOKENS_TALL.USDT_BNB, decimals: 6 },
    { name: 'USDT.base', address: TOKENS_TALL.USDT_BASE, decimals: 6 },
  ];

  const ERC20_ABI_TALL = [
    {
      type: 'function',
      name: 'balanceOf',
      inputs: [{ name: 'account', type: 'address' }],
      outputs: [{ name: '', type: 'uint256' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'transfer',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      outputs: [{ name: '', type: 'bool' }],
      stateMutability: 'nonpayable',
    },
  ] as const;

  const pushPublicClientTALL = createPublicClient({
    transport: http(PUSH_RPC_TALL),
  });

  const GAS_RESERVE = parseEther('1');

  let pushClientTALL: PushChain;
  let ueaAddressTALL: `0x${string}`;
  let eoaAddressTALL: `0x${string}`;

  const privateKeyTALL = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E_TALL = !privateKeyTALL;

  beforeAll(async () => {
    if (skipE2E_TALL) return;

    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey: privateKeyTALL,
      printTraces: true,
      progressHook: (val) => {
        console.log(`[${val.id}] ${val.title}`);
      },
    });
    pushClientTALL = setup.pushClient;
    eoaAddressTALL = setup.account.address;
    ueaAddressTALL = pushClientTALL.universal.account;
  }, 60000);

  it('should check all balances on UEA', async () => {
    if (skipE2E_TALL) return;

    console.log(`\nUEA: ${ueaAddressTALL}`);
    console.log(`EOA: ${eoaAddressTALL}`);

    const pcBalance = await pushPublicClientTALL.getBalance({
      address: ueaAddressTALL,
    });
    console.log(
      `\nNative PC: ${formatPc(pcBalance)} (reserve ${formatPc(GAS_RESERVE)} for gas)`
    );

    for (const token of TOKEN_LIST) {
      const balance = (await pushPublicClientTALL.readContract({
        address: token.address,
        abi: ERC20_ABI_TALL,
        functionName: 'balanceOf',
        args: [ueaAddressTALL],
      })) as bigint;
      console.log(
        `${token.name}: ${formatUnits(balance, token.decimals)} (${token.address})`
      );
    }
  }, 30000);

  it('should transfer ALL tokens from UEA to EOA', async () => {
    if (skipE2E_TALL) return;

    const balances: { name: string; address: `0x${string}`; balance: bigint; decimals: number }[] = [];

    for (const token of TOKEN_LIST) {
      const balance = (await pushPublicClientTALL.readContract({
        address: token.address,
        abi: ERC20_ABI_TALL,
        functionName: 'balanceOf',
        args: [ueaAddressTALL],
      })) as bigint;
      balances.push({ ...token, balance });
    }

    const pcBalance = await pushPublicClientTALL.getBalance({
      address: ueaAddressTALL,
    });
    const pcTransferAmount =
      pcBalance > GAS_RESERVE ? pcBalance - GAS_RESERVE : BigInt(0);

    const data: { to: `0x${string}`; value: bigint; data: `0x${string}` }[] = [];

    for (const t of balances) {
      if (t.balance === BigInt(0)) {
        console.log(`${t.name}: 0 — skipping`);
        continue;
      }
      console.log(
        `${t.name}: transferring ${formatUnits(t.balance, t.decimals)}`
      );
      data.push({
        to: t.address,
        value: BigInt(0),
        data: encodeFunctionData({
          abi: ERC20_ABI_TALL,
          functionName: 'transfer',
          args: [eoaAddressTALL, t.balance],
        }),
      });
    }

    if (pcTransferAmount > BigInt(0)) {
      console.log(`Native PC: transferring ${formatPc(pcTransferAmount)}`);
      data.push({
        to: eoaAddressTALL,
        value: pcTransferAmount,
        data: '0x' as `0x${string}`,
      });
    } else {
      console.log('Native PC: insufficient balance after gas reserve — skipping');
    }

    if (data.length === 0) {
      console.log('\nNothing to transfer');
      return;
    }

    console.log(`\nSending multicall with ${data.length} operations...`);

    const result = await pushClientTALL.universal.sendTransaction({
      to: ueaAddressTALL,
      data,
    });

    console.log(`\nTx hash: ${result.hash}`);

    console.log('\n--- After transfer ---');
    const pcAfter = await pushPublicClientTALL.getBalance({
      address: ueaAddressTALL,
    });
    console.log(`UEA Native PC: ${formatPc(pcAfter)}`);

    for (const token of TOKEN_LIST) {
      const ueaBal = (await pushPublicClientTALL.readContract({
        address: token.address,
        abi: ERC20_ABI_TALL,
        functionName: 'balanceOf',
        args: [ueaAddressTALL],
      })) as bigint;
      const eoaBal = (await pushPublicClientTALL.readContract({
        address: token.address,
        abi: ERC20_ABI_TALL,
        functionName: 'balanceOf',
        args: [eoaAddressTALL],
      })) as bigint;
      console.log(
        `${token.name} — UEA: ${formatUnits(ueaBal, token.decimals)}, EOA: ${formatUnits(eoaBal, token.decimals)}`
      );
    }
  }, 120000);
});
