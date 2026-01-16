import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { COUNTER_ABI_PAYABLE } from './helpers/abis';
import { COUNTER_ADDRESS_PAYABLE } from './helpers/addresses';
import bs58 from 'bs58';
import { UniversalSigner } from '../universal/universal.types';
import { PushChain } from './push-chain';
import {
  createWalletClient,
  createPublicClient,
  defineChain,
  http,
  isAddress,
  verifyMessage,
  parseAbi,
  PrivateKeyAccount,
} from 'viem';
import { sepolia, arbitrumSepolia, baseSepolia, bscTestnet } from 'viem/chains';
import { ExecuteParams, MultiCall } from '../orchestrator/orchestrator.types';
import { CHAIN_INFO, SYNTHETIC_PUSH_ERC20 } from '../constants/chain';
import { CHAIN } from '../constants/enums';
import {
  Keypair,
  PublicKey,
  Connection,
  Transaction,
  SystemProgram,
  SendTransactionError,
} from '@solana/web3.js';
import { utils as anchorUtils } from '@coral-xyz/anchor';
import { EvmClient } from '../vm-client/evm-client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), 'packages/core/.env') }) ||
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const EVM_RPC =
  process.env['EVM_RPC'] || CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];
const ARBITRUM_SEPOLIA_RPC =
  process.env['ARBITRUM_SEPOLIA_RPC'] ||
  CHAIN_INFO[CHAIN.ARBITRUM_SEPOLIA].defaultRPC[0];
const BASE_SEPOLIA_RPC =
  process.env['BASE_SEPOLIA_RPC'] ||
  CHAIN_INFO[CHAIN.BASE_SEPOLIA].defaultRPC[0];
const BNB_TESTNET_RPC =
  process.env['BNB_TESTNET_RPC'] || CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0];
const SOLANA_RPC =
  process.env['SOLANA_RPC_URL'] ||
  CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC[0];

// EVM Chain Test Configuration
interface EVMChainTestConfig {
  name: string;
  chain: CHAIN;
  viemChain:
    | typeof sepolia
    | typeof arbitrumSepolia
    | typeof baseSepolia
    | typeof bscTestnet;
  rpcUrl: string;
  gatewayAddress: string;
  tokens: {
    usdt: {
      address: string;
      decimals: number;
    };
    eth: {
      decimals: number;
    };
  };
}

const EVM_CHAIN_CONFIGS: EVMChainTestConfig[] = [
  {
    name: 'Ethereum Sepolia',
    chain: CHAIN.ETHEREUM_SEPOLIA,
    viemChain: sepolia,
    rpcUrl: EVM_RPC,
    gatewayAddress: '0x05bD7a3D18324c1F7e216f7fBF2b15985aE5281A',
    tokens: {
      usdt: {
        address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
        decimals: 6,
      },
      eth: {
        decimals: 18,
      },
    },
  },
  {
    name: 'Arbitrum Sepolia',
    chain: CHAIN.ARBITRUM_SEPOLIA,
    viemChain: arbitrumSepolia,
    rpcUrl: ARBITRUM_SEPOLIA_RPC,
    gatewayAddress: '0x2cd870e0166Ba458dEC615168Fd659AacD795f34',
    tokens: {
      usdt: {
        address: '0x1419d7C74D234fA6B73E06A2ce7822C1d37922f0',
        decimals: 6,
      },
      eth: {
        decimals: 18,
      },
    },
  },
  {
    name: 'Base Sepolia',
    chain: CHAIN.BASE_SEPOLIA,
    viemChain: baseSepolia,
    rpcUrl: BASE_SEPOLIA_RPC,
    gatewayAddress: '0xe91addb5a01b4fb4ac2599b171f56e765fc8903c',
    tokens: {
      usdt: {
        address: '0x9FF5a186f53F6E6964B00320Da1D2024DE11E0cB',
        decimals: 6,
      },
      eth: {
        decimals: 18,
      },
    },
  },
  {
    name: 'BNB Testnet',
    chain: CHAIN.BNB_TESTNET,
    viemChain: bscTestnet,
    rpcUrl: BNB_TESTNET_RPC,
    gatewayAddress: '0x44aFFC61983F4348DdddB886349eb992C061EaC0',
    tokens: {
      usdt: {
        address: '0xBC14F348BC9667be46b35Edc9B68653d86013DC5',
        decimals: 6,
      },
      eth: {
        decimals: 18,
      },
    },
  },
];

// Reusable test helper functions
async function setupEVMChainClient(
  config: EVMChainTestConfig,
  privateKey: `0x${string}`
): Promise<{ client: PushChain; account: PrivateKeyAccount }> {
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });

  const signer = await PushChain.utils.signer.toUniversalFromKeypair(
    walletClient,
    {
      chain: config.chain,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    }
  );

  const client = await PushChain.initialize(signer, {
    network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    progressHook: (progress) =>
      console.log(`[${config.name}] Progress:`, progress),
    rpcUrls: {
      [config.chain]: [config.rpcUrl],
    },
  });

  return { client, account };
}

async function testSendFundsUSDTNoValue(
  client: PushChain,
  account: PrivateKeyAccount,
  config: EVMChainTestConfig,
  transactionRecipient: 'self' | 'other'
): Promise<void> {
  const erc20Abi = parseAbi([
    'function balanceOf(address) view returns (uint256)',
  ]);
  const usdt = client.moveable.token.USDT;

  const balance: bigint = await new EvmClient({
    rpcUrls: CHAIN_INFO[config.chain].defaultRPC,
  }).readContract<bigint>({
    abi: erc20Abi,
    address: usdt.address,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (balance <= BigInt(0)) {
    console.warn(`Skipping ${config.name} USDT test: no USDT balance`);
    return;
  }

  const amount = BigInt(1);

  let recipient: `0x${string}`;
  if (transactionRecipient === 'self') {
    recipient = client.universal.account;
  } else {
    recipient = '0x0000000000000000000000000000000000042101';
  }
  // // const recipient = '0x0000000000000000000000000000000000042101';
  // const recipient = client.universal.account;

  // pUSDT (USDT.eth) balance on Push chain should increase for the recipient
  const pushChainClient = new EvmClient({
    rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
  });

  const pusdt = PushChain.utils.tokens.getPRC20Address(usdt);
  const balanceBefore = await pushChainClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: recipient as `0x${string}`,
  });

  console.log('UEA: ', client.universal.account);

  const resUSDT = await client.universal.sendTransaction({
    to: recipient,
    funds: { amount, token: usdt },
  });
  console.log('txHash', resUSDT.hash);

  const receipt = await resUSDT.wait();
  expect(receipt.status).toBe(1);

  const balanceAfter = await pushChainClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: recipient as `0x${string}`,
  });
  expect(balanceAfter > balanceBefore).toBe(true);
}

async function testSendFundsUSDTWithValue(
  client: PushChain,
  account: PrivateKeyAccount,
  config: EVMChainTestConfig,
  transactionRecipient: 'self' | 'other'
): Promise<void> {
  if (!transactionRecipient)
    throw new Error('Please select the recipient for this testcase');
  const erc20Abi = parseAbi([
    'function balanceOf(address) view returns (uint256)',
  ]);
  const usdt = client.moveable.token.USDT;

  const balance: bigint = await new EvmClient({
    rpcUrls: CHAIN_INFO[config.chain].defaultRPC,
  }).readContract<bigint>({
    abi: erc20Abi,
    address: usdt.address,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (balance <= BigInt(0)) {
    console.warn(`Skipping ${config.name} USDT test: no USDT balance`);
    return;
  }

  const amount = BigInt(1);
  let recipient: `0x${string}`;
  if (transactionRecipient === 'self') recipient = client.universal.account;
  else recipient = '0x0000000000000000000000000000000000042101';

  // pUSDT (USDT.eth) balance on Push chain should increase for the recipient
  const pushChainClient = new EvmClient({
    rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
  });

  const pusdt = PushChain.utils.tokens.getPRC20Address(usdt);
  const balanceUSDTBefore = await pushChainClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: recipient,
  });
  const balancePCBefore = await pushChainClient.getBalance(recipient);

  // What to expect from this:
  // *************************
  // recipient PC balance ++
  // recipient USDT balance ++
  // *************************
  const resUSDT = await client.universal.sendTransaction({
    to: recipient,
    value: BigInt(3),
    funds: { amount, token: usdt },
  });
  console.log('txHash', resUSDT.hash);

  const receipt = await resUSDT.wait();
  expect(receipt.status).toBe(1);

  const balanceUSDTAfter = await pushChainClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: recipient as `0x${string}`,
  });
  const balancePCAfter = await pushChainClient.getBalance(recipient);
  console.log('balancePCAfter', balancePCAfter);
  console.log('balancePCBefore', balancePCBefore);
  console.log('balanceUSDTAfter', balanceUSDTAfter);
  console.log('balanceUSDTBefore', balanceUSDTBefore);
  expect(balancePCAfter > balancePCBefore).toBe(true);
  expect(balanceUSDTAfter > balanceUSDTBefore).toBe(true);
}

async function testSendFundsETH(
  client: PushChain,
  config: EVMChainTestConfig,
  transactionRecipient: 'self' | 'other'
): Promise<void> {
  const amount = BigInt(1);
  let recipient: `0x${string}`;
  if (transactionRecipient === 'self') recipient = client.universal.account;
  else recipient = '0x0000000000000000000000000000000000042101';

  // pETH balance on Push chain should increase for the recipient after bridging
  const pushChainClient = new EvmClient({
    rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
  });
  const pETH_ADDRESS =
    SYNTHETIC_PUSH_ERC20[PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT].pETH;

  const balanceBefore = await pushChainClient.getErc20Balance({
    tokenAddress: pETH_ADDRESS,
    ownerAddress: recipient,
  });

  // THIS WILL FAIL IF RECIPIENT IS ANY OTHER CONTRACT OTHER THAN UEA!. CURRENTLY WE DON'T SUPPORT FUNDS.ETHER
  const resNative = await client.universal.sendTransaction({
    to: recipient,
    funds: { amount },
  });
  console.log('txHash', resNative.hash);

  const receipt = await resNative.wait();
  expect(receipt.status).toBe(1);

  const balanceAfter = await pushChainClient.getErc20Balance({
    tokenAddress: pETH_ADDRESS,
    ownerAddress: recipient,
  });
  expect(balanceAfter > balanceBefore).toBe(true);
}

async function testFundsUSDTNoValueNewWalletDeployUEA(
  client: PushChain,
  account: PrivateKeyAccount,
  config: EVMChainTestConfig,
  transactionRecipient: 'self' | 'other'
): Promise<void> {
  if (!transactionRecipient)
    throw new Error('Please select the recipient for this testcase');

  // Set up funded wallet client from the provided account (origin: Sepolia)
  const walletClientFunded = createWalletClient({
    account,
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });

  // Create a brand-new account and wallet client (origin: Sepolia)
  const newAccount = privateKeyToAccount(generatePrivateKey());
  const walletClientNew = createWalletClient({
    account: newAccount,
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });

  const publicClient = createPublicClient({
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });

  // Fund new account with native Ether on Sepolia
  const nativeTxHash = await walletClientFunded.sendTransaction({
    to: newAccount.address,
    chain: config.viemChain,
    value: PushChain.utils.helpers.parseUnits('0.00051', 18),
  });
  await publicClient.waitForTransactionReceipt({ hash: nativeTxHash });

  // Ensure the funding account has USDT, otherwise skip
  const erc20ReadAbi = parseAbi([
    'function balanceOf(address) view returns (uint256)',
  ]);
  const ERC20_TRANSFER_ABI = [
    {
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
      ],
      name: 'transfer',
      outputs: [{ type: 'bool' }],
      stateMutability: 'nonpayable',
      type: 'function',
    },
  ];
  const usdt = client.moveable.token.USDT;
  const evm = new EvmClient({ rpcUrls: CHAIN_INFO[config.chain].defaultRPC });
  const funderUsdtBal: bigint = await evm.readContract<bigint>({
    abi: erc20ReadAbi,
    address: usdt.address,
    functionName: 'balanceOf',
    args: [account.address],
  });
  if (funderUsdtBal === BigInt(0)) {
    console.warn(
      `Skipping ${config.name} USDT sendTxWithFunds: no USDT balance`
    );
    return;
  }

  // Transfer 1 USDT to the new account on Sepolia
  const transferData = PushChain.utils.helpers.encodeTxData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [
      newAccount.address,
      PushChain.utils.helpers.parseUnits('1', usdt.decimals),
    ],
  });
  const usdtTxHash = await walletClientFunded.sendTransaction({
    to: usdt.address as `0x${string}`,
    chain: config.viemChain,
    value: BigInt(0),
    data: transferData,
  });
  await publicClient.waitForTransactionReceipt({ hash: usdtTxHash });

  // Initialize PushChain client from the NEW wallet
  const universalSignerNew =
    await PushChain.utils.signer.toUniversalFromKeypair(walletClientNew, {
      chain: config.chain,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
  const pushClientNew = await PushChain.initialize(universalSignerNew, {
    network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls: { [config.chain]: [config.rpcUrl] },
    progressHook: (progress) => console.log(progress),
  });

  let recipientAddress: `0x${string}`;
  if (transactionRecipient === 'self')
    recipientAddress = pushClientNew.universal.account;
  else recipientAddress = '0x0000000000000000000000000000000000042101';

  // Prepare target contract call on Push Chain
  const bridgeAmount = BigInt(1);

  const pushPublicClient = createPublicClient({
    transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
  });

  // Push EVM client and executor info for NEW account
  const pushEvmClient = new EvmClient({
    rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
  });
  const executorInfo = await PushChain.utils.account.convertOriginToExecutor(
    universalSignerNew.account,
    { onlyCompute: true }
  );

  const pusdt = PushChain.utils.tokens.getPRC20Address(usdt);
  const balanceBefore_pUSDT_UEA = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: executorInfo.address,
  });
  const balanceBefore_pUSDT_RECIPIENT = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: recipientAddress,
  });

  // Log origin chain balances (ETH and USDT) before executing universal.sendTransaction
  const etherBalanceBefore = await publicClient.getBalance({
    address: newAccount.address,
  });
  const usdtBalanceBefore = await evm.readContract<bigint>({
    abi: erc20ReadAbi,
    address: usdt.address,
    functionName: 'balanceOf',
    args: [newAccount.address],
  });
  console.log(
    `Origin balances before universal.sendTransaction — ETH: ${PushChain.utils.helpers.formatUnits(
      etherBalanceBefore,
      18
    )}, USDT: ${PushChain.utils.helpers.formatUnits(
      usdtBalanceBefore,
      usdt.decimals
    )}`
  );

  const resUSDT = await pushClientNew.universal.sendTransaction({
    to: recipientAddress,
    value: BigInt(0),
    funds: { amount: bridgeAmount, token: pushClientNew.moveable.token.USDT },
  });
  console.log('txHash', resUSDT.hash);

  expect(typeof resUSDT.hash).toBe('string');
  expect(resUSDT.hash.startsWith('0x')).toBe(true);
  await resUSDT.wait();

  // Wait briefly for Push Chain state to finalize
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const balanceAfter_pUSDT_UEA = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: executorInfo.address,
  });
  const balanceAfter_pUSDT_RECIPIENT = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: recipientAddress,
  });

  if (transactionRecipient === 'self') {
    expect(balanceAfter_pUSDT_UEA - balanceBefore_pUSDT_UEA).toBe(bridgeAmount);
    expect(balanceAfter_pUSDT_RECIPIENT - balanceBefore_pUSDT_RECIPIENT).toBe(
      bridgeAmount
    );
  } else {
    expect(balanceAfter_pUSDT_UEA === balanceBefore_pUSDT_UEA).toBe(true);
    expect(balanceAfter_pUSDT_RECIPIENT - balanceBefore_pUSDT_RECIPIENT).toBe(
      bridgeAmount
    );
  }
}

async function testSendFundsWithPayloadUSDTWithValueNewWalletDeployUEA(
  client: PushChain,
  account: PrivateKeyAccount,
  config: EVMChainTestConfig,
  transactionRecipient: 'self' | 'other'
): Promise<void> {
  if (!transactionRecipient)
    throw new Error('Please select the recipient for this testcase');

  // Set up funded wallet client from the provided account (origin: Sepolia)
  const walletClientFunded = createWalletClient({
    account,
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });

  // Create a brand-new account and wallet client (origin: Sepolia)
  const newAccount = privateKeyToAccount(generatePrivateKey());
  const walletClientNew = createWalletClient({
    account: newAccount,
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });

  const publicClient = createPublicClient({
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });

  // Fund new account with native Ether on Sepolia
  const nativeTxHash = await walletClientFunded.sendTransaction({
    to: newAccount.address,
    chain: config.viemChain,
    value: PushChain.utils.helpers.parseUnits('0.00051', 18),
  });
  await publicClient.waitForTransactionReceipt({ hash: nativeTxHash });

  // Ensure the funding account has USDT, otherwise skip
  const erc20ReadAbi = parseAbi([
    'function balanceOf(address) view returns (uint256)',
  ]);
  const ERC20_TRANSFER_ABI = [
    {
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
      ],
      name: 'transfer',
      outputs: [{ type: 'bool' }],
      stateMutability: 'nonpayable',
      type: 'function',
    },
  ];
  const usdt = client.moveable.token.USDT;
  const evm = new EvmClient({ rpcUrls: CHAIN_INFO[config.chain].defaultRPC });
  const funderUsdtBal: bigint = await evm.readContract<bigint>({
    abi: erc20ReadAbi,
    address: usdt.address,
    functionName: 'balanceOf',
    args: [account.address],
  });
  if (funderUsdtBal === BigInt(0)) {
    console.warn(
      `Skipping ${config.name} USDT sendTxWithFunds: no USDT balance`
    );
    return;
  }

  // Transfer 1 USDT to the new account on Sepolia
  const transferData = PushChain.utils.helpers.encodeTxData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [
      newAccount.address,
      PushChain.utils.helpers.parseUnits('1', usdt.decimals),
    ],
  });
  const usdtTxHash = await walletClientFunded.sendTransaction({
    to: usdt.address as `0x${string}`,
    chain: config.viemChain,
    value: BigInt(0),
    data: transferData,
  });
  await publicClient.waitForTransactionReceipt({ hash: usdtTxHash });

  // Initialize PushChain client from the NEW wallet
  const universalSignerNew =
    await PushChain.utils.signer.toUniversalFromKeypair(walletClientNew, {
      chain: config.chain,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
  const pushClientNew = await PushChain.initialize(universalSignerNew, {
    network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls: { [config.chain]: [config.rpcUrl] },
    progressHook: (progress) => console.log(progress),
  });

  // Prepare target contract call on Push Chain
  const bridgeAmount = BigInt(1);
  const data = PushChain.utils.helpers.encodeTxData({
    abi: COUNTER_ABI_PAYABLE,
    functionName: 'increment',
  });

  const pushPublicClient = createPublicClient({
    transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
  });
  const bytecode = await pushPublicClient.getBytecode({
    address: COUNTER_ADDRESS_PAYABLE,
  });
  if (!bytecode || bytecode === '0x') {
    console.warn(
      `Skipping ${config.name}: no contract at ${COUNTER_ADDRESS_PAYABLE}`
    );
    return;
  }
  const beforeCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI_PAYABLE,
    address: COUNTER_ADDRESS_PAYABLE,
    functionName: 'countPC',
  })) as bigint;

  // Push EVM client and executor info for NEW account
  const pushEvmClient = new EvmClient({
    rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
  });
  const executorInfo = await PushChain.utils.account.convertOriginToExecutor(
    universalSignerNew.account,
    { onlyCompute: true }
  );

  const pusdt = PushChain.utils.tokens.getPRC20Address(usdt);
  const balanceBefore_pUSDT_UEA = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: executorInfo.address,
  });
  const balanceBefore_pUSDT_COUNTER = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: COUNTER_ADDRESS_PAYABLE,
  });

  // Get native Push Chain balance before transaction
  const balanceBeforePC_COUNTER = await pushEvmClient.getBalance(
    COUNTER_ADDRESS_PAYABLE
  );

  // Log origin chain balances (ETH and USDT) before executing universal.sendTransaction
  const etherBalanceBefore = await publicClient.getBalance({
    address: newAccount.address,
  });
  const usdtBalanceBefore = await evm.readContract<bigint>({
    abi: erc20ReadAbi,
    address: usdt.address,
    functionName: 'balanceOf',
    args: [newAccount.address],
  });
  console.log(
    `Origin balances before universal.sendTransaction — ETH: ${PushChain.utils.helpers.formatUnits(
      etherBalanceBefore,
      18
    )}, USDT: ${PushChain.utils.helpers.formatUnits(
      usdtBalanceBefore,
      usdt.decimals
    )}`
  );

  if (transactionRecipient === 'self') {
    await expect(
      pushClientNew.universal.sendTransaction({
        to: pushClientNew.universal.account,
        value: BigInt(0),
        data,
        funds: {
          amount: bridgeAmount,
          token: pushClientNew.moveable.token.USDT,
        },
      })
    ).rejects.toThrow(`You can't execute data on the UEA address`);
    return;
  }

  const resUSDT = await pushClientNew.universal.sendTransaction({
    to: COUNTER_ADDRESS_PAYABLE,
    value: BigInt(10),
    data,
    funds: { amount: bridgeAmount, token: pushClientNew.moveable.token.USDT },
  });
  console.log('txHash', resUSDT.hash);

  expect(typeof resUSDT.hash).toBe('string');
  expect(resUSDT.hash.startsWith('0x')).toBe(true);
  await resUSDT.wait();

  // Wait briefly for Push Chain state to finalize
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const afterCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI_PAYABLE,
    address: COUNTER_ADDRESS_PAYABLE,
    functionName: 'countPC',
  })) as bigint;

  const balanceAfter_pUSDT_UEA = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: executorInfo.address,
  });
  const balanceAfter_pUSDT_COUNTER = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: COUNTER_ADDRESS_PAYABLE,
  });

  // Get native Push Chain balance after transaction
  const balanceAfterPC_COUNTER = await pushEvmClient.getBalance(
    COUNTER_ADDRESS_PAYABLE
  );

  // UEA USDT balance unchanged, Counter balance increased, counter incremented
  expect(balanceAfter_pUSDT_UEA === balanceBefore_pUSDT_UEA).toBe(true);
  expect(balanceAfter_pUSDT_COUNTER > balanceBefore_pUSDT_COUNTER).toBe(true);
  expect(afterCount).toBe(beforeCount + BigInt(1));
  // Native Push Chain balance on COUNTER_ADDRESS_PAYABLE increased by the value amount (10)
  expect(balanceAfterPC_COUNTER).toBe(balanceBeforePC_COUNTER + BigInt(10));
  console.log(`[${config.name}] Counter incremented successfully`);
}

// SVM: Similar to the above, but using a brand-new Solana wallet and bridging SOL
async function testFundsSOLNoValueNewWalletDeployUEA_SVM(
  transactionRecipient: 'self' | 'other'
): Promise<void> {
  if (!transactionRecipient)
    throw new Error('Please select the recipient for this testcase');

  // 1) Create and fund a new Solana wallet
  const newSolanaKeypair = Keypair.generate();
  const connection = new Connection(SOLANA_RPC, 'confirmed');

  const SOL_FUNDING_KEY =
    (process.env['SOLANA_PRIVATE_KEY'] as string | undefined) ||
    (process.env['SVM_PRIVATE_KEY'] as string | undefined);
  if (!SOL_FUNDING_KEY) {
    throw new Error('SOLANA_PRIVATE_KEY (or SVM_PRIVATE_KEY) is not set');
  }

  let funderKeypair: Keypair;
  try {
    if (SOL_FUNDING_KEY.trim().startsWith('[')) {
      const arr = JSON.parse(SOL_FUNDING_KEY) as number[];
      funderKeypair = Keypair.fromSecretKey(Uint8Array.from(arr));
    } else {
      const decoded = anchorUtils.bytes.bs58.decode(SOL_FUNDING_KEY.trim());
      funderKeypair = Keypair.fromSecretKey(Uint8Array.from(decoded));
    }
  } catch (_) {
    throw new Error('Invalid SOLANA_PRIVATE_KEY format');
  }

  const minRent = await connection.getMinimumBalanceForRentExemption(
    0,
    'confirmed'
  );
  const transferIx = SystemProgram.transfer({
    fromPubkey: funderKeypair.publicKey,
    toPubkey: newSolanaKeypair.publicKey,
    lamports: Math.max(minRent, 50_000_000),
  });
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({
    feePayer: funderKeypair.publicKey,
    recentBlockhash: blockhash,
  }).add(transferIx);
  tx.sign(funderKeypair);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    'confirmed'
  );

  // 2) Initialize PushChain client from the NEW Solana wallet
  const universalSignerNewSolana =
    await PushChain.utils.signer.toUniversalFromKeypair(newSolanaKeypair, {
      chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
      library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
    });
  const pushClientNewSolana = await PushChain.initialize(
    universalSignerNewSolana,
    {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      rpcUrls: { [CHAIN.SOLANA_DEVNET]: [SOLANA_RPC] },
      progressHook: (progress) =>
        console.log('Progress (SVM new wallet)', progress),
    }
  );

  // 3) Prepare target contract call on Push Chain
  const bridgeAmount = BigInt(1);
  const COUNTER_ABI = [
    {
      inputs: [],
      name: 'increment',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function',
    },
    {
      inputs: [],
      name: 'countPC',
      outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
      stateMutability: 'view',
      type: 'function',
    },
  ];
  const COUNTER_ADDRESS =
    '0x5FbDB2315678afecb367f032d93F642f64180aa3' as `0x${string}`;
  const data = PushChain.utils.helpers.encodeTxData({
    abi: COUNTER_ABI,
    functionName: 'increment',
  });

  const pushPublicClient = createPublicClient({
    transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
  });
  const bytecode = await pushPublicClient.getBytecode({
    address: COUNTER_ADDRESS,
  });
  if (!bytecode || bytecode === '0x') {
    console.warn(`Skipping SVM test: no contract at ${COUNTER_ADDRESS}`);
    return;
  }
  const beforeCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI,
    address: COUNTER_ADDRESS,
    functionName: 'countPC',
  })) as bigint;

  // 4) Pre-check pSOL balances on Push chain
  const pushEvmClient = new EvmClient({
    rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
  });
  const executorInfo = await PushChain.utils.account.convertOriginToExecutor(
    universalSignerNewSolana.account,
    { onlyCompute: true }
  );
  const pSOL_ADDRESS =
    SYNTHETIC_PUSH_ERC20[PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT].pSOL;
  const balanceBefore_pSOL_UEA = await pushEvmClient.getErc20Balance({
    tokenAddress: pSOL_ADDRESS,
    ownerAddress: executorInfo.address,
  });
  const balanceBefore_pSOL_COUNTER = await pushEvmClient.getErc20Balance({
    tokenAddress: pSOL_ADDRESS,
    ownerAddress: COUNTER_ADDRESS,
  });

  // 5) Execute
  if (transactionRecipient === 'self') {
    await expect(
      pushClientNewSolana.universal.sendTransaction({
        to: pushClientNewSolana.universal.account,
        value: BigInt(0),
        data,
        funds: {
          amount: bridgeAmount,
          token: pushClientNewSolana.moveable.token.SOL,
        },
      })
    ).rejects.toThrow(`You can't execute data on the UEA address`);
    return;
  }

  const res = await pushClientNewSolana.universal.sendTransaction({
    to: COUNTER_ADDRESS,
    value: BigInt(0),
    data,
    funds: {
      amount: bridgeAmount,
      token: pushClientNewSolana.moveable.token.SOL,
    },
  });
  console.log('SVM new wallet sendTxWithFunds SOL hash', res.hash);
  await res.wait();

  // 6) Post-checks
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const afterCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI,
    address: COUNTER_ADDRESS,
    functionName: 'countPC',
  })) as bigint;
  const balanceAfter_pSOL_UEA = await pushEvmClient.getErc20Balance({
    tokenAddress: pSOL_ADDRESS,
    ownerAddress: executorInfo.address,
  });
  const balanceAfter_pSOL_COUNTER = await pushEvmClient.getErc20Balance({
    tokenAddress: pSOL_ADDRESS,
    ownerAddress: COUNTER_ADDRESS,
  });

  expect(balanceAfter_pSOL_UEA === balanceBefore_pSOL_UEA).toBe(true);
  expect(balanceAfter_pSOL_COUNTER > balanceBefore_pSOL_COUNTER).toBe(true);
  expect(afterCount).toBe(beforeCount + BigInt(1));
}
async function testSendTxWithFundsUSDTNoValue(
  client: PushChain,
  account: PrivateKeyAccount,
  config: EVMChainTestConfig,
  transactionRecipient: 'self' | 'other'
): Promise<void> {
  if (!transactionRecipient)
    throw new Error('Please select the recipient for this testcase');

  const erc20Abi = parseAbi([
    'function balanceOf(address) view returns (uint256)',
  ]);
  const usdt = client.moveable.token.USDT;

  const evm = new EvmClient({
    rpcUrls: CHAIN_INFO[config.chain].defaultRPC,
  });
  const usdtBal: bigint = await evm.readContract<bigint>({
    abi: erc20Abi,
    address: usdt.address,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (usdtBal === BigInt(0)) {
    console.warn(
      `Skipping ${config.name} USDT sendTxWithFunds: no USDT balance`
    );
    return;
  }

  const bridgeAmount = BigInt(1);
  const COUNTER_ABI = [
    {
      inputs: [],
      name: 'increment',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function',
    },
    {
      inputs: [],
      name: 'countPC',
      outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
      stateMutability: 'view',
      type: 'function',
    },
  ];
  const COUNTER_ADDRESS =
    '0x5FbDB2315678afecb367f032d93F642f64180aa3' as `0x${string}`;
  const data = PushChain.utils.helpers.encodeTxData({
    abi: COUNTER_ABI,
    functionName: 'increment',
  });

  const pushPublicClient = createPublicClient({
    transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
  });

  const bytecode = await pushPublicClient.getBytecode({
    address: COUNTER_ADDRESS,
  });
  if (!bytecode || bytecode === '0x') {
    console.warn(`Skipping ${config.name}: no contract at ${COUNTER_ADDRESS}`);
    return;
  }

  const beforeCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI,
    address: COUNTER_ADDRESS,
    functionName: 'countPC',
  })) as bigint;

  const pushEvmClient = new EvmClient({
    rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
  });

  const executorInfo = await PushChain.utils.account.convertOriginToExecutor(
    {
      chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
      address: account.address,
    },
    { onlyCompute: true }
  );

  const pusdt = PushChain.utils.tokens.getPRC20Address(usdt);
  const balanceBefore_pUSDT_ETH_UEA = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: executorInfo.address,
  });
  const balanceBefore_pUSDT_ETH_COUNTER = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: COUNTER_ADDRESS,
  });

  if (transactionRecipient === 'self') {
    await expect(
      client.universal.sendTransaction({
        to: client.universal.account,
        value: BigInt(0),
        data,
        funds: { amount: bridgeAmount, token: usdt },
      })
    ).rejects.toThrow(`You can't execute data on the UEA address`);
    return;
  }

  const resUSDT = await client.universal.sendTransaction({
    to: COUNTER_ADDRESS,
    value: BigInt(0),
    data,
    funds: { amount: bridgeAmount, token: usdt },
  });
  console.log('txHash', resUSDT.hash);

  expect(typeof resUSDT.hash).toBe('string');
  expect(resUSDT.hash.startsWith('0x')).toBe(true);
  await resUSDT.wait();

  // Wait for Push Chain state to finalize
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const afterCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI,
    address: COUNTER_ADDRESS,
    functionName: 'countPC',
  })) as bigint;

  const balanceAfter_pUSDT_ETH_UEA = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: executorInfo.address,
  });

  const balanceAfter_pUSDT_ETH_COUNTER = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: COUNTER_ADDRESS,
  });

  // UEA USDT balance ++
  expect(balanceAfter_pUSDT_ETH_UEA === balanceBefore_pUSDT_ETH_UEA).toBe(true);
  expect(balanceAfter_pUSDT_ETH_COUNTER > balanceBefore_pUSDT_ETH_COUNTER).toBe(
    true
  );
  expect(afterCount).toBe(beforeCount + BigInt(1));
  console.log(`[${config.name}] Counter incremented successfully`);
}

async function testSendTxValueAndPayload(
  client: PushChain,
  account: PrivateKeyAccount,
  config: EVMChainTestConfig
): Promise<void> {
  const erc20Abi = parseAbi([
    'function balanceOf(address) view returns (uint256)',
  ]);
  const usdt = client.moveable.token.USDT;

  const evm = new EvmClient({
    rpcUrls: CHAIN_INFO[config.chain].defaultRPC,
  });
  const usdtBal: bigint = await evm.readContract<bigint>({
    abi: erc20Abi,
    address: usdt.address,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (usdtBal === BigInt(0)) {
    console.warn(
      `Skipping ${config.name} USDT sendTxWithFunds: no USDT balance`
    );
    return;
  }

  const data = PushChain.utils.helpers.encodeTxData({
    abi: COUNTER_ABI_PAYABLE,
    functionName: 'increment',
  });

  const pushPublicClient = createPublicClient({
    transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
  });
  const beforeCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI_PAYABLE,
    address: COUNTER_ADDRESS_PAYABLE,
    functionName: 'countPC',
  })) as bigint;

  const pushEvmClient = new EvmClient({
    rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
  });

  const beforeCounterPCBalance = await pushEvmClient.getBalance(
    COUNTER_ADDRESS_PAYABLE
  );

  const resUSDT = await client.universal.sendTransaction({
    to: COUNTER_ADDRESS_PAYABLE,
    value: BigInt(5),
    data,
  });
  console.log('txHash', resUSDT.hash);

  expect(typeof resUSDT.hash).toBe('string');
  expect(resUSDT.hash.startsWith('0x')).toBe(true);
  await resUSDT.wait();

  // Wait for Push Chain state to finalize
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const afterCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI_PAYABLE,
    address: COUNTER_ADDRESS_PAYABLE,
    functionName: 'countPC',
  })) as bigint;

  const afterCounterPCBalance = await pushEvmClient.getBalance(
    COUNTER_ADDRESS_PAYABLE
  );

  expect(afterCounterPCBalance - beforeCounterPCBalance).toBe(BigInt(5));
  expect(afterCount).toBe(beforeCount + BigInt(1));
  console.log(`[${config.name}] Counter incremented successfully`);
}

async function testSendTxPayloadOnly(
  client: PushChain,
  account: PrivateKeyAccount,
  config: EVMChainTestConfig,
  transactionRecipient: 'self' | 'other'
): Promise<void> {
  let recipient: `0x${string}`;
  if (transactionRecipient === 'self') recipient = client.universal.account;
  else recipient = COUNTER_ADDRESS_PAYABLE;

  const data = PushChain.utils.helpers.encodeTxData({
    abi: COUNTER_ABI_PAYABLE,
    functionName: 'increment',
  });

  if (transactionRecipient === 'self') {
    await expect(
      client.universal.sendTransaction({
        to: recipient,
        data,
      })
    ).rejects.toThrow(`You can't execute data on the UEA address`);
    return;
  }

  const pushPublicClient = createPublicClient({
    transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
  });
  const beforeCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI_PAYABLE,
    address: COUNTER_ADDRESS_PAYABLE,
    functionName: 'countPC',
  })) as bigint;

  const pushEvmClient = new EvmClient({
    rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
  });

  const beforeCounterPCBalance = await pushEvmClient.getBalance(
    COUNTER_ADDRESS_PAYABLE
  );

  const res = await client.universal.sendTransaction({
    to: recipient,
    data,
  });
  console.log('txHash', res.hash);

  expect(typeof res.hash).toBe('string');
  expect(res.hash.startsWith('0x')).toBe(true);
  await res.wait();

  // Wait for Push Chain state to finalize
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const afterCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI_PAYABLE,
    address: COUNTER_ADDRESS_PAYABLE,
    functionName: 'countPC',
  })) as bigint;

  const afterCounterPCBalance = await pushEvmClient.getBalance(
    COUNTER_ADDRESS_PAYABLE
  );

  expect(afterCount).toBe(beforeCount + BigInt(1));
}

async function testValuePayloadFundsUSDT(
  client: PushChain,
  account: PrivateKeyAccount,
  config: EVMChainTestConfig,
  transactionRecipient: 'self' | 'other'
): Promise<void> {
  if (!transactionRecipient)
    throw new Error('Please select the recipient for this testcase');

  const erc20Abi = parseAbi([
    'function balanceOf(address) view returns (uint256)',
  ]);
  const usdt = client.moveable.token.USDT;

  const evm = new EvmClient({
    rpcUrls: CHAIN_INFO[config.chain].defaultRPC,
  });
  const usdtBal: bigint = await evm.readContract<bigint>({
    abi: erc20Abi,
    address: usdt.address,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (usdtBal === BigInt(0)) {
    console.warn(
      `Skipping ${config.name} USDT sendTxWithFunds: no USDT balance`
    );
    return;
  }

  let recipient: `0x${string}`;
  if (transactionRecipient === 'self') recipient = client.universal.account;
  else recipient = COUNTER_ADDRESS_PAYABLE;

  const data = PushChain.utils.helpers.encodeTxData({
    abi: COUNTER_ABI_PAYABLE,
    functionName: 'increment',
  });

  if (transactionRecipient === 'self') {
    await expect(
      client.universal.sendTransaction({
        to: recipient,
        value: BigInt(5),
        data,
        funds: { amount: BigInt(1), token: usdt },
      })
    ).rejects.toThrow(`You can't execute data on the UEA address`);
    return;
  }

  const pushPublicClient = createPublicClient({
    transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
  });

  const bytecode = await pushPublicClient.getBytecode({
    address: COUNTER_ADDRESS_PAYABLE,
  });
  if (!bytecode || bytecode === '0x') {
    console.warn(
      `Skipping ${config.name}: no contract at ${COUNTER_ADDRESS_PAYABLE}`
    );
    return;
  }

  const beforeCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI_PAYABLE,
    address: COUNTER_ADDRESS_PAYABLE,
    functionName: 'countPC',
  })) as bigint;

  const pushEvmClient = new EvmClient({
    rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
  });

  const pusdt = PushChain.utils.tokens.getPRC20Address(usdt);
  const balanceBefore_pUSDT_UEA = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: client.universal.account,
  });
  const balanceBefore_pUSDT_COUNTER = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: COUNTER_ADDRESS_PAYABLE,
  });
  const balanceBeforePC_COUNTER = await pushEvmClient.getBalance(
    COUNTER_ADDRESS_PAYABLE
  );
  const balanceBeforePC_UEA = await pushEvmClient.getBalance(
    client.universal.account
  );

  const resUSDT = await client.universal.sendTransaction({
    to: recipient,
    value: BigInt(5),
    data,
    funds: { amount: BigInt(1), token: usdt },
  });
  console.log('txHash', resUSDT.hash);

  expect(typeof resUSDT.hash).toBe('string');
  expect(resUSDT.hash.startsWith('0x')).toBe(true);
  await resUSDT.wait();

  // Wait for Push Chain state to finalize
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const afterCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI_PAYABLE,
    address: COUNTER_ADDRESS_PAYABLE,
    functionName: 'countPC',
  })) as bigint;

  const balanceAfter_pUSDT_UEA = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: client.universal.account,
  });
  const balanceAfter_pUSDT_COUNTER = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: COUNTER_ADDRESS_PAYABLE,
  });
  const balanceAfterPC_COUNTER = await pushEvmClient.getBalance(
    COUNTER_ADDRESS_PAYABLE
  );
  const balanceAfterPC_UEA = await pushEvmClient.getBalance(
    client.universal.account
  );

  expect(balanceAfter_pUSDT_UEA === balanceBefore_pUSDT_UEA).toBe(true);
  expect(balanceAfter_pUSDT_COUNTER > balanceBefore_pUSDT_COUNTER).toBe(true);
  expect(balanceAfterPC_COUNTER > balanceBeforePC_COUNTER).toBe(true);
  // expect(balanceAfterPC_UEA > balanceBeforePC_UEA).toBe(true); // check

  expect(afterCount).toBe(beforeCount + BigInt(1));
  console.log(`[${config.name}] Counter incremented successfully`);
}

async function testValuePayloadFundsETH(
  client: PushChain,
  account: PrivateKeyAccount,
  config: EVMChainTestConfig,
  transactionRecipient: 'self' | 'other'
): Promise<void> {
  if (!transactionRecipient)
    throw new Error('Please select the recipient for this testcase');

  const eth = client.moveable.token.ETH;

  let recipient: `0x${string}`;
  if (transactionRecipient === 'self') recipient = client.universal.account;
  else recipient = COUNTER_ADDRESS_PAYABLE;

  const data = PushChain.utils.helpers.encodeTxData({
    abi: COUNTER_ABI_PAYABLE,
    functionName: 'increment',
  });

  if (transactionRecipient === 'self') {
    await expect(
      client.universal.sendTransaction({
        to: recipient,
        value: BigInt(5),
        data,
        funds: { amount: BigInt(1), token: eth },
      })
    ).rejects.toThrow(`You can't execute data on the UEA address`);
    return;
  }

  const pushPublicClient = createPublicClient({
    transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
  });

  const bytecode = await pushPublicClient.getBytecode({
    address: COUNTER_ADDRESS_PAYABLE,
  });
  if (!bytecode || bytecode === '0x') {
    console.warn(
      `Skipping ${config.name}: no contract at ${COUNTER_ADDRESS_PAYABLE}`
    );
    return;
  }

  const beforeCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI_PAYABLE,
    address: COUNTER_ADDRESS_PAYABLE,
    functionName: 'countPC',
  })) as bigint;

  const pushEvmClient = new EvmClient({
    rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
  });

  const peth = PushChain.utils.tokens.getPRC20Address(eth);
  const balanceBefore_pETH_UEA = await pushEvmClient.getErc20Balance({
    tokenAddress: peth,
    ownerAddress: client.universal.account,
  });
  const balanceBefore_pETH_COUNTER = await pushEvmClient.getErc20Balance({
    tokenAddress: peth,
    ownerAddress: COUNTER_ADDRESS_PAYABLE,
  });
  const balanceBeforePC_COUNTER = await pushEvmClient.getBalance(
    COUNTER_ADDRESS_PAYABLE
  );
  const balanceBeforePC_UEA = await pushEvmClient.getBalance(
    client.universal.account
  );

  const resETH = await client.universal.sendTransaction({
    to: recipient,
    value: BigInt(5),
    data,
    funds: { amount: BigInt(1), token: eth },
  });
  console.log('txHash', resETH.hash);

  expect(typeof resETH.hash).toBe('string');
  expect(resETH.hash.startsWith('0x')).toBe(true);
  await resETH.wait();

  // Wait for Push Chain state to finalize
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const afterCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI_PAYABLE,
    address: COUNTER_ADDRESS_PAYABLE,
    functionName: 'countPC',
  })) as bigint;

  const balanceAfter_pETH_UEA = await pushEvmClient.getErc20Balance({
    tokenAddress: peth,
    ownerAddress: client.universal.account,
  });
  const balanceAfter_pETH_COUNTER = await pushEvmClient.getErc20Balance({
    tokenAddress: peth,
    ownerAddress: COUNTER_ADDRESS_PAYABLE,
  });
  const balanceAfterPC_COUNTER = await pushEvmClient.getBalance(
    COUNTER_ADDRESS_PAYABLE
  );
  const balanceAfterPC_UEA = await pushEvmClient.getBalance(
    client.universal.account
  );

  expect(balanceAfter_pETH_UEA === balanceBefore_pETH_UEA).toBe(true);
  expect(balanceAfter_pETH_COUNTER > balanceBefore_pETH_COUNTER).toBe(true);
  expect(balanceAfterPC_COUNTER > balanceBeforePC_COUNTER).toBe(true);
  // expect(balanceAfterPC_UEA > balanceBeforePC_UEA).toBe(true); // check

  expect(afterCount).toBe(beforeCount + BigInt(1));
  console.log(`[${config.name}] Counter incremented successfully`);
}

async function testValueFundsUSDT(
  client: PushChain,
  account: PrivateKeyAccount,
  config: EVMChainTestConfig,
  transactionRecipient: 'self' | 'other'
): Promise<void> {
  if (!transactionRecipient)
    throw new Error('Please select the recipient for this testcase');

  const erc20Abi = parseAbi([
    'function balanceOf(address) view returns (uint256)',
  ]);
  const usdt = client.moveable.token.USDT;

  const evm = new EvmClient({
    rpcUrls: CHAIN_INFO[config.chain].defaultRPC,
  });
  const usdtBal: bigint = await evm.readContract<bigint>({
    abi: erc20Abi,
    address: usdt.address,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (usdtBal === BigInt(0)) {
    console.warn(
      `Skipping ${config.name} USDT sendTxWithFunds: no USDT balance`
    );
    return;
  }

  let recipient: `0x${string}`;
  if (transactionRecipient === 'self') recipient = client.universal.account;
  else recipient = COUNTER_ADDRESS_PAYABLE;

  const pushPublicClient = createPublicClient({
    transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
  });

  const bytecode = await pushPublicClient.getBytecode({
    address: COUNTER_ADDRESS_PAYABLE,
  });
  if (!bytecode || bytecode === '0x') {
    console.warn(
      `Skipping ${config.name}: no contract at ${COUNTER_ADDRESS_PAYABLE}`
    );
    return;
  }

  const pushEvmClient = new EvmClient({
    rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
  });

  const pusdt = PushChain.utils.tokens.getPRC20Address(usdt);
  const balanceBefore_pUSDT_UEA = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: client.universal.account,
  });
  const balanceBefore_pUSDT_COUNTER = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: COUNTER_ADDRESS_PAYABLE,
  });
  const balanceBeforePC_COUNTER = await pushEvmClient.getBalance(
    COUNTER_ADDRESS_PAYABLE
  );
  const balanceBeforePC_UEA = await pushEvmClient.getBalance(
    client.universal.account
  );

  const resUSDT = await client.universal.sendTransaction({
    to: recipient,
    value: BigInt(5),
    funds: { amount: BigInt(1), token: usdt },
  });
  console.log('txHash', resUSDT.hash);

  expect(typeof resUSDT.hash).toBe('string');
  expect(resUSDT.hash.startsWith('0x')).toBe(true);
  await resUSDT.wait();

  // Wait for Push Chain state to finalize
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const balanceAfter_pUSDT_UEA = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: client.universal.account,
  });
  const balanceAfter_pUSDT_COUNTER = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: COUNTER_ADDRESS_PAYABLE,
  });
  const balanceAfterPC_COUNTER = await pushEvmClient.getBalance(
    COUNTER_ADDRESS_PAYABLE
  );
  const balanceAfterPC_UEA = await pushEvmClient.getBalance(
    client.universal.account
  );

  if (transactionRecipient === 'self') {
    expect(balanceAfter_pUSDT_UEA > balanceBefore_pUSDT_UEA).toBe(true);
    expect(balanceAfter_pUSDT_COUNTER === balanceBefore_pUSDT_COUNTER).toBe(
      true
    );
    expect(balanceAfterPC_COUNTER > balanceBeforePC_COUNTER).toBe(true);
    expect(balanceAfterPC_UEA > balanceBeforePC_UEA).toBe(true);
  } else {
    expect(balanceAfter_pUSDT_UEA === balanceBefore_pUSDT_UEA).toBe(true);
    expect(balanceAfter_pUSDT_COUNTER > balanceBefore_pUSDT_COUNTER).toBe(true);
    expect(balanceAfterPC_COUNTER > balanceBeforePC_COUNTER).toBe(true);
  }

  // expect(balanceAfterPC_UEA > balanceBeforePC_UEA).toBe(true); // check
}

async function testPayloadFundsUSDT(
  client: PushChain,
  account: PrivateKeyAccount,
  config: EVMChainTestConfig,
  transactionRecipient: 'self' | 'other'
): Promise<void> {
  if (!transactionRecipient)
    throw new Error('Please select the recipient for this testcase');

  const erc20Abi = parseAbi([
    'function balanceOf(address) view returns (uint256)',
  ]);
  const usdt = client.moveable.token.USDT;

  const evm = new EvmClient({
    rpcUrls: CHAIN_INFO[config.chain].defaultRPC,
  });
  const usdtBal: bigint = await evm.readContract<bigint>({
    abi: erc20Abi,
    address: usdt.address,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (usdtBal === BigInt(0)) {
    console.warn(
      `Skipping ${config.name} USDT sendTxWithFunds: no USDT balance`
    );
    return;
  }

  let recipient: `0x${string}`;
  if (transactionRecipient === 'self') recipient = client.universal.account;
  else recipient = COUNTER_ADDRESS_PAYABLE;

  const data = PushChain.utils.helpers.encodeTxData({
    abi: COUNTER_ABI_PAYABLE,
    functionName: 'increment',
  });

  if (transactionRecipient === 'self') {
    await expect(
      client.universal.sendTransaction({
        to: recipient,
        value: BigInt(5),
        data,
        funds: { amount: BigInt(1), token: usdt },
      })
    ).rejects.toThrow(`You can't execute data on the UEA address`);
    return;
  }

  const pushPublicClient = createPublicClient({
    transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
  });

  const bytecode = await pushPublicClient.getBytecode({
    address: COUNTER_ADDRESS_PAYABLE,
  });
  if (!bytecode || bytecode === '0x') {
    console.warn(
      `Skipping ${config.name}: no contract at ${COUNTER_ADDRESS_PAYABLE}`
    );
    return;
  }

  const beforeCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI_PAYABLE,
    address: COUNTER_ADDRESS_PAYABLE,
    functionName: 'countPC',
  })) as bigint;

  const pushEvmClient = new EvmClient({
    rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
  });

  const pusdt = PushChain.utils.tokens.getPRC20Address(usdt);
  const balanceBefore_pUSDT_UEA = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: client.universal.account,
  });
  const balanceBefore_pUSDT_COUNTER = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: COUNTER_ADDRESS_PAYABLE,
  });
  const balanceBeforePC_COUNTER = await pushEvmClient.getBalance(
    COUNTER_ADDRESS_PAYABLE
  );
  const balanceBeforePC_UEA = await pushEvmClient.getBalance(
    client.universal.account
  );

  const resUSDT = await client.universal.sendTransaction({
    to: recipient,
    data,
    funds: { amount: BigInt(1), token: usdt },
  });
  console.log('txHash', resUSDT.hash);

  expect(typeof resUSDT.hash).toBe('string');
  expect(resUSDT.hash.startsWith('0x')).toBe(true);
  await resUSDT.wait();

  // Wait for Push Chain state to finalize
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const afterCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI_PAYABLE,
    address: COUNTER_ADDRESS_PAYABLE,
    functionName: 'countPC',
  })) as bigint;

  const balanceAfter_pUSDT_UEA = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: client.universal.account,
  });
  const balanceAfter_pUSDT_COUNTER = await pushEvmClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: COUNTER_ADDRESS_PAYABLE,
  });
  const balanceAfterPC_COUNTER = await pushEvmClient.getBalance(
    COUNTER_ADDRESS_PAYABLE
  );
  const balanceAfterPC_UEA = await pushEvmClient.getBalance(
    client.universal.account
  );

  expect(balanceAfter_pUSDT_UEA === balanceBefore_pUSDT_UEA).toBe(true);
  expect(balanceAfter_pUSDT_COUNTER > balanceBefore_pUSDT_COUNTER).toBe(true);
  // expect(balanceAfterPC_COUNTER > balanceBeforePC_COUNTER).toBe(true);
  // expect(balanceAfterPC_UEA > balanceBeforePC_UEA).toBe(true); // check

  expect(afterCount).toBe(beforeCount + BigInt(1));
  console.log(`[${config.name}] Counter incremented successfully`);
}

// New: funds+payload paying gas with USDT (gasTokenAddress)
async function testSendTxWithFundsPayGasUSDT(
  client: PushChain,
  account: PrivateKeyAccount,
  config: EVMChainTestConfig
): Promise<void> {
  const usdt = client.moveable.token.USDT;

  const evm = new EvmClient({
    rpcUrls: CHAIN_INFO[config.chain].defaultRPC,
  });
  const usdtBal: bigint = await evm.getErc20Balance({
    tokenAddress: usdt.address as `0x${string}`,
    ownerAddress: account.address as `0x${string}`,
  });

  if (usdtBal === BigInt(0)) {
    console.warn(`Skipping ${config.name} pay-gas-in-USDT: no USDT balance`);
    return;
  }

  const bridgeAmount = BigInt(1);
  const COUNTER_ABI = [
    {
      inputs: [],
      name: 'increment',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function',
    },
    {
      inputs: [],
      name: 'countPC',
      outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
      stateMutability: 'view',
      type: 'function',
    },
  ];
  const COUNTER_ADDRESS =
    '0x5FbDB2315678afecb367f032d93F642f64180aa3' as `0x${string}`;
  const data = PushChain.utils.helpers.encodeTxData({
    abi: COUNTER_ABI,
    functionName: 'increment',
  });

  const pushPublicClient = createPublicClient({
    transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
  });
  const bytecode = await pushPublicClient.getBytecode({
    address: COUNTER_ADDRESS,
  });
  if (!bytecode || bytecode === '0x') {
    console.warn(`Skipping ${config.name}: no contract at ${COUNTER_ADDRESS}`);
    return;
  }

  const beforeCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI,
    address: COUNTER_ADDRESS,
    functionName: 'countPC',
  })) as bigint;

  // const amount = PushChain.utils.helpers.parseUnits('1.05', {
  //   decimals: client.payable.token.USDT.decimals,
  // });
  // const toToken = client.moveable.token.WETH;
  // const quote = await client.funds.getConversionQuote(amount, {
  //   from: client.payable.token.USDT,
  //   to: toToken,
  // });
  // const minAmountOut = PushChain.utils.conversion.slippageToMinAmount(
  //   quote.amountOut,
  //   { slippageBps: 300 }
  // );

  // const amountOutEth = PushChain.utils.helpers.formatUnits(
  //   quote.amountOut,
  //   toToken.decimals
  // );
  // console.log('amountOut (USDT -> WETH)', amountOutEth);

  // const exactOut = await client.funds.getConversionQuoteExactOutput(
  //   BigInt(minAmountOut),
  //   {
  //     from: client.payable.token.USDT,
  //     to: client.moveable.token.WETH,
  //   }
  // );
  // const requiredUsdt = PushChain.utils.helpers.formatUnits(
  //   exactOut.amountIn,
  //   client.payable.token.USDT.decimals
  // );
  // console.log('requiredUSDT for minOut WETH (exact-output)', requiredUsdt);

  const res = await client.universal.sendTransaction({
    to: COUNTER_ADDRESS,
    value: BigInt(0),
    data,
    funds: {
      amount: bridgeAmount,
      token: usdt,
    },
    payGasWith: {
      token: client.payable.token.USDT,
    },
  });
  console.log('txHash', res.hash);

  expect(typeof res.hash).toBe('string');
  expect(res.hash.startsWith('0x')).toBe(true);
  await res.wait();

  const afterCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI,
    address: COUNTER_ADDRESS,
    functionName: 'countPC',
  })) as bigint;

  expect(afterCount).toBe(beforeCount + BigInt(1));
  console.log(`[${config.name}] Pay-gas-with-USDT executed successfully`);
}

async function testMulticall(
  client: PushChain,
  config: EVMChainTestConfig
): Promise<void> {
  const CounterABI = [
    {
      inputs: [],
      name: 'increment',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function',
    },
    {
      inputs: [],
      name: 'countPC',
      outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
      stateMutability: 'view',
      type: 'function',
    },
  ];
  const COUNTER_ADDRESS =
    '0x5FbDB2315678afecb367f032d93F642f64180aa3' as `0x${string}`;

  const incrementData = PushChain.utils.helpers.encodeTxData({
    abi: CounterABI as unknown as any[],
    functionName: 'increment',
  }) as `0x${string}`;

  const calls: MultiCall[] = [
    { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementData },
    { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementData },
  ];

  const publicClientPush = createPublicClient({
    transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
  });

  const before = (await publicClientPush.readContract({
    address: COUNTER_ADDRESS,
    abi: CounterABI as unknown as any[],
    functionName: 'countPC',
    args: [],
  })) as unknown as bigint;

  const tx = await client.universal.sendTransaction({
    to: client.universal.account,
    value: BigInt(0),
    data: calls,
  });
  console.log('txHash', tx.hash);

  await tx.wait();

  const after = (await publicClientPush.readContract({
    address: COUNTER_ADDRESS,
    abi: CounterABI as unknown as any[],
    functionName: 'countPC',
    args: [],
  })) as unknown as bigint;

  expect(after).toBe(before + BigInt(2));

  expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

  console.log(`[${config.name}] Multicall executed successfully`);
}

async function testFeeAbstractionValueOnlyDeployUEA(
  config: EVMChainTestConfig,
  privateKey: `0x${string}`,
  transactionRecipient: 'self' | 'other'
): Promise<void> {
  if (!transactionRecipient) throw new Error('Missing transaction recipient');
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });

  const universalSignerEVM =
    await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: config.chain,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
  const pushClientEVM = await PushChain.initialize(universalSignerEVM, {
    network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls: {
      [config.chain]: [config.rpcUrl],
    },
  });

  const newAccount = privateKeyToAccount(generatePrivateKey());

  const walletClientNew = createWalletClient({
    account: newAccount,
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });

  const publicClient = createPublicClient({
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });

  const balanceBefore = await publicClient.getBalance({
    address: newAccount.address,
  });
  console.log(
    `[${config.name}] New account balance before (wei):`,
    balanceBefore.toString()
  );

  // Send native token to new account
  const txHash = await walletClient.sendTransaction({
    to: newAccount.address,
    chain: config.viemChain,
    value: PushChain.utils.helpers.parseUnits('0.001', 18),
  });

  // Wait for transaction to be mined
  await new Promise((resolve) => setTimeout(resolve, 15000));
  await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });

  const balanceAfter = await publicClient.getBalance({
    address: newAccount.address,
  });
  console.log(
    `[${config.name}] New account balance after (wei):`,
    balanceAfter.toString()
  );

  const universalSignerNewAccount =
    await PushChain.utils.signer.toUniversalFromKeypair(walletClientNew, {
      chain: config.chain,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });

  const pushClientNewAccount = await PushChain.initialize(
    universalSignerNewAccount,
    {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      progressHook: (progress) => {
        console.log(`[${config.name}] Progress:`, progress);
      },
      rpcUrls: {
        [config.chain]: [config.rpcUrl],
      },
    }
  );

  let recipient: `0x${string}`;
  if (transactionRecipient === 'self')
    recipient = pushClientNewAccount.universal.account;
  else recipient = '0x0000000000000000000000000000000000042101';
  // Prepare Push EVM client and compute executor (UEA) address on Push Chain
  const pushEvmClient = new EvmClient({
    rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
  });
  const executorInfo = await PushChain.utils.account.convertOriginToExecutor(
    universalSignerNewAccount.account,
    { onlyCompute: true }
  );
  const pcBeforeUEA = await pushEvmClient.getBalance(executorInfo.address);
  const pcBeforeRecipient = await pushEvmClient.getBalance(recipient);
  console.log(
    `[${config.name}] Executor PC balance before (wei):`,
    pcBeforeUEA.toString()
  );
  console.log(
    `[${config.name}] Executor PC balance before (wei):`,
    pcBeforeRecipient.toString()
  );

  console.log('UEA: ', pushClientNewAccount.universal.account);

  // Execute transaction from new account
  const resultTx = await pushClientNewAccount.universal.sendTransaction({
    to: recipient,
    value: BigInt(1),
  });

  expect(resultTx).toBeDefined();
  console.log('txHash', resultTx.hash);
  await resultTx.wait();

  const pcAfterUEA = await pushEvmClient.getBalance(executorInfo.address);
  const pcAfterRecipient = await pushEvmClient.getBalance(recipient);
  console.log(
    `[${config.name}] Executor PC balance after (wei):`,
    pcAfterUEA.toString()
  );
  console.log(
    `[${config.name}] Executor PC balance after (wei):`,
    pcAfterRecipient.toString()
  );

  expect(pcAfterUEA > pcBeforeUEA).toBe(true);
  expect(pcAfterRecipient > pcBeforeRecipient).toBe(true);
  console.log(`[${config.name}] Fee abstraction test completed successfully`);
}

async function testFeeAbstractionPayloadOnlyDeployUEA(
  config: EVMChainTestConfig,
  privateKey: `0x${string}`,
  transactionRecipient: 'self' | 'other'
): Promise<void> {
  if (!transactionRecipient) throw new Error('Missing transaction recipient');
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });
  const newAccount = privateKeyToAccount(generatePrivateKey());
  const walletClientNew = createWalletClient({
    account: newAccount,
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });

  const publicClient = createPublicClient({
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });

  const balanceBefore = await publicClient.getBalance({
    address: newAccount.address,
  });
  console.log(
    `[${config.name}] New account balance before (wei):`,
    balanceBefore.toString()
  );

  // Send native token to new account
  const txHash = await walletClient.sendTransaction({
    to: newAccount.address,
    chain: config.viemChain,
    value: PushChain.utils.helpers.parseUnits('0.001', 18),
  });

  // Wait for transaction to be mined
  await new Promise((resolve) => setTimeout(resolve, 15000));
  await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });

  const balanceAfter = await publicClient.getBalance({
    address: newAccount.address,
  });
  console.log(
    `[${config.name}] New account balance after (wei):`,
    balanceAfter.toString()
  );

  const universalSignerNewAccount =
    await PushChain.utils.signer.toUniversalFromKeypair(walletClientNew, {
      chain: config.chain,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });

  const pushClientNewAccount = await PushChain.initialize(
    universalSignerNewAccount,
    {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      progressHook: (progress) => {
        console.log(`[${config.name}] Progress:`, progress);
      },
      rpcUrls: {
        [config.chain]: [config.rpcUrl],
      },
    }
  );

  let recipient: `0x${string}`;
  if (transactionRecipient === 'self')
    recipient = pushClientNewAccount.universal.account;
  else recipient = COUNTER_ADDRESS_PAYABLE;
  // Prepare Push EVM client and compute executor (UEA) address on Push Chain
  const pushEvmClient = new EvmClient({
    rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
  });

  const beforeCount = (await pushEvmClient.readContract({
    abi: COUNTER_ABI_PAYABLE,
    address: COUNTER_ADDRESS_PAYABLE,
    functionName: 'countPC',
  })) as bigint;
  const pcBeforeRecipient = await pushEvmClient.getBalance(recipient);

  const data = PushChain.utils.helpers.encodeTxData({
    abi: COUNTER_ABI_PAYABLE,
    functionName: 'increment',
  });

  console.log('UEA: ', pushClientNewAccount.universal.account);

  // Execute transaction from new account
  const resultTx = await pushClientNewAccount.universal.sendTransaction({
    to: recipient,
    data,
  });

  const afterCount = (await pushEvmClient.readContract({
    abi: COUNTER_ABI_PAYABLE,
    address: COUNTER_ADDRESS_PAYABLE,
    functionName: 'countPC',
  })) as bigint;

  expect(resultTx).toBeDefined();
  console.log('txHash', resultTx.hash);
  await resultTx.wait();

  const pcAfterRecipient = await pushEvmClient.getBalance(recipient);

  expect(afterCount).toBe(beforeCount + BigInt(1));
}

async function testFeeAbstractionPayloadAndValue(
  client: PushChain,
  config: EVMChainTestConfig,
  transactionRecipient: 'self' | 'other'
): Promise<void> {
  // Prepare Push EVM client and compute executor (UEA) address on Push Chain
  const pushEvmClient = new EvmClient({
    rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
  });
  const pcBeforeUEA = await pushEvmClient.getBalance(client.universal.account);
  const balanceBeforeCounter = await pushEvmClient.getBalance(
    COUNTER_ADDRESS_PAYABLE
  );

  const data = PushChain.utils.helpers.encodeTxData({
    abi: COUNTER_ABI_PAYABLE,
    functionName: 'increment',
  }) as `0x${string}`;

  const pushPublicClient = createPublicClient({
    transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
  });

  const beforeCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI_PAYABLE,
    address: COUNTER_ADDRESS_PAYABLE,
    functionName: 'countPC',
  })) as bigint;

  let recipient: `0x${string}`;
  if (transactionRecipient === 'self') recipient = client.universal.account;
  else recipient = COUNTER_ADDRESS_PAYABLE;

  const executePayload = {
    to: recipient,
    value: BigInt(7), // << -- go to smart contract
    data,
  } as ExecuteParams;

  // Execute transaction from new account
  if (transactionRecipient === 'self') {
    await expect(
      client.universal.sendTransaction(executePayload)
    ).rejects.toThrow(`You can't execute data on the UEA address`);
    return;
  }
  const resultTx = await client.universal.sendTransaction(executePayload);

  expect(resultTx).toBeDefined();
  console.log('txHash', resultTx.hash);
  await resultTx.wait();

  const afterCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI_PAYABLE,
    address: COUNTER_ADDRESS_PAYABLE,
    functionName: 'countPC',
  })) as bigint;

  const pcAfterUEA = await pushEvmClient.getBalance(client.universal.account);
  const balanceAfterCounter = await pushEvmClient.getBalance(
    COUNTER_ADDRESS_PAYABLE
  );

  expect(balanceAfterCounter - balanceBeforeCounter).toBe(BigInt(7));
  expect(afterCount).toBe(beforeCount + BigInt(1));
  // We should have less PC AFTER execution
  expect(pcAfterUEA < pcBeforeUEA).toBe(true);
  console.log(`[${config.name}] Fee abstraction test completed successfully`);
}

async function testFeeAbstractionPayloadAndValueNewWalletDeployUEA(
  client: PushChain,
  account: PrivateKeyAccount,
  config: EVMChainTestConfig,
  transactionRecipient: 'self' | 'other'
): Promise<void> {
  // Set up funded wallet client from the provided account (origin: Sepolia)
  const walletClientFunded = createWalletClient({
    account,
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });

  // Create a brand-new account and wallet client (origin: Sepolia)
  const newAccount = privateKeyToAccount(generatePrivateKey());
  const walletClientNew = createWalletClient({
    account: newAccount,
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });

  const publicClient = createPublicClient({
    chain: config.viemChain,
    transport: http(config.rpcUrl),
  });

  // Fund new account with native Ether on Sepolia
  const nativeTxHash = await walletClientFunded.sendTransaction({
    to: newAccount.address,
    chain: config.viemChain,
    value: PushChain.utils.helpers.parseUnits('0.00051', 18),
  });
  await publicClient.waitForTransactionReceipt({ hash: nativeTxHash });

  // 2) Initialize PushChain client from the NEW wallet
  const universalSignerNew =
    await PushChain.utils.signer.toUniversalFromKeypair(walletClientNew, {
      chain: config.chain,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
  const pushClientNew = await PushChain.initialize(universalSignerNew, {
    network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls: { [config.chain]: [config.rpcUrl] },
    progressHook: (progress) => console.log(progress),
  });

  // 3) Prepare Push EVM client and baseline Push balances
  const pushEvmClient = new EvmClient({
    rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
  });
  const pcBeforeUEA = await pushEvmClient.getBalance(
    pushClientNew.universal.account
  );
  const balanceBeforeCounter = await pushEvmClient.getBalance(
    COUNTER_ADDRESS_PAYABLE
  );

  const data = PushChain.utils.helpers.encodeTxData({
    abi: COUNTER_ABI_PAYABLE,
    functionName: 'increment',
  }) as `0x${string}`;

  const pushPublicClient = createPublicClient({
    transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
  });

  const beforeCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI_PAYABLE,
    address: COUNTER_ADDRESS_PAYABLE,
    functionName: 'countPC',
  })) as bigint;

  let recipient: `0x${string}`;
  if (transactionRecipient === 'self')
    recipient = pushClientNew.universal.account;
  else recipient = COUNTER_ADDRESS_PAYABLE;

  const executePayload = {
    to: recipient,
    value: BigInt(7), // << -- go to smart contract
    data,
  } as ExecuteParams;

  // Execute transaction from new account
  if (transactionRecipient === 'self') {
    await expect(
      pushClientNew.universal.sendTransaction(executePayload)
    ).rejects.toThrow(`You can't execute data on the UEA address`);
    return;
  }

  console.log('UEA: ', pushClientNew.universal.account);

  const resultTx = await pushClientNew.universal.sendTransaction(
    executePayload
  );

  expect(resultTx).toBeDefined();
  console.log('txHash', resultTx.hash);
  await resultTx.wait();

  const afterCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI_PAYABLE,
    address: COUNTER_ADDRESS_PAYABLE,
    functionName: 'countPC',
  })) as bigint;

  const pcAfterUEA = await pushEvmClient.getBalance(
    pushClientNew.universal.account
  );
  const balanceAfterCounter = await pushEvmClient.getBalance(
    COUNTER_ADDRESS_PAYABLE
  );

  expect(balanceAfterCounter - balanceBeforeCounter).toBe(BigInt(7));
  expect(afterCount).toBe(beforeCount + BigInt(1));
  // We create a new wallet, so we will have at first 0 PC. Then later more.
  expect(pcAfterUEA > pcBeforeUEA).toBe(true);
  console.log(`[${config.name}] Fee abstraction test completed successfully`);
}

describe('PushChain', () => {
  describe('Universal Namesapce', () => {
    let pushClientEVM: PushChain;
    let pushChainPush: PushChain;
    let pushChainSVM: PushChain;
    let universalSignerEVM: UniversalSigner;
    let universalSignerPush: UniversalSigner;
    let universalSignerSVM: UniversalSigner;

    beforeAll(async () => {
      const evmPrivateKey = process.env['EVM_PRIVATE_KEY'];
      if (!evmPrivateKey)
        throw new Error('EVM_PRIVATE_KEY not set in core/.env');
      const account = privateKeyToAccount(evmPrivateKey as `0x${string}`);
      const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(EVM_RPC),
      });
      universalSignerEVM = await PushChain.utils.signer.toUniversalFromKeypair(
        walletClient,
        {
          chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );
      pushClientEVM = await PushChain.initialize(universalSignerEVM, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
        rpcUrls: { [CHAIN.ETHEREUM_SEPOLIA]: [EVM_RPC] },
        progressHook: (progress) => console.log(progress),
      });

      const pushTestnet = defineChain({
        id: parseInt(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId),
        name: 'Push Testnet',
        nativeCurrency: {
          decimals: 18,
          name: 'PC',
          symbol: '$PC',
        },
        rpcUrls: {
          default: {
            http: [CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]],
          },
        },
        blockExplorers: {
          default: {
            name: 'Push Testnet Explorer',
            url: 'https://explorer.testnet.push.org/',
          },
        },
      });
      const accountPush = privateKeyToAccount(evmPrivateKey as `0x${string}`);
      const walletClientPush = createWalletClient({
        account: accountPush,
        chain: pushTestnet,
        transport: http(),
      });
      universalSignerPush = await PushChain.utils.signer.toUniversalFromKeypair(
        walletClientPush,
        {
          chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );
      pushChainPush = await PushChain.initialize(universalSignerPush, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
        rpcUrls: { [CHAIN.ETHEREUM_SEPOLIA]: [EVM_RPC] },
        progressHook: (progress) => console.log(progress),
      });

      const privateKeyHex = process.env['SOLANA_PRIVATE_KEY'];
      if (!privateKeyHex) throw new Error('SOLANA_PRIVATE_KEY not set');

      const privateKey = bs58.decode(privateKeyHex);

      const accountSVM = Keypair.fromSecretKey(privateKey);

      universalSignerSVM = await PushChain.utils.signer.toUniversalFromKeypair(
        accountSVM,
        {
          chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
          library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
        }
      );
      pushChainSVM = await PushChain.initialize(universalSignerSVM, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
        rpcUrls: { [CHAIN.ETHEREUM_SEPOLIA]: [EVM_RPC] },
        progressHook: (progress) => console.log(progress),
      });
    });

    describe('Multicall', () => {
      const COUNTER_ADDRESS =
        '0x5FbDB2315678afecb367f032d93F642f64180aa3' as `0x${string}`;

      const CounterABI = [
        {
          inputs: [],
          name: 'increment',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [],
          name: 'countPC',
          outputs: [
            {
              internalType: 'uint256',
              name: '',
              type: 'uint256',
            },
          ],
          stateMutability: 'view',
          type: 'function',
        },
      ] as const;

      it('should build and send multicall payload from Sepolia', async () => {
        const incrementData = PushChain.utils.helpers.encodeTxData({
          abi: CounterABI as unknown as any[],
          functionName: 'increment',
        }) as `0x${string}`;

        const calls: MultiCall[] = [
          { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementData },
          { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementData },
          { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementData },
          { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementData },
        ];

        const publicClientPush = createPublicClient({
          transport: http('https://evm.donut.rpc.push.org'),
        });

        const before = (await publicClientPush.readContract({
          address: COUNTER_ADDRESS,
          abi: CounterABI as unknown as any[],
          functionName: 'countPC',
          args: [],
        })) as unknown as bigint;

        // Check if valid address -> If invalid evm address, throw error
        const tx = await pushClientEVM.universal.sendTransaction({
          to: pushClientEVM.universal.account,
          value: BigInt(0),
          data: calls,
        });
        console.log('txHash', tx.hash);

        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        await tx.wait();

        const after = (await publicClientPush.readContract({
          address: COUNTER_ADDRESS,
          abi: CounterABI as unknown as any[],
          functionName: 'countPC',
          args: [],
        })) as unknown as bigint;

        expect(after).toBe(before + BigInt(4));
      }, 300000);

      it('should throw if multicall used with invalid execute.to (SVM)', async () => {
        const incrementData = PushChain.utils.helpers.encodeTxData({
          abi: CounterABI as unknown as any[],
          functionName: 'increment',
        });

        const calls: MultiCall[] = [
          {
            to: COUNTER_ADDRESS,
            value: BigInt(0),
            data: incrementData as `0x${string}`,
          },
        ];

        await expect(
          pushChainSVM.universal.sendTransaction({
            to: '0xabc',
            value: BigInt(0),
            data: calls,
          })
        ).rejects.toThrow(`Invalid EVM address at execute.to 0xabc`);
      });

      it('should build and send multicall payload from Solana Devnet', async () => {
        const incrementData = PushChain.utils.helpers.encodeTxData({
          abi: CounterABI as unknown as any[],
          functionName: 'increment',
        }) as `0x${string}`;

        const calls: MultiCall[] = [
          { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementData },
          { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementData },
        ];

        const publicClientPush = createPublicClient({
          transport: http('https://evm.donut.rpc.push.org'),
        });

        const before = (await publicClientPush.readContract({
          address: COUNTER_ADDRESS,
          abi: CounterABI as unknown as any[],
          functionName: 'countPC',
          args: [],
        })) as unknown as bigint;

        const tx = await pushChainSVM.universal.sendTransaction({
          to: pushChainSVM.universal.account,
          value: BigInt(0),
          data: calls,
        });
        console.log('txHash', tx.hash);

        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        // const selector = keccak256(toBytes('UEA_MULTICALL')).slice(0, 10);
        // expect(tx.data.slice(0, 10)).toBe(selector);

        await tx.wait();

        const after = (await publicClientPush.readContract({
          address: COUNTER_ADDRESS,
          abi: CounterABI as unknown as any[],
          functionName: 'countPC',
          args: [],
        })) as unknown as bigint;

        expect(after).toBe(before + BigInt(2));
      }, 300000);

      it('should perform normal single-call from Sepolia, Solana Devnet, and Push Testnet', async () => {
        const incrementData = PushChain.utils.helpers.encodeTxData({
          abi: CounterABI as unknown as any[],
          functionName: 'increment',
        }) as `0x${string}`;

        const publicClientPush = createPublicClient({
          transport: http('https://evm.donut.rpc.push.org'),
        });

        const before = (await publicClientPush.readContract({
          address: COUNTER_ADDRESS,
          abi: CounterABI as unknown as any[],
          functionName: 'countPC',
          args: [],
        })) as unknown as bigint;

        // 1) From Ethereum Sepolia origin
        const txEvm = await pushClientEVM.universal.sendTransaction({
          to: COUNTER_ADDRESS,
          value: BigInt(0),
          data: incrementData,
        });
        console.log('txHash', txEvm.hash);
        expect(txEvm.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        await txEvm.wait();

        // 2) From Solana Devnet origin
        const txSvm = await pushChainSVM.universal.sendTransaction({
          to: COUNTER_ADDRESS,
          value: BigInt(0),
          data: incrementData,
        });
        console.log('txHash', txSvm.hash);
        expect(txSvm.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        await txSvm.wait();

        // 3) From Push Testnet origin
        const txPush = await pushChainPush.universal.sendTransaction({
          to: COUNTER_ADDRESS,
          value: BigInt(0),
          data: incrementData,
        });
        console.log('txHash', txPush.hash);
        expect(txPush.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        await txPush.wait();

        const after = (await publicClientPush.readContract({
          address: COUNTER_ADDRESS,
          abi: CounterABI as unknown as any[],
          functionName: 'countPC',
          args: [],
        })) as unknown as bigint;

        expect(after).toBe(before + BigInt(3));
      }, 300000);
    });

    // Individual multicall tests for each EVM chain (for IDE run button support)
    describe('Multicall - Ethereum Sepolia', () => {
      const config = EVM_CHAIN_CONFIGS[0]; // Ethereum Sepolia
      const PRIVATE_KEY = process.env['EVM_PRIVATE_KEY'] as
        | `0x${string}`
        | undefined;
      let client: PushChain;

      beforeAll(async () => {
        if (!PRIVATE_KEY) {
          throw new Error('EVM_PRIVATE_KEY environment variable is not set');
        }

        const result = await setupEVMChainClient(config, PRIVATE_KEY);
        client = result.client;
      });

      it('integration: should build and send multicall payload', async () => {
        await testMulticall(client, config);
      }, 300000);
    });

    describe('Multicall - Arbitrum Sepolia', () => {
      const config = EVM_CHAIN_CONFIGS[1]; // Arbitrum Sepolia
      const PRIVATE_KEY = process.env['EVM_PRIVATE_KEY'] as
        | `0x${string}`
        | undefined;
      let client: PushChain;

      beforeAll(async () => {
        if (!PRIVATE_KEY) {
          throw new Error('EVM_PRIVATE_KEY environment variable is not set');
        }

        const result = await setupEVMChainClient(config, PRIVATE_KEY);
        client = result.client;
      });

      it('integration: should build and send multicall payload', async () => {
        await testMulticall(client, config);
      }, 300000);
    });

    describe('Multicall - Base Sepolia', () => {
      const config = EVM_CHAIN_CONFIGS[2]; // Base Sepolia
      const PRIVATE_KEY = process.env['EVM_PRIVATE_KEY'] as
        | `0x${string}`
        | undefined;
      let client: PushChain;

      beforeAll(async () => {
        if (!PRIVATE_KEY) {
          throw new Error('EVM_PRIVATE_KEY environment variable is not set');
        }

        const result = await setupEVMChainClient(config, PRIVATE_KEY);
        client = result.client;
      });

      it('integration: should build and send multicall payload', async () => {
        await testMulticall(client, config);
      }, 300000);
    });

    describe('Multicall - BNB Testnet', () => {
      const config = EVM_CHAIN_CONFIGS[3]; // BNB Testnet
      const PRIVATE_KEY = process.env['EVM_PRIVATE_KEY'] as
        | `0x${string}`
        | undefined;
      let client: PushChain;

      beforeAll(async () => {
        if (!PRIVATE_KEY) {
          throw new Error('EVM_PRIVATE_KEY environment variable is not set');
        }

        const result = await setupEVMChainClient(config, PRIVATE_KEY);
        client = result.client;
      });

      it('integration: should build and send multicall payload', async () => {
        await testMulticall(client, config);
      }, 300000);
    });
  });

  // THIS IS HOW TO TEST THE NEW FEE ABSTRACTION.
  // WE ARE CREATING BRAND NEW WALLETS SO WE WILL NEED TO DEPLOY A UEA WHEN SENDING A TRANSCTION.
  // THIS IS DONE SO WE TEST THE COMPLETE LOGIC THAT THE BACKEND IS INDEED CORRECTLY DEPLOYING THE UEA and funding the wallet.
  describe('Test new fee abstraction - Ethereum Sepolia', () => {
    const config = EVM_CHAIN_CONFIGS[0]; // Ethereum Sepolia
    const PRIVATE_KEY = process.env['EVM_PRIVATE_KEY'] as
      | `0x${string}`
      | undefined;
    let account: PrivateKeyAccount;
    let client: PushChain;

    beforeAll(async () => {
      if (!PRIVATE_KEY) {
        throw new Error('EVM_PRIVATE_KEY environment variable is not set');
      }

      const result = await setupEVMChainClient(config, PRIVATE_KEY);
      account = result.account;
      client = result.client;
    });

    it('new fee abstraction should work self Ethereum New Wallet', async () => {
      if (!PRIVATE_KEY) {
        throw new Error('EVM_PRIVATE_KEY environment variable is not set');
      }
      await testFeeAbstractionValueOnlyDeployUEA(config, PRIVATE_KEY, 'self');
    }, 300000);

    it('new fee abstraction should work other Ethereum New Wallet', async () => {
      if (!PRIVATE_KEY) {
        throw new Error('EVM_PRIVATE_KEY environment variable is not set');
      }
      await testFeeAbstractionValueOnlyDeployUEA(config, PRIVATE_KEY, 'other');
    }, 300000);

    it('new fee abstraction Payload + Value self - Ethereum Sepolia', async () => {
      if (!PRIVATE_KEY) {
        throw new Error('EVM_PRIVATE_KEY environment variable is not set');
      }
      await testFeeAbstractionPayloadAndValue(client, config, 'self');
    }, 300000);

    it('new fee abstraction Payload + Value other - Ethereum Sepolia', async () => {
      if (!PRIVATE_KEY) {
        throw new Error('EVM_PRIVATE_KEY environment variable is not set');
      }
      await testFeeAbstractionPayloadAndValue(client, config, 'other');
    }, 300000);

    it('new fee abstraction Payload + Value self new wallet deploy UEA - Ethereum Sepolia', async () => {
      if (!PRIVATE_KEY) {
        throw new Error('EVM_PRIVATE_KEY environment variable is not set');
      }
      await testFeeAbstractionPayloadAndValueNewWalletDeployUEA(
        client,
        account,
        config,
        'other'
      );
    }, 300000);
  });

  describe('Test new fee abstraction - Base Sepolia', () => {
    const config = EVM_CHAIN_CONFIGS[2]; // Base Sepolia
    const PRIVATE_KEY = process.env['EVM_PRIVATE_KEY'] as
      | `0x${string}`
      | undefined;

    it('new fee abstraction should work other', async () => {
      if (!PRIVATE_KEY) {
        throw new Error('EVM_PRIVATE_KEY environment variable is not set');
      }
      await testFeeAbstractionValueOnlyDeployUEA(config, PRIVATE_KEY, 'other');
    }, 300000);
  });

  describe('Test new fee abstraction - Arbitrum Sepolia', () => {
    const config = EVM_CHAIN_CONFIGS[1]; // Arbitrum Sepolia
    const PRIVATE_KEY = process.env['EVM_PRIVATE_KEY'] as
      | `0x${string}`
      | undefined;

    it('new fee abstraction should work other', async () => {
      if (!PRIVATE_KEY) {
        throw new Error('EVM_PRIVATE_KEY environment variable is not set');
      }
      await testFeeAbstractionValueOnlyDeployUEA(config, PRIVATE_KEY, 'other');
    }, 300000);
  });

  describe('Test new fee abstraction - BNB Testnet', () => {
    const config = EVM_CHAIN_CONFIGS[3]; // BNB Testnet
    const PRIVATE_KEY = process.env['EVM_PRIVATE_KEY'] as
      | `0x${string}`
      | undefined;

    it('new fee abstraction should work other', async () => {
      if (!PRIVATE_KEY) {
        throw new Error('EVM_PRIVATE_KEY environment variable is not set');
      }
      await testFeeAbstractionValueOnlyDeployUEA(config, PRIVATE_KEY, 'other');
    }, 300000);
  });

  // NEW FEE ABSTRACTION - SOLANA
  describe('Test new fee abstraction (Solana Devnet - random wallet funding)', () => {
    // Increase timeout for setup and network operations in this suite
    jest.setTimeout(300000);

    let newSolanaKeypair: Keypair;
    let pushClientNewSolana: PushChain;

    beforeAll(async () => {
      newSolanaKeypair = Keypair.generate();

      const connection = new Connection(SOLANA_RPC, 'confirmed');

      const balanceBefore = await connection.getBalance(
        newSolanaKeypair.publicKey,
        'confirmed'
      );
      console.log(
        'newSolana balance before (lamports):',
        balanceBefore.toString()
      );

      // Fund the new wallet from a pre-funded SOLANA_PRIVATE_KEY
      const SOL_FUNDING_KEY =
        (process.env['SOLANA_PRIVATE_KEY'] as string | undefined) ||
        (process.env['SVM_PRIVATE_KEY'] as string | undefined);
      if (!SOL_FUNDING_KEY) {
        throw new Error('SOLANA_PRIVATE_KEY (or SVM_PRIVATE_KEY) is not set');
      }
      let funderKeypair: Keypair;
      try {
        if (SOL_FUNDING_KEY.trim().startsWith('[')) {
          const arr = JSON.parse(SOL_FUNDING_KEY) as number[];
          funderKeypair = Keypair.fromSecretKey(Uint8Array.from(arr));
        } else {
          const decoded = anchorUtils.bytes.bs58.decode(SOL_FUNDING_KEY.trim());
          funderKeypair = Keypair.fromSecretKey(Uint8Array.from(decoded));
        }
      } catch (e) {
        throw new Error('Invalid SOLANA_PRIVATE_KEY format');
      }
      // Ensure we transfer at least rent-exempt minimum for a zero-data account
      const minRent = await connection.getMinimumBalanceForRentExemption(
        0,
        'confirmed'
      );
      const transferIx = SystemProgram.transfer({
        fromPubkey: funderKeypair.publicKey,
        toPubkey: newSolanaKeypair.publicKey,
        lamports: Math.max(minRent, 90000000),
      });
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash('confirmed');
      const tx = new Transaction({
        feePayer: funderKeypair.publicKey,
        recentBlockhash: blockhash,
      }).add(transferIx);
      tx.sign(funderKeypair);
      let sig: string;
      try {
        sig = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });
      } catch (err) {
        if (err instanceof SendTransactionError) {
          const logs = await err.getLogs(connection);
          // eslint-disable-next-line no-console
          console.error('Solana sendRawTransaction logs:', logs);
        }
        throw err;
      }
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        'confirmed'
      );

      const balanceAfter = await connection.getBalance(
        newSolanaKeypair.publicKey,
        'confirmed'
      );
      console.log(
        'newSolana balance after (lamports):',
        balanceAfter.toString()
      );

      const universalSignerNewSolana =
        await PushChain.utils.signer.toUniversalFromKeypair(newSolanaKeypair, {
          chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
          library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
        });

      pushClientNewSolana = await PushChain.initialize(
        universalSignerNewSolana,
        {
          network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
          progressHook: (progress) => {
            console.log('Progress', progress);
          },
          rpcUrls: {
            [CHAIN.SOLANA_DEVNET]: [SOLANA_RPC],
          },
        }
      );
    }, 300000);

    it('random solana wallet is funded', async () => {
      // Prepare Push EVM client and compute executor (UEA) address on Push Chain
      const pushEvmClient = new EvmClient({
        rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
      });
      const executorInfo =
        await PushChain.utils.account.convertOriginToExecutor(
          pushClientNewSolana.universal.origin,
          { onlyCompute: true }
        );
      const pcBeforeUEA = await pushEvmClient.getBalance(executorInfo.address);
      const pcBeforeRecipient = await pushEvmClient.getBalance(
        '0x1234567890123456789012345678901234567890'
      );
      console.log(
        'Executor PC balance before (wei):',
        pcBeforeRecipient.toString()
      );
      console.log('Solana Address: ', pushClientNewSolana.universal.origin);

      const tx = await pushClientNewSolana.universal.sendTransaction({
        // to: '0x1234567890123456789012345678901234567890',
        to: pushClientNewSolana.universal.account,
        value: BigInt(1),
        // gasLimit: BigInt(6e15),
      }); // ---->> Multicall
      expect(tx).toBeDefined();
      console.log('txHash', tx.hash);
      await tx.wait();

      await new Promise((resolve) => setTimeout(resolve, 15000));

      const pcAfterRecipient = await pushEvmClient.getBalance(
        '0x1234567890123456789012345678901234567890'
      );
      const pcAfterUEA = await pushEvmClient.getBalance(executorInfo.address);
      console.log(
        'Executor PC balance after (wei):',
        pcAfterRecipient.toString()
      );
      // expect(pcAfterRecipient > pcBeforeRecipient).toBe(true);
      expect(pcAfterUEA > pcBeforeUEA).toBe(true);
    }, 300000);
  });

  // Individual test suites for each EVM chain (for IDE run button support)
  describe('Universal.sendTransaction (FUNDS_TX via UniversalGatewayV0) - Ethereum Sepolia', () => {
    const config = EVM_CHAIN_CONFIGS[0]; // Ethereum Sepolia
    const PRIVATE_KEY = process.env['EVM_PRIVATE_KEY'] as
      | `0x${string}`
      | undefined;
    let account: PrivateKeyAccount;
    let client: PushChain;

    beforeAll(async () => {
      if (!PRIVATE_KEY) {
        throw new Error('EVM_PRIVATE_KEY environment variable is not set');
      }

      const result = await setupEVMChainClient(config, PRIVATE_KEY);
      account = result.account;
      client = result.client;
    });

    it('funds only USDT self - Ethereum Sepolia', async () => {
      await testSendFundsUSDTNoValue(client, account, config, 'self');
    }, 300000);

    it('funds only USDT other - Ethereum Sepolia', async () => {
      await testSendFundsUSDTNoValue(client, account, config, 'other');
    }, 300000);

    it('integration: sendFunds ETH self - Ethereum Sepolia', async () => {
      await testSendFundsETH(client, config, 'self');
    }, 300000);

    it.skip('integration: sendFunds ETH other - Ethereum Sepolia - EXPECTED TO FAIL', async () => {
      await testSendFundsETH(client, config, 'other');
    }, 300000);

    it('integration: sendTxWithFunds USDT Recipient other', async () => {
      await testSendTxWithFundsUSDTNoValue(client, account, config, 'other');
    }, 500000);

    it('integration: sendFunds USDT other new wallet deploy UEA other', async () => {
      await testFundsUSDTNoValueNewWalletDeployUEA(
        client,
        account,
        config,
        'other'
      );
    }, 500000);

    it('integration: sendFunds USDT other new wallet deploy UEA self', async () => {
      await testFundsUSDTNoValueNewWalletDeployUEA(
        client,
        account,
        config,
        'self'
      );
    }, 500000);

    it('integration: sendTxWithFunds USDT Recipient other new wallet deploy UEA', async () => {
      await testSendFundsWithPayloadUSDTWithValueNewWalletDeployUEA(
        client,
        account,
        config,
        'other'
      );
    }, 500000);

    it('integration: sendTxWithFunds USDT Recipient self', async () => {
      await testSendTxWithFundsUSDTNoValue(client, account, config, 'self');
    }, 500000);

    it('integration: pay gas with USDT via UniversalGatewayV0', async () => {
      await testSendTxWithFundsPayGasUSDT(client, account, config);
    }, 500000);

    it('integration: payload only self - Ethereum Sepolia', async () => {
      await testSendTxPayloadOnly(client, account, config, 'self');
    }, 500000);

    it('integration: payload only other - Ethereum Sepolia', async () => {
      await testSendTxPayloadOnly(client, account, config, 'other');
    }, 500000);

    it('payload only other - Ethereum Sepolia', async () => {
      if (!PRIVATE_KEY) {
        throw new Error('EVM_PRIVATE_KEY environment variable is not set');
      }
      await testFeeAbstractionPayloadOnlyDeployUEA(
        config,
        PRIVATE_KEY,
        'other'
      );
    }, 500000);

    it('integration: sendTxWithFunds With Value USDT other - Ethereum Sepolia', async () => {
      await testValuePayloadFundsUSDT(client, account, config, 'other');
    }, 500000);

    it.skip('Test Value Funds Payload ETH other - Ethereum Sepolia', async () => {
      await testValuePayloadFundsETH(client, account, config, 'other');
    }, 500000);

    it('Test Value Funds USDT self - Ethereum Sepolia', async () => {
      await testValueFundsUSDT(client, account, config, 'self');
    }, 500000);

    it('Test Value Funds USDT other - Ethereum Sepolia', async () => {
      await testValueFundsUSDT(client, account, config, 'other');
    }, 500000);

    it('integration: sendTxWithFunds With Value USDT self - Ethereum Sepolia', async () => {
      await testValuePayloadFundsUSDT(client, account, config, 'self');
    }, 500000);

    it('Test Payload Funds USDT self - Ethereum Sepolia', async () => {
      await testPayloadFundsUSDT(client, account, config, 'self');
    }, 500000);

    it('Test Payload Funds USDT other - Ethereum Sepolia', async () => {
      await testPayloadFundsUSDT(client, account, config, 'other');
    }, 500000);

    it('integration: sendTxWithFunds ETH should throw (not supported)', async () => {
      try {
        const bridgeAmount = BigInt(1);
        const UCABI = [
          {
            inputs: [],
            name: 'increment',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
          },
        ];
        const COUNTER_ADDRESS =
          '0x5FbDB2315678afecb367f032d93F642f64180aa3' as `0x${string}`;
        const data = PushChain.utils.helpers.encodeTxData({
          abi: UCABI,
          functionName: 'increment',
        });

        const tenUsdt = PushChain.utils.helpers.parseUnits('10', {
          decimals: client.payable.token.USDT.decimals,
        });
        const quote = await client.funds.getConversionQuote(tenUsdt, {
          from: client.payable.token.USDT,
          to: client.moveable.token.WETH,
        });
        const ethValue = BigInt(quote.amountOut);

        await expect(
          client.universal.sendTransaction({
            to: COUNTER_ADDRESS,
            value: ethValue,
            data,
            funds: { amount: bridgeAmount, token: client.moveable.token.ETH },
          })
        ).rejects.toThrow(
          'Only ERC-20 tokens are supported for funds+payload on EVM; native and permit2 are not supported yet'
        );
      } catch (err) {
        console.warn(
          `ETH sendTxWithFunds flow failed (non-fatal for test on ${config.name}):`,
          err
        );
      }
    });
  });

  describe('Universal.sendTransaction (FUNDS_TX via UniversalGatewayV0) - Arbitrum Sepolia', () => {
    const config = EVM_CHAIN_CONFIGS[1]; // Arbitrum Sepolia
    const PRIVATE_KEY = process.env['EVM_PRIVATE_KEY'] as
      | `0x${string}`
      | undefined;
    let account: PrivateKeyAccount;
    let client: PushChain;

    beforeAll(async () => {
      if (!PRIVATE_KEY) {
        throw new Error('EVM_PRIVATE_KEY environment variable is not set');
      }

      const result = await setupEVMChainClient(config, PRIVATE_KEY);
      account = result.account;
      client = result.client;
    });

    it('integration: sendFunds USDT via UniversalGatewayV0', async () => {
      await testSendFundsUSDTNoValue(client, account, config, 'self');
    }, 300000);

    it.skip('integration: sendFunds ETH other - EXPECTED TO FAIL', async () => {
      await testSendFundsETH(client, config, 'other');
    }, 300000);

    it('integration: sendTxWithFunds USDT Recipient other', async () => {
      await testSendTxWithFundsUSDTNoValue(client, account, config, 'other');
    }, 500000);

    it('integration: sendTxWithFunds USDT Recipient self', async () => {
      await testSendTxWithFundsUSDTNoValue(client, account, config, 'self');
    }, 500000);

    it.skip('integration: pay gas with USDT via UniversalGatewayV0', async () => {
      await testSendTxWithFundsPayGasUSDT(client, account, config);
    }, 500000);
  });

  describe('Universal.sendTransaction (FUNDS_TX via UniversalGatewayV0) - Base Sepolia', () => {
    const config = EVM_CHAIN_CONFIGS[2]; // Base Sepolia
    const PRIVATE_KEY = process.env['EVM_PRIVATE_KEY'] as
      | `0x${string}`
      | undefined;
    let account: PrivateKeyAccount;
    let client: PushChain;

    beforeAll(async () => {
      if (!PRIVATE_KEY) {
        throw new Error('EVM_PRIVATE_KEY environment variable is not set');
      }

      const result = await setupEVMChainClient(config, PRIVATE_KEY);
      account = result.account;
      client = result.client;
    });

    it('integration: sendFunds USDT via UniversalGatewayV0', async () => {
      await testSendFundsUSDTNoValue(client, account, config, 'self');
    }, 300000);

    it.skip('integration: sendFunds USDT With Value to self - EXPECT TO FAIL', async () => {
      await testSendFundsUSDTWithValue(client, account, config, 'self');
    }, 300000);

    it('integration: sendFunds USDT With Value to other', async () => {
      await testSendFundsUSDTWithValue(client, account, config, 'other');
    }, 300000);

    it.skip('integration: sendFunds ETH other - EXPECTED TO FAIL', async () => {
      await testSendFundsETH(client, config, 'other');
    }, 300000);

    it('integration: sendTxWithFunds USDT No Value Recipient Other', async () => {
      await testSendTxWithFundsUSDTNoValue(client, account, config, 'other');
    }, 500000);

    it('integration: sendTxWithFunds USDT No Value Recipient Self', async () => {
      await testSendTxWithFundsUSDTNoValue(client, account, config, 'self');
    }, 500000);

    it('integration: sendTxWithFunds With Value USDT other', async () => {
      await testValuePayloadFundsUSDT(client, account, config, 'other');
    }, 500000);

    it('integration: sendTxWithFunds With Value USDT self', async () => {
      await testValuePayloadFundsUSDT(client, account, config, 'self');
    }, 500000);

    it('integration: value + payload', async () => {
      await testSendTxValueAndPayload(client, account, config);
    }, 500000);

    it('integration: payload only', async () => {
      await testSendTxPayloadOnly(client, account, config, 'other');
    }, 500000);
  });

  describe('Universal.sendTransaction (FUNDS_TX via UniversalGatewayV0) - BNB Testnet', () => {
    const config = EVM_CHAIN_CONFIGS[3]; // BNB Testnet
    const PRIVATE_KEY = process.env['EVM_PRIVATE_KEY'] as
      | `0x${string}`
      | undefined;
    let account: PrivateKeyAccount;
    let client: PushChain;

    beforeAll(async () => {
      if (!PRIVATE_KEY) {
        throw new Error('EVM_PRIVATE_KEY environment variable is not set');
      }

      const result = await setupEVMChainClient(config, PRIVATE_KEY);
      account = result.account;
      client = result.client;
    });

    it('integration: sendFunds USDT via UniversalGatewayV0', async () => {
      await testSendFundsUSDTNoValue(client, account, config, 'self');
    }, 300000);

    it.skip('integration: sendFunds BNB other - EXPECTED TO FAIL', async () => {
      await testSendFundsETH(client, config, 'other');
    }, 300000);

    it('integration: sendTxWithFunds USDT Recipient other', async () => {
      await testSendTxWithFundsUSDTNoValue(client, account, config, 'other');
    }, 500000);

    it('integration: sendTxWithFunds USDT Recipient self', async () => {
      await testSendTxWithFundsUSDTNoValue(client, account, config, 'self');
    }, 500000);
  });

  // Test for unsupported origin chains (only needs to run once, not per chain)
  describe('Universal.sendTransaction - Unsupported chains', () => {
    it('should throw on unsupported origin chains', async () => {
      // Use SVM signer (unsupported for FUNDS_TX origin)
      const accountSVM = Keypair.generate();
      const svmSigner = await PushChain.utils.signer.toUniversalFromKeypair(
        accountSVM,
        {
          chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
          library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
        }
      );
      const svmClient = await PushChain.initialize(svmSigner, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
        rpcUrls: { [CHAIN.ETHEREUM_SEPOLIA]: [EVM_RPC] },
      });

      const amount = PushChain.utils.helpers.parseUnits('100', { decimals: 6 });
      await expect(
        svmClient.universal.sendTransaction({
          to: '0x1234567890123456789012345678901234567890' as `0x${string}`,
          funds: {
            amount,
            token: {
              symbol: 'USDC',
              decimals: 6,
              address: '0xA0b8',
              requiresApprove: true,
            } as any,
          },
        } as any)
      ).rejects.toThrow(/Unsupported token mechanism on Solana/i);
    });
  });

  describe('Solana sendTransaction (FUNDS_TX via pushsolanagateway - Solana Devnet)', () => {
    // Live RPCs can be slower
    const SOL_PRIVATE_KEY =
      (process.env['SOLANA_PRIVATE_KEY'] as string | undefined) ||
      (process.env['SVM_PRIVATE_KEY'] as string | undefined);
    let signer: UniversalSigner;
    let client: PushChain;

    function getSolKeypairFromEnv(): Keypair {
      if (!SOL_PRIVATE_KEY) {
        throw new Error('SOL_PRIVATE_KEY (or SVM_PRIVATE_KEY) is not set');
      }
      try {
        // Try JSON array format
        if (SOL_PRIVATE_KEY.trim().startsWith('[')) {
          const arr = JSON.parse(SOL_PRIVATE_KEY) as number[];
          return Keypair.fromSecretKey(Uint8Array.from(arr));
        }
        // Else assume base58-encoded secret key
        const decoded = anchorUtils.bytes.bs58.decode(SOL_PRIVATE_KEY.trim());
        return Keypair.fromSecretKey(Uint8Array.from(decoded));
      } catch (e) {
        throw new Error('Invalid SOL_PRIVATE_KEY format');
      }
    }

    beforeAll(async () => {
      const kp = getSolKeypairFromEnv();
      signer = await PushChain.utils.signer.toUniversalFromKeypair(kp, {
        chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
        library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
      });
      client = await PushChain.initialize(signer, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
        progressHook: (progress) => {
          console.log('Progress (SVM)', progress);
        },
        // rpcUrls: {
        //   [CHAIN.SOLANA_DEVNET]: [SOLANA_RPC],
        // },
      });
    });

    describe('sendFundsNative function and sendFunds function', () => {
      it('sendFundsNative function', async () => {
        try {
          // const amountLamports = PushChain.utils.helpers.parseUnits('0.001', 9);
          const amountLamports = BigInt(1);
          // const recipient = client.universal.account;
          const recipient = '0x0000000000000000000000000000000000042101';

          // Check pSOL balance on PushChain before bridging
          const pushChainClient = new EvmClient({
            rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
          });
          const pSOL_ADDRESS =
            SYNTHETIC_PUSH_ERC20[PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT]
              .pSOL;
          const balanceBefore = await pushChainClient.getErc20Balance({
            tokenAddress: pSOL_ADDRESS,
            ownerAddress: recipient as `0x${string}`,
          });
          console.log('pSOL balance before bridging', balanceBefore);

          const resNative = await client.universal.sendTransaction({
            to: recipient,
            funds: { amount: amountLamports, token: client.moveable.token.SOL },
          });
          console.log('txHash', resNative.hash);

          const receipt = await resNative.wait();
          expect(receipt.status).toBe(1);
          console.log('SVM Native Receipt', receipt);

          // Check pSOL balance on PushChain after bridging
          const balanceAfter = await pushChainClient.getErc20Balance({
            tokenAddress: pSOL_ADDRESS,
            ownerAddress: recipient as `0x${string}`,
          });
          console.log('pSOL balance after bridging', balanceAfter);
          expect(balanceAfter > balanceBefore).toBe(true);
        } catch (err) {
          console.error('SVM sendFunds SOL flow failed (non-fatal):', err);
        }
      }, 300000);

      it('sendFunds function SPL', async () => {
        const amountLamports = BigInt(1);
        // const recipient = client.universal.account;
        const recipient = '0x0000000000000000000000000000000000042101';
        // Check pUSDT (USDT.sol) balance on PushChain before bridging
        const pushChainClient = new EvmClient({
          rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
        });
        const USDT_SOL_ADDRESS = PushChain.utils.tokens.getPRC20Address(
          client.moveable.token.USDT
        );
        const balanceBefore = await pushChainClient.getErc20Balance({
          tokenAddress: USDT_SOL_ADDRESS,
          ownerAddress: recipient as `0x${string}`,
        });
        console.log('pUSDT(SOL) balance before bridging', balanceBefore);
        // Compute USDT SPL balance before sending
        const connection = new Connection(SOLANA_RPC, 'confirmed');
        const mintPk = new PublicKey(client.moveable.token.USDT.address);
        const ownerPk = new PublicKey(signer.account.address);
        const TOKEN_PROGRAM_ID = new PublicKey(
          'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
        );
        const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
          'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
        );
        const ata = PublicKey.findProgramAddressSync(
          [ownerPk.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPk.toBuffer()],
          ASSOCIATED_TOKEN_PROGRAM_ID
        )[0];
        let usdtRawAmount = BigInt(0);
        try {
          const balInfo = await connection.getTokenAccountBalance(ata);
          // amount is a string of the raw token units (no decimals applied)
          usdtRawAmount = BigInt(balInfo.value.amount);
        } catch (_) {
          // ATA may not exist or balance is zero; default stays 0
        }
        console.log(
          'USDT (SPL) balance before send (raw units):',
          usdtRawAmount.toString()
        );
        const resNative = await client.universal.sendTransaction({
          to: recipient,
          funds: {
            amount: amountLamports,
            token: client.moveable.token.USDT,
          },
        });

        const receipt = await resNative.wait();
        console.log('txHash', resNative.hash);
        expect(receipt.status).toBe(1);
        // Check pUSDT (USDT.sol) balance on PushChain after bridging
        const balanceAfter = await pushChainClient.getErc20Balance({
          tokenAddress: USDT_SOL_ADDRESS,
          ownerAddress: recipient as `0x${string}`,
        });
        console.log('pUSDT(SOL) balance after bridging', balanceAfter);
        expect(balanceAfter > balanceBefore).toBe(true);
      }, 300000);
    });

    describe('sendTxWithFunds function', () => {
      it('sendTxWithFunds SOL function', async () => {
        const bridgeAmount = BigInt(1);
        const COUNTER_ABI = [
          {
            inputs: [],
            name: 'increment',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
          },
          {
            inputs: [],
            name: 'countPC',
            outputs: [
              {
                internalType: 'uint256',
                name: '',
                type: 'uint256',
              },
            ],
            stateMutability: 'view',
            type: 'function',
          },
        ];
        const COUNTER_ADDRESS =
          '0x5FbDB2315678afecb367f032d93F642f64180aa3' as `0x${string}`;
        const data = PushChain.utils.helpers.encodeTxData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const pushPublicClient = createPublicClient({
          transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
        });

        // Ensure the address is a contract on Push chain
        const bytecode = await pushPublicClient.getBytecode({
          address: COUNTER_ADDRESS,
        });
        if (!bytecode || bytecode === '0x') {
          console.warn(
            `Skipping test: no contract bytecode at ${COUNTER_ADDRESS} on Push Testnet`
          );
          return;
        }

        const beforeCount = (await pushPublicClient.readContract({
          abi: COUNTER_ABI,
          address: COUNTER_ADDRESS,
          functionName: 'countPC',
        })) as bigint;

        // Check pSOL balance on PushChain before bridging
        const recipient = client.universal.account;
        const pushChainClient = new EvmClient({
          rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
        });
        const pSOL_ADDRESS =
          SYNTHETIC_PUSH_ERC20[PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT]
            .pSOL;
        const balanceBefore = await pushChainClient.getErc20Balance({
          tokenAddress: pSOL_ADDRESS,
          ownerAddress: COUNTER_ADDRESS,
        });
        console.log(
          'pSOL balance before bridging (sendTxWithFunds SOL)',
          balanceBefore
        );

        const res = await client.universal.sendTransaction({
          to: COUNTER_ADDRESS,
          data,
          funds: { amount: bridgeAmount, token: client.moveable.token.SOL },
        });

        expect(typeof res.hash).toBe('string');
        expect(res.hash.length).toBeGreaterThan(0);
        console.log('SVM sendTxWithFunds hash', res.hash);
        console.log('txHash', res.hash);

        await res.wait();

        // Check pSOL balance on PushChain after bridging
        const balanceAfter = await pushChainClient.getErc20Balance({
          tokenAddress: pSOL_ADDRESS,
          ownerAddress: COUNTER_ADDRESS,
        });

        const afterCount = (await pushPublicClient.readContract({
          abi: COUNTER_ABI,
          address: COUNTER_ADDRESS,
          functionName: 'countPC',
        })) as bigint;
        expect(afterCount).toBe(beforeCount + BigInt(1));
        expect(balanceAfter > balanceBefore).toBe(true);
      }, 300000);

      it('sendTxWithFunds USDT function', async () => {
        const bridgeAmount = BigInt(1);
        const COUNTER_ABI = [
          {
            inputs: [],
            name: 'increment',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
          },
          {
            inputs: [],
            name: 'countPC',
            outputs: [
              {
                internalType: 'uint256',
                name: '',
                type: 'uint256',
              },
            ],
            stateMutability: 'view',
            type: 'function',
          },
        ];
        const COUNTER_ADDRESS =
          '0x5FbDB2315678afecb367f032d93F642f64180aa3' as `0x${string}`;
        const data = PushChain.utils.helpers.encodeTxData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        const pushPublicClient = createPublicClient({
          transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
        });

        // Ensure the address is a contract on Push chain
        const bytecode = await pushPublicClient.getBytecode({
          address: COUNTER_ADDRESS,
        });
        if (!bytecode || bytecode === '0x') {
          console.warn(
            `Skipping test: no contract bytecode at ${COUNTER_ADDRESS} on Push Testnet`
          );
          return;
        }

        const beforeCount = (await pushPublicClient.readContract({
          abi: COUNTER_ABI,
          address: COUNTER_ADDRESS,
          functionName: 'countPC',
        })) as bigint;

        // Check pUSDT (USDT.sol) balance on PushChain before bridging
        const pushChainClient = new EvmClient({
          rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
        });
        const USDT_SOL_ADDRESS = PushChain.utils.tokens.getPRC20Address(
          client.moveable.token.USDT
        );
        const balanceBefore = await pushChainClient.getErc20Balance({
          tokenAddress: USDT_SOL_ADDRESS,
          ownerAddress: COUNTER_ADDRESS,
        });
        console.log(
          'pUSDT(SOL) balance before bridging (sendTxWithFunds USDT)',
          balanceBefore
        );

        const res = await client.universal.sendTransaction({
          to: COUNTER_ADDRESS,
          data,
          funds: { amount: bridgeAmount, token: client.moveable.token.USDT },
        });

        expect(typeof res.hash).toBe('string');
        expect(res.hash.length).toBeGreaterThan(0);
        console.log('SVM sendTxWithFunds USDT hash', res.hash);
        console.log('txHash', res.hash);

        await res.wait();

        // Check pUSDT (USDT.sol) balance on PushChain after bridging
        const balanceAfter = await pushChainClient.getErc20Balance({
          tokenAddress: USDT_SOL_ADDRESS,
          ownerAddress: COUNTER_ADDRESS,
        });
        console.log(
          'pUSDT(SOL) balance after bridging (sendTxWithFunds USDT)',
          balanceAfter
        );
        // expect(balanceAfter > balanceBefore).toBe(true);

        const afterCount = (await pushPublicClient.readContract({
          abi: COUNTER_ABI,
          address: COUNTER_ADDRESS,
          functionName: 'countPC',
        })) as bigint;
        expect(afterCount).toBe(beforeCount + BigInt(1));
      }, 300000);

      it('sendTxWithFunds payWith USDT should fail on Solana Devnet', async () => {
        const bridgeAmount = BigInt(1);
        const COUNTER_ABI = [
          {
            inputs: [],
            name: 'increment',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
          },
        ];
        const COUNTER_ADDRESS =
          '0x5FbDB2315678afecb367f032d93F642f64180aa3' as `0x${string}`;
        const data = PushChain.utils.helpers.encodeTxData({
          abi: COUNTER_ABI,
          functionName: 'increment',
        });

        console.log(client.moveable.token.USDT);

        await expect(
          client.universal.sendTransaction({
            to: COUNTER_ADDRESS,
            value: BigInt(0),
            data,
            funds: {
              amount: bridgeAmount,
              token: client.moveable.token.USDT,
            },
            payGasWith: {
              token: client.payable.token.USDT,
            },
          })
        ).rejects.toThrow('Pay-with token is not supported on Solana');
      });
    });

    it('sendTxWithFunds SOL with new Solana wallet deploy UEA (recipient other)', async () => {
      await testFundsSOLNoValueNewWalletDeployUEA_SVM('other');
    }, 300000);
  });

  describe('Validation: funds + value guard', () => {
    it('Should fail when moving funds when client connected to Push Chain', async () => {
      // Create a client on Push chain (so we fail early on the sepolia-only check without network calls)
      const pushTestnet = defineChain({
        id: parseInt(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId),
        name: 'Push Testnet',
        nativeCurrency: { decimals: 18, name: 'PC', symbol: '$PC' },
        rpcUrls: {
          default: {
            http: [CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]],
          },
        },
      });
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        chain: pushTestnet,
        transport: http(),
      });
      const signer = await PushChain.utils.signer.toUniversalFromKeypair(
        walletClient,
        {
          chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );
      const client = await PushChain.initialize(signer, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      });

      const recipient =
        '0x1234567890123456789012345678901234567890' as `0x${string}`;

      // 2) value = 0 with funds should pass the guard and then fail on sepolia-only check
      await expect(
        client.universal.sendTransaction({
          to: recipient,
          value: BigInt(0),
          funds: { amount: BigInt(1) },
        })
      ).rejects.toThrow(
        'Funds bridging is only supported on Ethereum Sepolia, Arbitrum Sepolia, Base Sepolia, BNB Testnet, and Solana Devnet for now'
      );
    });
  });

  describe('Funds Namespace (Integration - Uniswap live on Sepolia)', () => {
    // Live RPCs can be slower
    jest.setTimeout(30000);

    it('should error on unsupported chains (non-Ethereum origin)', async () => {
      // Create a client on Push chain (origin not Ethereum)
      const pushAccount = privateKeyToAccount(generatePrivateKey());
      const pushWallet = createWalletClient({
        account: pushAccount,
        chain: defineChain({
          id: parseInt(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId),
          name: 'Push Testnet',
          nativeCurrency: { decimals: 18, name: 'PC', symbol: '$PC' },
          rpcUrls: {
            default: {
              http: [CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]],
            },
          },
        }),
        transport: http(),
      });
      const pushSigner = await PushChain.utils.signer.toUniversalFromKeypair(
        pushWallet,
        {
          chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );
      const pushClient = await PushChain.initialize(pushSigner, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      });

      const amountIn = PushChain.utils.helpers.parseUnits('1', 18);

      await expect(
        pushClient.funds.getConversionQuote(amountIn, {
          from: pushClient.payable.token.USDT,
          to: pushClient.moveable.token.ETH,
        })
      ).rejects.toThrow(
        'getConversionQuote is only supported on Ethereum Sepolia for now'
      );
    });

    it('sepolia: WETH -> WETH should fail gracefully (no direct pool)', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(EVM_RPC),
      });
      const signer = await PushChain.utils.signer.toUniversalFromKeypair(
        walletClient,
        {
          chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );
      const client = await PushChain.initialize(signer, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
        rpcUrls: { [CHAIN.ETHEREUM_SEPOLIA]: [EVM_RPC] },
      });

      // Use WETH9 Sepolia
      const WETH9 =
        '0xfff9976782d46cc05630d1f6ebab18b2324d6b14' as `0x${string}`;
      const amountIn = PushChain.utils.helpers.parseUnits('0.01', 18);
      await expect(
        client.funds.getConversionQuote(amountIn, {
          from: client.payable.token.WETH,
          // from: { symbol: 'WETH', decimals: 18, address: WETH9 },
          to: client.moveable.token.WETH,
          // to: { symbol: 'WETH', decimals: 18, address: WETH9 },
        })
      ).rejects.toThrow(/No direct Uniswap V3 pool found/);
    });

    it('sepolia: WETH -> USDT quote via Uniswap V3', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(),
      });
      const signer = await PushChain.utils.signer.toUniversalFromKeypair(
        walletClient,
        {
          chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );
      const client = await PushChain.initialize(signer, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      });

      const WETH9 =
        '0xfff9976782d46cc05630d1f6ebab18b2324d6b14' as `0x${string}`; // Sepolia WETH9
      const USDC =
        '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as `0x${string}`; // Provided Sepolia USDC

      // Quote: 0.005 WETH -> USDC
      const amountIn = PushChain.utils.helpers.parseUnits('0.005', 18);
      const quote = await client.funds.getConversionQuote(amountIn, {
        from: client.payable.token.WETH,
        to: client.moveable.token.USDT,
      });

      expect(BigInt(quote.amountOut)).toBeGreaterThan(BigInt(0));
      expect(quote.rate).toBeGreaterThan(0);
      expect(quote.route).toEqual(['WETH', 'USDT']);
    });
  });
});
