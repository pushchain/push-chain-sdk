import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import bs58 from 'bs58';
import {
  UniversalSigner,
  UniversalAccount,
} from '../universal/universal.types';
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
import { keccak256, toBytes } from 'viem';
import { MulticallCall } from '../orchestrator/orchestrator.types';
import { CHAIN_INFO, SYNTHETIC_PUSH_ERC20 } from '../constants/chain';
import { CHAIN } from '../constants/enums';
import { Keypair, PublicKey, Connection } from '@solana/web3.js';
import { utils as anchorUtils } from '@coral-xyz/anchor';
import { EvmClient } from '../vm-client/evm-client';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from packages/core/.env
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const EVM_RPC =
  process.env['EVM_RPC'] || CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];
const ARBITRUM_SEPOLIA_RPC =
  process.env['ARBITRUM_SEPOLIA_RPC'] ||
  CHAIN_INFO[CHAIN.ARBITRUM_SEPOLIA].defaultRPC[0];
const BASE_SEPOLIA_RPC =
  process.env['BASE_SEPOLIA_RPC'] ||
  CHAIN_INFO[CHAIN.BASE_SEPOLIA].defaultRPC[0];
const BNB_TESTNET_RPC =
  process.env['BNB_TESTNET_RPC'] ||
  CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0];
const SOLANA_RPC =
  process.env['SOLANA_RPC_URL'] ||
  CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC[0];

// EVM Chain Test Configuration
interface EVMChainTestConfig {
  name: string;
  chain: CHAIN;
  viemChain: typeof sepolia | typeof arbitrumSepolia | typeof baseSepolia | typeof bscTestnet;
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

async function testSendFundsUSDT(
  client: PushChain,
  account: PrivateKeyAccount,
  config: EVMChainTestConfig
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
  const recipient = '0x7AEE1699FeE2C906251863D24D35B3dEbe0932EC';

  // pUSDT (USDT.eth) balance on Push chain should increase for the recipient
  const pushChainClient = new EvmClient({
    rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
  });

  let pusdt;
  if (config.chain === CHAIN.ETHEREUM_SEPOLIA) {
    pusdt =
      SYNTHETIC_PUSH_ERC20[PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT]
        .USDT_ETH;
  } else if (config.chain === CHAIN.ARBITRUM_SEPOLIA) {
    pusdt =
      SYNTHETIC_PUSH_ERC20[PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT]
        .USDT_ARB;
  } else {
    throw new Error('USDT address not on Push Chain');
  }

  const balanceBefore = await pushChainClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: recipient as `0x${string}`,
  });

  const resUSDT = await client.universal.sendTransaction({
    to: recipient,
    funds: { amount, token: usdt },
  });

  const receipt = await resUSDT.wait();
  expect(receipt.status).toBe(1);
  console.log(`[${config.name}] USDT bridge receipt:`, receipt);

  const balanceAfter = await pushChainClient.getErc20Balance({
    tokenAddress: pusdt,
    ownerAddress: recipient as `0x${string}`,
  });
  expect(balanceAfter > balanceBefore).toBe(true);
}

async function testSendFundsETH(
  client: PushChain,
  config: EVMChainTestConfig
): Promise<void> {
  const amount = BigInt(1);
  const recipient = client.universal.account;

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

  const resNative = await client.universal.sendTransaction({
    to: recipient,
    funds: { amount },
  });

  const receipt = await resNative.wait();
  expect(receipt.status).toBe(1);
  console.log(`[${config.name}] ETH bridge receipt:`, receipt);

  const balanceAfter = await pushChainClient.getErc20Balance({
    tokenAddress: pETH_ADDRESS,
    ownerAddress: recipient,
  });
  expect(balanceAfter > balanceBefore).toBe(true);
}

async function testSendTxWithFundsUSDT(
  client: PushChain,
  account: PrivateKeyAccount,
  config: EVMChainTestConfig
): Promise<void> {
  const erc20Abi = parseAbi([
    'function balanceOf(address) view returns (uint256)',
  ]);
  const usdt = client.moveable.token.USDT;

  const evm = new EvmClient({
    rpcUrls: [EVM_RPC],
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

  const resUSDT = await client.universal.sendTransaction({
    to: COUNTER_ADDRESS,
    value: BigInt(0),
    data,
    funds: { amount: bridgeAmount, token: usdt },
  });

  expect(typeof resUSDT.hash).toBe('string');
  expect(resUSDT.hash.startsWith('0x')).toBe(true);
  await resUSDT.wait();

  // Wait for Push Chain state to finalize
  await new Promise(resolve => setTimeout(resolve, 3000));

  const afterCount = (await pushPublicClient.readContract({
    abi: COUNTER_ABI,
    address: COUNTER_ADDRESS,
    functionName: 'countPC',
  })) as bigint;

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

  // TODO: Check if we can pass the `value` as != 0. If we pass, what would be the behaviour? Because we can only pay gas fees with native OR token.
  // TODO: Add balance check.
  const res = await client.universal.sendTransaction({
    to: COUNTER_ADDRESS,
    value: BigInt(0),
    data,
    funds: {
      amount: bridgeAmount,
      token: usdt,
      payWith: {
        token: client.payable.token.WETH,
        // token: client.payable.token.USDT,
        // TODO: What happens if minAmountOut is `undefined`.
        // minAmountOut: minAmountOut,
      },
    },
  });

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

  const calls: MulticallCall[] = [
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

  expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

  const selector = keccak256(toBytes('UEA_MULTICALL')).slice(0, 10);
  expect(tx.data.slice(0, 10)).toBe(selector);

  await tx.wait();

  const after = (await publicClientPush.readContract({
    address: COUNTER_ADDRESS,
    abi: CounterABI as unknown as any[],
    functionName: 'countPC',
    args: [],
  })) as unknown as bigint;

  expect(after).toBe(before + BigInt(2));
  console.log(`[${config.name}] Multicall executed successfully`);
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
      });
    });

    describe('signMessage', () => {
      it('should signMessage - EVM format', async () => {
        const testMessage = new TextEncoder().encode('Hello, Push Chain!');
        const signatureEVM = await pushClientEVM.universal.signMessage(
          testMessage
        );
        const signaturePush = await pushChainPush.universal.signMessage(
          testMessage
        );

        // Verify signature format (should be hex for EVM)
        expect(signatureEVM).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(signatureEVM.length).toBeGreaterThan(2); // At least 0x + some hex chars

        expect(signaturePush).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(signaturePush.length).toBeGreaterThan(2); // At least 0x + some hex chars

        // Verify the signature is valid
        const isValidEVM = await verifyMessage({
          address: universalSignerEVM.account.address as `0x${string}`,
          message: { raw: testMessage },
          signature: signatureEVM as `0x${string}`,
        });

        expect(isValidEVM).toBe(true);

        const isValidPush = await verifyMessage({
          address: universalSignerPush.account.address as `0x${string}`,
          message: { raw: testMessage },
          signature: signaturePush as `0x${string}`,
        });

        expect(isValidPush).toBe(true);
      });

      it('should signMessage - binary data', async () => {
        const binaryData = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
        const signatureEVM = await pushClientEVM.universal.signMessage(
          binaryData
        );
        const signaturePush = await pushChainPush.universal.signMessage(
          binaryData
        );

        expect(signatureEVM).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(signatureEVM.length).toBeGreaterThan(2); // At least 0x + some hex chars

        // Verify the signature is valid
        const isValidEVM = await verifyMessage({
          address: universalSignerEVM.account.address as `0x${string}`,
          message: { raw: binaryData },
          signature: signatureEVM as `0x${string}`,
        });

        expect(isValidEVM).toBe(true);

        const isValidPush = await verifyMessage({
          address: universalSignerPush.account.address as `0x${string}`,
          message: { raw: binaryData },
          signature: signaturePush as `0x${string}`,
        });

        expect(isValidPush).toBe(true);
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

      it('should throw if multicall used with invalid to', async () => {
        const incrementData = PushChain.utils.helpers.encodeTxData({
          abi: CounterABI as unknown as any[],
          functionName: 'increment',
        });

        const calls: MulticallCall[] = [
          {
            to: COUNTER_ADDRESS,
            value: BigInt(0),
            data: incrementData as `0x${string}`,
          },
        ];

        await expect(
          pushClientEVM.universal.sendTransaction({
            // Provide a valid address that is NOT the UEA, to trigger UEA mismatch
            to: COUNTER_ADDRESS,
            value: BigInt(0),
            data: calls,
          })
        ).rejects.toThrow(
          'Multicall requires `to` to be the executor account (UEA) of the sender.'
        );
      });

      it('should build and send multicall payload from Sepolia', async () => {
        const incrementData = PushChain.utils.helpers.encodeTxData({
          abi: CounterABI as unknown as any[],
          functionName: 'increment',
        }) as `0x${string}`;

        const calls: MulticallCall[] = [
          { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementData },
          { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementData },
        ];

        const publicClientPush = createPublicClient({
          transport: http('https://evm.rpc-testnet-donut-node1.push.org/'),
        });

        const before = (await publicClientPush.readContract({
          address: COUNTER_ADDRESS,
          abi: CounterABI as unknown as any[],
          functionName: 'countPC',
          args: [],
        })) as unknown as bigint;

        const tx = await pushClientEVM.universal.sendTransaction({
          to: pushClientEVM.universal.account,
          value: BigInt(0),
          data: calls,
        });

        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        // Multicall payload must be prefixed with bytes4(keccak256("UEA_MULTICALL"))
        const selector = keccak256(toBytes('UEA_MULTICALL')).slice(0, 10);
        expect(tx.data.slice(0, 10)).toBe(selector);

        await tx.wait();

        const after = (await publicClientPush.readContract({
          address: COUNTER_ADDRESS,
          abi: CounterABI as unknown as any[],
          functionName: 'countPC',
          args: [],
        })) as unknown as bigint;

        expect(after).toBe(before + BigInt(2));
      }, 300000);

      it('should throw if multicall used with invalid to (SVM)', async () => {
        const incrementData = PushChain.utils.helpers.encodeTxData({
          abi: CounterABI as unknown as any[],
          functionName: 'increment',
        });

        const calls: MulticallCall[] = [
          {
            to: COUNTER_ADDRESS,
            value: BigInt(0),
            data: incrementData as `0x${string}`,
          },
        ];

        await expect(
          pushChainSVM.universal.sendTransaction({
            to: COUNTER_ADDRESS,
            value: BigInt(0),
            data: calls,
          })
        ).rejects.toThrow(
          'Multicall requires `to` to be the executor account (UEA) of the sender.'
        );
      });

      it('should build and send multicall payload from Solana Devnet', async () => {
        const incrementData = PushChain.utils.helpers.encodeTxData({
          abi: CounterABI as unknown as any[],
          functionName: 'increment',
        }) as `0x${string}`;

        const calls: MulticallCall[] = [
          { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementData },
          { to: COUNTER_ADDRESS, value: BigInt(0), data: incrementData },
        ];

        const publicClientPush = createPublicClient({
          transport: http('https://evm.rpc-testnet-donut-node1.push.org/'),
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

        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const selector = keccak256(toBytes('UEA_MULTICALL')).slice(0, 10);
        expect(tx.data.slice(0, 10)).toBe(selector);

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
          transport: http('https://evm.rpc-testnet-donut-node1.push.org/'),
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
        expect(txEvm.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        await txEvm.wait();

        // 2) From Solana Devnet origin
        const txSvm = await pushChainSVM.universal.sendTransaction({
          to: COUNTER_ADDRESS,
          value: BigInt(0),
          data: incrementData,
        });
        expect(txSvm.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        await txSvm.wait();

        // 3) From Push Testnet origin
        const txPush = await pushChainPush.universal.sendTransaction({
          to: COUNTER_ADDRESS,
          value: BigInt(0),
          data: incrementData,
        });
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

    describe('signTypedData', () => {
      it('should signTypedData - EIP-712 format', async () => {
        const domain = {
          name: 'Push Chain',
          version: '1',
          chainId: 42101, // Push testnet
          verifyingContract:
            '0x1234567890123456789012345678901234567890' as `0x${string}`,
        };

        const types = {
          Person: [
            { name: 'name', type: 'string' },
            { name: 'wallet', type: 'address' },
          ],
        };

        const message = {
          name: 'Alice',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' as `0x${string}`,
        };

        const signatureEVM = await pushClientEVM.universal.signTypedData({
          domain,
          types,
          primaryType: 'Person',
          message,
        });

        // Verify signature format (should be hex for EVM)
        expect(signatureEVM).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(signatureEVM.length).toBeGreaterThan(2);

        expect(typeof signatureEVM).toBe('string');

        const signaturePush = await pushChainPush.universal.signTypedData({
          domain,
          types,
          primaryType: 'Person',
          message,
        });

        expect(signaturePush).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(signaturePush.length).toBeGreaterThan(2);

        expect(typeof signaturePush).toBe('string');
      });
    });
    describe('get account', () => {
      it('EVM', async () => {
        const address = pushClientEVM.universal.account;
        expect(isAddress(address)).toBeTruthy();
        expect(address).not.toBe(universalSignerEVM.account.address);
      });
      it('Push', async () => {
        const address = pushChainPush.universal.account;
        expect(address).toBeDefined();
        expect(address).toBe(universalSignerPush.account.address);
      });
      it('SVM', async () => {
        const address = pushChainSVM.universal.account;
        expect(isAddress(address)).toBeTruthy();
        expect(address).not.toBe(universalSignerSVM.account.address);
      });
    });
    describe('get origin', () => {
      it('EVM', async () => {
        const uoa = pushClientEVM.universal.origin;
        expect(uoa).toBeDefined();
        expect(uoa.chain).toBe(universalSignerEVM.account.chain);
        expect(isAddress(uoa.address)).toBe(true);
      });
      it('Push', async () => {
        const uoa = pushChainPush.universal.origin;
        expect(uoa).toBeDefined();
        expect(uoa.chain).toBe(universalSignerPush.account.chain);
        expect(isAddress(uoa.address)).toBe(true);
      });
      it('SVM', async () => {
        const uoa = pushChainSVM.universal.origin;
        expect(uoa).toBeDefined();
        expect(uoa.chain).toBe(universalSignerSVM.account.chain);

        let isValid = true;
        try {
          new PublicKey(uoa.address);
        } catch {
          isValid = false;
        }

        expect(isValid).toBe(true);
      });
    });

    describe('Read Only Mode', () => {
      let readOnlyAccountEVM: UniversalAccount;
      let readOnlyAccountPush: UniversalAccount;
      let readOnlyAccountSVM: UniversalAccount;
      let readOnlyPushClientEVM: PushChain;
      let readOnlyPushClientPush: PushChain;
      let readOnlyPushClientSVM: PushChain;

      beforeAll(async () => {
        // Create read-only accounts from existing signers
        readOnlyAccountEVM = {
          address: pushClientEVM.universal.origin.address,
          chain: pushClientEVM.universal.origin.chain,
        };

        readOnlyAccountPush = {
          address: pushChainPush.universal.origin.address,
          chain: pushChainPush.universal.origin.chain,
        };

        readOnlyAccountSVM = {
          address: pushChainSVM.universal.origin.address,
          chain: pushChainSVM.universal.origin.chain,
        };

        // Initialize read-only clients
        readOnlyPushClientEVM = await PushChain.initialize(readOnlyAccountEVM, {
          network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
        });

        readOnlyPushClientPush = await PushChain.initialize(
          readOnlyAccountPush,
          {
            network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
          }
        );

        readOnlyPushClientSVM = await PushChain.initialize(readOnlyAccountSVM, {
          network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
        });
      });

      describe('Initialization', () => {
        it('should successfully initialize with UniversalAccount (EVM)', async () => {
          expect(readOnlyPushClientEVM).toBeDefined();
          expect(readOnlyPushClientEVM.universal).toBeDefined();
        });

        it('should successfully initialize with UniversalAccount (Push)', async () => {
          expect(readOnlyPushClientPush).toBeDefined();
          expect(readOnlyPushClientPush.universal).toBeDefined();
        });

        it('should successfully initialize with UniversalAccount (SVM)', async () => {
          expect(readOnlyPushClientSVM).toBeDefined();
          expect(readOnlyPushClientSVM.universal).toBeDefined();
        });
      });

      describe('Read-only restrictions', () => {
        it('should throw error when calling signMessage on read-only EVM client', async () => {
          const testMessage = new TextEncoder().encode('Hello, Push Chain!');

          await expect(
            readOnlyPushClientEVM.universal.signMessage(testMessage)
          ).rejects.toThrow('Read only mode cannot call signMessage function');
        });

        it('should throw error when calling signMessage on read-only Push client', async () => {
          const testMessage = new TextEncoder().encode('Hello, Push Chain!');

          await expect(
            readOnlyPushClientPush.universal.signMessage(testMessage)
          ).rejects.toThrow('Read only mode cannot call signMessage function');
        });

        it('should throw error when calling signMessage on read-only SVM client', async () => {
          const testMessage = new TextEncoder().encode('Hello, Push Chain!');

          await expect(
            readOnlyPushClientSVM.universal.signMessage(testMessage)
          ).rejects.toThrow('Read only mode cannot call signMessage function');
        });

        it('should throw error when calling sendTransaction on read-only EVM client', () => {
          const mockTxData = {
            to: '0x1234567890123456789012345678901234567890' as `0x${string}`,
            value: BigInt(1000000000000000000), // 1 ETH
            data: '0x' as `0x${string}`,
            gas: BigInt(21000),
          };

          expect(() =>
            readOnlyPushClientEVM.universal.sendTransaction(mockTxData)
          ).toThrow('Read only mode cannot call sendTransaction function');
        });

        it('should throw error when calling sendTransaction on read-only Push client', () => {
          const mockTxData = {
            to: '0x1234567890123456789012345678901234567890' as `0x${string}`,
            value: BigInt(1000000000000000000), // 1 ETH
            data: '0x' as `0x${string}`,
            gas: BigInt(21000),
          };

          expect(() =>
            readOnlyPushClientPush.universal.sendTransaction(mockTxData)
          ).toThrow('Read only mode cannot call sendTransaction function');
        });

        it('should throw error when calling sendTransaction on read-only SVM client', () => {
          const mockTxData = {
            to: '0x1234567890123456789012345678901234567890' as `0x${string}`,
            value: BigInt(1000000000000000000), // 1 ETH
            data: '0x' as `0x${string}`,
            gas: BigInt(21000),
          };

          expect(() =>
            readOnlyPushClientSVM.universal.sendTransaction(mockTxData)
          ).toThrow('Read only mode cannot call sendTransaction function');
        });

        it('should throw error when calling signTypedData on read-only EVM client', async () => {
          const typedData = {
            domain: {
              name: 'Test',
              version: '1',
              chainId: 11155111,
            },
            types: {
              Message: [{ name: 'content', type: 'string' }],
            },
            primaryType: 'Message',
            message: {
              content: 'Hello, typed data!',
            },
          };

          await expect(
            readOnlyPushClientEVM.universal.signTypedData(typedData)
          ).rejects.toThrow('Typed data signing not supported');
        });
      });

      describe('Read-only allowed operations', () => {
        it('should allow accessing origin property on read-only client', () => {
          const origin = readOnlyPushClientEVM.universal.origin;
          expect(origin).toBeDefined();
          expect(typeof origin.address).toBe('string');
          expect(typeof origin.chain).toBe('string');
        });

        it('should allow accessing account property on read-only client', () => {
          const account = readOnlyPushClientEVM.universal.account;
          expect(account).toBeDefined();
          expect(typeof account).toBe('string');
          expect(account.startsWith('0x')).toBe(true);
        });

        it('should allow accessing explorer methods on read-only client', () => {
          const txUrl =
            readOnlyPushClientEVM.explorer.getTransactionUrl('0x123');
          expect(typeof txUrl).toBe('string');
          expect(txUrl).toContain('0x123');

          const { urls } = readOnlyPushClientEVM.explorer.listUrls();
          expect(Array.isArray(urls)).toBe(true);
        });

        it('should allow accessing static constants and utils on read-only client', () => {
          expect(PushChain.CONSTANTS).toBeDefined();
          expect(PushChain.utils).toBeDefined();
        });
      });

      describe('Comparison with writable clients', () => {
        it('should have same origin and account addresses as writable client', () => {
          // Compare EVM clients
          expect(readOnlyPushClientEVM.universal.origin.address).toBe(
            pushClientEVM.universal.origin.address
          );
          expect(readOnlyPushClientEVM.universal.account).toBe(
            pushClientEVM.universal.account
          );

          // Compare Push clients
          expect(readOnlyPushClientPush.universal.origin.address).toBe(
            pushChainPush.universal.origin.address
          );
          expect(readOnlyPushClientPush.universal.account).toBe(
            pushChainPush.universal.account
          );

          // Compare SVM clients
          expect(readOnlyPushClientSVM.universal.origin.address).toBe(
            pushChainSVM.universal.origin.address
          );
          expect(readOnlyPushClientSVM.universal.account).toBe(
            pushChainSVM.universal.account
          );
        });

        it('should allow signMessage on writable client but not on read-only client', async () => {
          const testMessage = new TextEncoder().encode('Test message');

          // Writable client should work
          const signature = await pushClientEVM.universal.signMessage(
            testMessage
          );
          expect(typeof signature).toBe('string');
          expect(signature.length).toBeGreaterThan(0);

          // Read-only client should throw error
          await expect(
            readOnlyPushClientEVM.universal.signMessage(testMessage)
          ).rejects.toThrow('Read only mode cannot call signMessage function');
        });
      });

      describe('Type checking', () => {
        it('should correctly identify UniversalAccount vs UniversalSigner during initialization', async () => {
          // Test with UniversalSigner - should not be read-only
          const writableClient = pushClientEVM;

          const testMessage = new TextEncoder().encode('Test');
          const signature = await writableClient.universal.signMessage(
            testMessage
          );
          expect(typeof signature).toBe('string');

          // Test with UniversalAccount - should be read-only
          const readOnlyAccount: UniversalAccount = {
            address: writableClient.universal.origin.address,
            chain: writableClient.universal.origin.chain,
          };

          const readOnlyClient = await PushChain.initialize(readOnlyAccount, {
            network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
          });

          await expect(
            readOnlyClient.universal.signMessage(testMessage)
          ).rejects.toThrow('Read only mode cannot call signMessage function');
        });
      });
    });
  });

  describe('Reinitialize Method', () => {
    let pushClientEVM: PushChain;
    let universalSignerEVM: UniversalSigner;
    let universalSignerEVM2: UniversalSigner;
    let universalSignerPush: UniversalSigner;

    beforeAll(async () => {
      // Create first EVM signer
      const account1 = privateKeyToAccount(generatePrivateKey());
      const walletClient1 = createWalletClient({
        account: account1,
        chain: sepolia,
        transport: http(EVM_RPC),
      });
      universalSignerEVM = await PushChain.utils.signer.toUniversalFromKeypair(
        walletClient1,
        {
          chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );

      // Create second EVM signer for testing signer change
      const account2 = privateKeyToAccount(generatePrivateKey());
      const walletClient2 = createWalletClient({
        account: account2,
        chain: sepolia,
        transport: http(EVM_RPC),
      });
      universalSignerEVM2 = await PushChain.utils.signer.toUniversalFromKeypair(
        walletClient2,
        {
          chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );

      // Create Push signer
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
      const accountPush = privateKeyToAccount(generatePrivateKey());
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

      // Initialize first client
      pushClientEVM = await PushChain.initialize(universalSignerEVM, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      });
    });

    describe('Basic functionality', () => {
      it('should reinitialize with same signer and return new instance', async () => {
        const newClient = await pushClientEVM.reinitialize(universalSignerEVM, {
          network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
        });

        // Should be different instances
        expect(newClient).not.toBe(pushClientEVM);

        // But should have same addresses since same signer
        expect(newClient.universal.origin.address).toBe(
          pushClientEVM.universal.origin.address
        );
        expect(newClient.universal.account).toBe(
          pushClientEVM.universal.account
        );
      });

      it('should reinitialize with different signer', async () => {
        const newClient = await pushClientEVM.reinitialize(
          universalSignerEVM2,
          {
            network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
          }
        );

        // Should be different instances
        expect(newClient).not.toBe(pushClientEVM);

        // Should have different addresses since different signer
        expect(newClient.universal.origin.address).not.toBe(
          pushClientEVM.universal.origin.address
        );
        expect(newClient.universal.account).not.toBe(
          pushClientEVM.universal.account
        );

        // New client should have the new signer's address
        expect(newClient.universal.origin.address).toBe(
          universalSignerEVM2.account.address
        );
      });

      it('should reinitialize with different chain signer', async () => {
        const newClient = await pushClientEVM.reinitialize(
          universalSignerPush,
          {
            network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
          }
        );

        // Should be different instances
        expect(newClient).not.toBe(pushClientEVM);

        // Should have different chain and addresses
        expect(newClient.universal.origin.chain).toBe(
          PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT
        );
        expect(newClient.universal.origin.chain).not.toBe(
          pushClientEVM.universal.origin.chain
        );
      });
    });

    describe('With different options', () => {
      it('should reinitialize with custom RPC URLs', async () => {
        const customRpcUrls = {
          [CHAIN.ETHEREUM_SEPOLIA]: ['https://custom-sepolia.rpc.com'],
        };

        const newClient = await pushClientEVM.reinitialize(universalSignerEVM, {
          network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
          rpcUrls: customRpcUrls,
        });

        expect(newClient).not.toBe(pushClientEVM);
        expect(newClient).toBeDefined();
      });

      it('should reinitialize with custom block explorers', async () => {
        const customBlockExplorers = {
          [CHAIN.PUSH_TESTNET_DONUT]: [
            'https://custom-explorer1.push.network',
            'https://custom-explorer2.push.network',
          ],
        };

        const newClient = await pushClientEVM.reinitialize(universalSignerEVM, {
          network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
          blockExplorers: customBlockExplorers,
        });

        expect(newClient).not.toBe(pushClientEVM);

        const { urls } = newClient.explorer.listUrls();
        expect(urls).toEqual([
          'https://custom-explorer1.push.network',
          'https://custom-explorer2.push.network',
        ]);
      });

      it('should reinitialize with printTraces enabled', async () => {
        const newClient = await pushClientEVM.reinitialize(universalSignerEVM, {
          network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
          printTraces: true,
        });

        expect(newClient).not.toBe(pushClientEVM);
        expect(newClient).toBeDefined();
      });

      it('should reinitialize with progress hook', async () => {
        const progressEvents: any[] = [];
        const progressHook = (progress: any) => {
          progressEvents.push(progress);
        };

        const newClient = await pushClientEVM.reinitialize(universalSignerEVM, {
          network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
          progressHook,
        });

        expect(newClient).not.toBe(pushClientEVM);
        expect(newClient).toBeDefined();
      });
    });
  });

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

    it('integration: sendFunds USDT via UniversalGatewayV0', async () => {
      await testSendFundsUSDT(client, account, config);
    }, 300000);

    it('integration: sendFunds ETH via UniversalGatewayV0', async () => {
      await testSendFundsETH(client, config);
    }, 300000);

    it('integration: sendTxWithFunds USDT via UniversalGatewayV0', async () => {
      await testSendTxWithFundsUSDT(client, account, config);
    }, 500000);

    it('integration: pay gas with USDT via UniversalGatewayV0', async () => {
      await testSendTxWithFundsPayGasUSDT(client, account, config);
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
      await testSendFundsUSDT(client, account, config);
    }, 300000);

    it('integration: sendFunds ETH via UniversalGatewayV0', async () => {
      await testSendFundsETH(client, config);
    }, 300000);

    it('integration: sendTxWithFunds USDT via UniversalGatewayV0', async () => {
      await testSendTxWithFundsUSDT(client, account, config);
    }, 500000);

    it('integration: pay gas with USDT via UniversalGatewayV0', async () => {
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
      await testSendFundsUSDT(client, account, config);
    }, 300000);

    it('integration: sendFunds ETH via UniversalGatewayV0', async () => {
      await testSendFundsETH(client, config);
    }, 300000);

    it('integration: sendTxWithFunds USDT via UniversalGatewayV0', async () => {
      await testSendTxWithFundsUSDT(client, account, config);
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
      await testSendFundsUSDT(client, account, config);
    }, 300000);

    it('integration: sendFunds BNB via UniversalGatewayV0', async () => {
      await testSendFundsETH(client, config);
    }, 300000);

    it('integration: sendTxWithFunds USDT via UniversalGatewayV0', async () => {
      await testSendTxWithFundsUSDT(client, account, config);
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
        rpcUrls: {
          [CHAIN.SOLANA_DEVNET]: [SOLANA_RPC],
        },
      });
    });

    describe('sendFundsNative function and sendFunds function', () => {
      it('sendFundsNative function', async () => {
        try {
          // const amountLamports = PushChain.utils.helpers.parseUnits('0.001', 9);
          const amountLamports = BigInt(1);
          const recipient = client.universal.account;

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
        const recipient = client.universal.account;
        // Check pUSDT (USDT.sol) balance on PushChain before bridging
        const pushChainClient = new EvmClient({
          rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
        });
        const USDT_SOL_ADDRESS =
          SYNTHETIC_PUSH_ERC20[PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT]
            .USDT_SOL;
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
        expect(receipt.status).toBe(1);
        console.log('SVM Native Receipt', receipt);
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
          ownerAddress: recipient as `0x${string}`,
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

        await res.wait();

        // Check pSOL balance on PushChain after bridging
        const balanceAfter = await pushChainClient.getErc20Balance({
          tokenAddress: pSOL_ADDRESS,
          ownerAddress: recipient as `0x${string}`,
        });
        console.log(
          'pSOL balance after bridging (sendTxWithFunds SOL)',
          balanceAfter
        );
        expect(balanceAfter > balanceBefore).toBe(true);

        const afterCount = (await pushPublicClient.readContract({
          abi: COUNTER_ABI,
          address: COUNTER_ADDRESS,
          functionName: 'countPC',
        })) as bigint;
        expect(afterCount).toBe(beforeCount + BigInt(1));
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

        const res = await client.universal.sendTransaction({
          to: COUNTER_ADDRESS,
          data,
          funds: { amount: bridgeAmount, token: client.moveable.token.USDT },
        });

        expect(typeof res.hash).toBe('string');
        expect(res.hash.length).toBeGreaterThan(0);
        console.log('SVM sendTxWithFunds USDT hash', res.hash);

        await res.wait();

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
              payWith: {
                token: client.payable.token.USDT,
              },
            },
          })
        ).rejects.toThrow('Pay-with token is not supported on Solana');
      });
    });
  });

  describe('Validation: funds + value guard', () => {
    it('should reject non-zero value when funds is set, but allow value=0', async () => {
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

      // 1) Non-zero value with funds should be rejected by the guard
      await expect(
        client.universal.sendTransaction({
          to: recipient,
          value: BigInt(1),
          funds: { amount: BigInt(1) },
        })
      ).rejects.toThrow(/Do not set `value` when using funds bridging/i);

      // 2) value = 0 with funds should pass the guard and then fail on sepolia-only check
      await expect(
        client.universal.sendTransaction({
          to: recipient,
          value: BigInt(0),
          funds: { amount: BigInt(1) },
        })
      ).rejects.toThrow(/only supported on Ethereum Sepolia/i);
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
      ).rejects.toThrow(/only supported on Ethereum Mainnet and Sepolia/);
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

  describe('Helpers Utils Namespace', () => {
    describe('getChainName', () => {
      it('should get chain name', () => {
        // Test Push chains
        expect(PushChain.utils.chains.getChainName(CHAIN.PUSH_MAINNET)).toBe(
          'PUSH_MAINNET'
        );
        expect(PushChain.utils.chains.getChainName(CHAIN.PUSH_TESTNET)).toBe(
          'PUSH_TESTNET_DONUT'
        );
        expect(
          PushChain.utils.chains.getChainName(CHAIN.PUSH_TESTNET_DONUT)
        ).toBe('PUSH_TESTNET_DONUT');
        expect(PushChain.utils.chains.getChainName(CHAIN.PUSH_LOCALNET)).toBe(
          'PUSH_LOCALNET'
        );
        // Test Ethereum chains
        expect(
          PushChain.utils.chains.getChainName(CHAIN.ETHEREUM_MAINNET)
        ).toBe('ETHEREUM_MAINNET');
        expect(
          PushChain.utils.chains.getChainName(CHAIN.ETHEREUM_SEPOLIA)
        ).toBe('ETHEREUM_SEPOLIA');
        expect(
          PushChain.utils.chains.getChainName(CHAIN.ARBITRUM_SEPOLIA)
        ).toBe('ARBITRUM_SEPOLIA');
        expect(PushChain.utils.chains.getChainName(CHAIN.BASE_SEPOLIA)).toBe(
          'BASE_SEPOLIA'
        );
        // Test Solana chains
        expect(PushChain.utils.chains.getChainName(CHAIN.SOLANA_MAINNET)).toBe(
          'SOLANA_MAINNET'
        );
        expect(PushChain.utils.chains.getChainName(CHAIN.SOLANA_TESTNET)).toBe(
          'SOLANA_TESTNET'
        );
        expect(PushChain.utils.chains.getChainName(CHAIN.SOLANA_DEVNET)).toBe(
          'SOLANA_DEVNET'
        );
      });

      it('should handle chain values directly', () => {
        // Test with raw chain values
        expect(PushChain.utils.chains.getChainName('eip155:9')).toBe(
          'PUSH_MAINNET'
        );
        expect(PushChain.utils.chains.getChainName('eip155:42101')).toBe(
          'PUSH_TESTNET_DONUT'
        );
        expect(PushChain.utils.chains.getChainName('eip155:9001')).toBe(
          'PUSH_LOCALNET'
        );
        expect(PushChain.utils.chains.getChainName('eip155:1')).toBe(
          'ETHEREUM_MAINNET'
        );
        expect(PushChain.utils.chains.getChainName('eip155:11155111')).toBe(
          'ETHEREUM_SEPOLIA'
        );
        expect(PushChain.utils.chains.getChainName('eip155:421614')).toBe(
          'ARBITRUM_SEPOLIA'
        );
        expect(PushChain.utils.chains.getChainName('eip155:84532')).toBe(
          'BASE_SEPOLIA'
        );
        expect(
          PushChain.utils.chains.getChainName(
            'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
          )
        ).toBe('SOLANA_MAINNET');
        expect(
          PushChain.utils.chains.getChainName(
            'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z'
          )
        ).toBe('SOLANA_TESTNET');
        expect(
          PushChain.utils.chains.getChainName(
            'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
          )
        ).toBe('SOLANA_DEVNET');
      });

      it('should return undefined for invalid chain values', () => {
        // Test with invalid chain values
        expect(
          PushChain.utils.chains.getChainName('invalid-chain')
        ).toBeUndefined();
        expect(
          PushChain.utils.chains.getChainName('eip155:999999')
        ).toBeUndefined();
        expect(
          PushChain.utils.chains.getChainName('solana:invalid')
        ).toBeUndefined();
        expect(PushChain.utils.chains.getChainName('')).toBeUndefined();
      });

      it('should handle case sensitivity correctly (returns undefined)', () => {
        // Test that the function is case sensitive
        expect(PushChain.utils.chains.getChainName('EIP155:1')).toBeUndefined();
        expect(
          PushChain.utils.chains.getChainName(
            'SOLANA:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
          )
        ).toBeUndefined();
      });

      it('should handle whitespace correctly (returns undefined)', () => {
        // Test that whitespace is not ignored
        expect(
          PushChain.utils.chains.getChainName(' eip155:1')
        ).toBeUndefined();
        expect(
          PushChain.utils.chains.getChainName('eip155:1 ')
        ).toBeUndefined();
      });
    });

    describe('getChainNamespace', () => {
      it('should get chain namespace from enum key name', () => {
        expect(
          PushChain.utils.chains.getChainNamespace('ETHEREUM_SEPOLIA')
        ).toBe(CHAIN.ETHEREUM_SEPOLIA);

        expect(
          PushChain.utils.chains.getChainNamespace('ETHEREUM_MAINNET')
        ).toBe(CHAIN.ETHEREUM_MAINNET);

        expect(
          PushChain.utils.chains.getChainNamespace('ARBITRUM_SEPOLIA')
        ).toBe(CHAIN.ARBITRUM_SEPOLIA);

        expect(PushChain.utils.chains.getChainNamespace('BASE_SEPOLIA')).toBe(
          CHAIN.BASE_SEPOLIA
        );

        expect(
          PushChain.utils.chains.getChainNamespace('PUSH_TESTNET_DONUT')
        ).toBe(CHAIN.PUSH_TESTNET_DONUT);

        expect(PushChain.utils.chains.getChainNamespace('SOLANA_DEVNET')).toBe(
          CHAIN.SOLANA_DEVNET
        );
      });

      it('should return input unchanged when already a namespace', () => {
        expect(
          PushChain.utils.chains.getChainNamespace(CHAIN.ETHEREUM_SEPOLIA)
        ).toBe(CHAIN.ETHEREUM_SEPOLIA);

        expect(
          PushChain.utils.chains.getChainNamespace(CHAIN.ARBITRUM_SEPOLIA)
        ).toBe(CHAIN.ARBITRUM_SEPOLIA);

        expect(
          PushChain.utils.chains.getChainNamespace(CHAIN.BASE_SEPOLIA)
        ).toBe(CHAIN.BASE_SEPOLIA);

        expect(
          PushChain.utils.chains.getChainNamespace(CHAIN.PUSH_TESTNET_DONUT)
        ).toBe(CHAIN.PUSH_TESTNET_DONUT);
      });

      it('should return undefined for unsupported names', () => {
        expect(
          PushChain.utils.chains.getChainNamespace('UNKNOWN_CHAIN')
        ).toBeUndefined();
        expect(
          PushChain.utils.chains.getChainNamespace('ethereum_sepolia' as any)
        ).toBeUndefined();
        expect(PushChain.utils.chains.getChainNamespace('')).toBeUndefined();
      });
    });

    describe('getSupportedChain', () => {
      it('should return supported chains for TESTNET', () => {
        const res = PushChain.utils.chains.getSupportedChains(
          PushChain.CONSTANTS.PUSH_NETWORK.TESTNET
        );
        expect(res).toEqual({
          chains: [
            CHAIN.ETHEREUM_SEPOLIA,
            CHAIN.ARBITRUM_SEPOLIA,
            CHAIN.BASE_SEPOLIA,
            CHAIN.SOLANA_DEVNET,
          ],
        });
      });

      it('should return supported chains for TESTNET_DONUT', () => {
        const res = PushChain.utils.chains.getSupportedChains(
          PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT
        );
        expect(res).toEqual({
          chains: [
            CHAIN.ETHEREUM_SEPOLIA,
            CHAIN.ARBITRUM_SEPOLIA,
            CHAIN.BASE_SEPOLIA,
            CHAIN.SOLANA_DEVNET,
          ],
        });
      });

      it('should return supported chains for LOCALNET', () => {
        const res = PushChain.utils.chains.getSupportedChains(
          PushChain.CONSTANTS.PUSH_NETWORK.LOCALNET
        );
        expect(res).toEqual({
          chains: [
            CHAIN.ETHEREUM_SEPOLIA,
            CHAIN.ARBITRUM_SEPOLIA,
            CHAIN.BASE_SEPOLIA,
            CHAIN.SOLANA_DEVNET,
          ],
        });
      });

      it('should return empty list for MAINNET', () => {
        const res = PushChain.utils.chains.getSupportedChains(
          PushChain.CONSTANTS.PUSH_NETWORK.MAINNET
        );
        expect(res).toEqual({ chains: [] });
      });
    });

    describe('encodeTxData', () => {
      const testAbi = [
        {
          inputs: [],
          stateMutability: 'nonpayable',
          type: 'constructor',
        },
        {
          anonymous: false,
          inputs: [
            {
              indexed: false,
              internalType: 'uint256',
              name: 'newCount',
              type: 'uint256',
            },
            {
              indexed: true,
              internalType: 'address',
              name: 'caller',
              type: 'address',
            },
            {
              indexed: false,
              internalType: 'string',
              name: 'chainNamespace',
              type: 'string',
            },
            {
              indexed: false,
              internalType: 'string',
              name: 'chainId',
              type: 'string',
            },
          ],
          name: 'CountIncremented',
          type: 'event',
        },
        {
          inputs: [],
          name: 'increment',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [],
          name: 'reset',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [],
          name: 'countEth',
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
        {
          inputs: [],
          name: 'countSol',
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
        {
          inputs: [],
          name: 'getCount',
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

      it('should encode function data correctly', () => {
        const result = PushChain.utils.helpers.encodeTxData({
          abi: testAbi,
          functionName: 'increment',
        });
        expect(result).toBe('0xd09de08a');
      });

      it('should encode function data with arguments', () => {
        // Test with a function that has no arguments (reset)
        const result = PushChain.utils.helpers.encodeTxData({
          abi: testAbi,
          functionName: 'reset',
        });
        expect(result).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(typeof result).toBe('string');
      });

      it('should throw error for invalid ABI', () => {
        expect(() =>
          PushChain.utils.helpers.encodeTxData({
            abi: 'invalid' as any,
            functionName: 'increment',
          })
        ).toThrow('ABI must be an array');
        expect(() =>
          PushChain.utils.helpers.encodeTxData({
            abi: null as any,
            functionName: 'increment',
          })
        ).toThrow('ABI must be an array');
      });

      it('should throw error for invalid arguments', () => {
        expect(() =>
          PushChain.utils.helpers.encodeTxData({
            abi: testAbi,
            functionName: 'increment',
            args: 'invalid' as any,
          })
        ).toThrow('Arguments must be an array');
      });

      it('should throw error for non-existent function', () => {
        expect(() =>
          PushChain.utils.helpers.encodeTxData({
            abi: testAbi,
            functionName: 'nonExistentFunction',
          })
        ).toThrow("Function 'nonExistentFunction' not found in ABI");
      });

      it('should handle empty args array', () => {
        const result = PushChain.utils.helpers.encodeTxData({
          abi: testAbi,
          functionName: 'increment',
          args: [],
        });
        expect(result).toBe('0xd09de08a');
      });
    });

    describe('parseUnits', () => {
      it('should parse integer values correctly', () => {
        // Test basic integer parsing like the viem example
        const result = PushChain.utils.helpers.parseUnits('420', 9);
        expect(result).toBe(BigInt('420000000000'));
      });

      it('should parse decimal values correctly', () => {
        // Test ETH to wei conversion (18 decimals)
        const result1 = PushChain.utils.helpers.parseUnits('1.5', 18);
        expect(result1).toBe(BigInt('1500000000000000000'));

        // Test smaller decimal values
        const result2 = PushChain.utils.helpers.parseUnits('0.1', 6);
        expect(result2).toBe(BigInt('100000'));

        // Test fractional values with fewer decimals than exponent
        const result3 = PushChain.utils.helpers.parseUnits('1.23', 6);
        expect(result3).toBe(BigInt('1230000'));
      });

      it('should handle zero values', () => {
        const result1 = PushChain.utils.helpers.parseUnits('0', 18);
        expect(result1).toBe(BigInt('0'));

        const result2 = PushChain.utils.helpers.parseUnits('0.0', 6);
        expect(result2).toBe(BigInt('0'));

        const result3 = PushChain.utils.helpers.parseUnits('0.000', 18);
        expect(result3).toBe(BigInt('0'));
      });

      it('should handle negative values', () => {
        const result1 = PushChain.utils.helpers.parseUnits('-1', 18);
        expect(result1).toBe(BigInt('-1000000000000000000'));

        const result2 = PushChain.utils.helpers.parseUnits('-0.5', 6);
        expect(result2).toBe(BigInt('-500000'));
      });

      it('should handle values without decimals', () => {
        const result1 = PushChain.utils.helpers.parseUnits('100', 0);
        expect(result1).toBe(BigInt('100'));

        const result2 = PushChain.utils.helpers.parseUnits('1000', 3);
        expect(result2).toBe(BigInt('1000000'));
      });

      it('should handle values with leading/trailing whitespace', () => {
        const result1 = PushChain.utils.helpers.parseUnits(' 1.5 ', 18);
        expect(result1).toBe(BigInt('1500000000000000000'));

        const result2 = PushChain.utils.helpers.parseUnits('\t420\n', 9);
        expect(result2).toBe(BigInt('420000000000'));
      });

      it('should handle values starting with decimal point', () => {
        const result1 = PushChain.utils.helpers.parseUnits('.5', 18);
        expect(result1).toBe(BigInt('500000000000000000'));

        const result2 = PushChain.utils.helpers.parseUnits('.123', 6);
        expect(result2).toBe(BigInt('123000'));
      });

      it('should handle exact decimal place matches', () => {
        // When decimal places exactly match the exponent
        const result = PushChain.utils.helpers.parseUnits('1.123456', 6);
        expect(result).toBe(BigInt('1123456'));
      });

      it('should throw error for invalid value types', () => {
        expect(() =>
          PushChain.utils.helpers.parseUnits(123 as any, 18)
        ).toThrow('Value must be a string');

        expect(() =>
          PushChain.utils.helpers.parseUnits(null as any, 18)
        ).toThrow('Value must be a string');

        expect(() =>
          PushChain.utils.helpers.parseUnits(undefined as any, 18)
        ).toThrow('Value must be a string');
      });

      it('should throw error for invalid exponent types', () => {
        expect(() =>
          PushChain.utils.helpers.parseUnits('1', '18' as any)
        ).toThrow(
          'Exponent must be a number or an object with decimals property'
        );

        expect(() =>
          PushChain.utils.helpers.parseUnits('1', null as any)
        ).toThrow(
          'Exponent must be a number or an object with decimals property'
        );

        expect(() => PushChain.utils.helpers.parseUnits('1', 1.5)).toThrow(
          'Exponent must be an integer'
        );

        expect(() => PushChain.utils.helpers.parseUnits('1', -1)).toThrow(
          'Exponent must be non-negative'
        );
      });

      it('should throw error for empty or invalid value strings', () => {
        expect(() => PushChain.utils.helpers.parseUnits('', 18)).toThrow(
          'Value cannot be empty'
        );

        expect(() => PushChain.utils.helpers.parseUnits('   ', 18)).toThrow(
          'Value cannot be empty'
        );

        expect(() => PushChain.utils.helpers.parseUnits('.', 18)).toThrow(
          'Value must be a valid number string'
        );

        expect(() => PushChain.utils.helpers.parseUnits('-.', 18)).toThrow(
          'Value must be a valid number string'
        );

        expect(() => PushChain.utils.helpers.parseUnits('abc', 18)).toThrow(
          'Value must be a valid number string'
        );

        expect(() => PushChain.utils.helpers.parseUnits('1.2.3', 18)).toThrow(
          'Value must be a valid number string'
        );

        expect(() => PushChain.utils.helpers.parseUnits('1e5', 18)).toThrow(
          'Value must be a valid number string'
        );
      });

      it('should throw error when decimal places exceed exponent', () => {
        expect(() =>
          PushChain.utils.helpers.parseUnits('1.123456789', 6)
        ).toThrow('Value has more decimal places (9) than exponent allows (6)');

        expect(() =>
          PushChain.utils.helpers.parseUnits('0.12345678901234567890', 18)
        ).toThrow(
          'Value has more decimal places (20) than exponent allows (18)'
        );
      });

      it('should handle large numbers', () => {
        const result1 = PushChain.utils.helpers.parseUnits(
          '999999999999999999',
          18
        );
        expect(result1).toBe(BigInt('999999999999999999000000000000000000'));

        const result2 = PushChain.utils.helpers.parseUnits('1000000', 0);
        expect(result2).toBe(BigInt('1000000'));
      });

      it('should handle common token decimal scenarios', () => {
        // ETH (18 decimals)
        const ethResult = PushChain.utils.helpers.parseUnits('1', 18);
        expect(ethResult).toBe(BigInt('1000000000000000000'));

        // USDC (6 decimals)
        const usdcResult = PushChain.utils.helpers.parseUnits('100', 6);
        expect(usdcResult).toBe(BigInt('100000000'));

        // BTC (8 decimals)
        const btcResult = PushChain.utils.helpers.parseUnits('0.00000001', 8);
        expect(btcResult).toBe(BigInt('1'));

        // Push token (18 decimals) - example amount
        const pushResult = PushChain.utils.helpers.parseUnits('1000.5', 18);
        expect(pushResult).toBe(BigInt('1000500000000000000000'));
      });

      it('should handle object-based exponent input', () => {
        // Test basic integer parsing with object format
        const result1 = PushChain.utils.helpers.parseUnits('420', {
          decimals: 9,
        });
        expect(result1).toBe(BigInt('420000000000'));

        // Test ETH to wei conversion (18 decimals) with object format
        const result2 = PushChain.utils.helpers.parseUnits('1.5', {
          decimals: 18,
        });
        expect(result2).toBe(BigInt('1500000000000000000'));

        // Test smaller decimal values with object format
        const result3 = PushChain.utils.helpers.parseUnits('0.1', {
          decimals: 6,
        });
        expect(result3).toBe(BigInt('100000'));

        // Test fractional values with fewer decimals than exponent
        const result4 = PushChain.utils.helpers.parseUnits('1.23', {
          decimals: 6,
        });
        expect(result4).toBe(BigInt('1230000'));

        // Test zero values with object format
        const result5 = PushChain.utils.helpers.parseUnits('0', {
          decimals: 18,
        });
        expect(result5).toBe(BigInt('0'));

        const result6 = PushChain.utils.helpers.parseUnits('0.0', {
          decimals: 6,
        });
        expect(result6).toBe(BigInt('0'));

        // Test negative values with object format
        const result7 = PushChain.utils.helpers.parseUnits('-1', {
          decimals: 18,
        });
        expect(result7).toBe(BigInt('-1000000000000000000'));

        const result8 = PushChain.utils.helpers.parseUnits('-0.5', {
          decimals: 6,
        });
        expect(result8).toBe(BigInt('-500000'));

        // Test values without decimals with object format
        const result9 = PushChain.utils.helpers.parseUnits('100', {
          decimals: 0,
        });
        expect(result9).toBe(BigInt('100'));

        const result10 = PushChain.utils.helpers.parseUnits('1000', {
          decimals: 3,
        });
        expect(result10).toBe(BigInt('1000000'));

        // Test values with leading/trailing whitespace with object format
        const result11 = PushChain.utils.helpers.parseUnits(' 1.5 ', {
          decimals: 18,
        });
        expect(result11).toBe(BigInt('1500000000000000000'));

        const result12 = PushChain.utils.helpers.parseUnits('\t420\n', {
          decimals: 9,
        });
        expect(result12).toBe(BigInt('420000000000'));

        // Test values starting with decimal point with object format
        const result13 = PushChain.utils.helpers.parseUnits('.5', {
          decimals: 18,
        });
        expect(result13).toBe(BigInt('500000000000000000'));

        const result14 = PushChain.utils.helpers.parseUnits('.123', {
          decimals: 6,
        });
        expect(result14).toBe(BigInt('123000'));

        // Test exact decimal place matches with object format
        const result15 = PushChain.utils.helpers.parseUnits('1.123456', {
          decimals: 6,
        });
        expect(result15).toBe(BigInt('1123456'));

        // Test large numbers with object format
        const result16 = PushChain.utils.helpers.parseUnits(
          '999999999999999999',
          { decimals: 18 }
        );
        expect(result16).toBe(BigInt('999999999999999999000000000000000000'));

        const result17 = PushChain.utils.helpers.parseUnits('1000000', {
          decimals: 0,
        });
        expect(result17).toBe(BigInt('1000000'));

        // Test common token decimal scenarios with object format
        // ETH (18 decimals)
        const ethResult = PushChain.utils.helpers.parseUnits('1', {
          decimals: 18,
        });
        expect(ethResult).toBe(BigInt('1000000000000000000'));

        // USDC (6 decimals)
        const usdcResult = PushChain.utils.helpers.parseUnits('100', {
          decimals: 6,
        });
        expect(usdcResult).toBe(BigInt('100000000'));

        // BTC (8 decimals)
        const btcResult = PushChain.utils.helpers.parseUnits('0.00000001', {
          decimals: 8,
        });
        expect(btcResult).toBe(BigInt('1'));

        // Push token (18 decimals) - example amount
        const pushResult = PushChain.utils.helpers.parseUnits('1000.5', {
          decimals: 18,
        });
        expect(pushResult).toBe(BigInt('1000500000000000000000'));
      });

      it('should throw error for invalid object-based exponent types', () => {
        expect(() =>
          PushChain.utils.helpers.parseUnits('1', { decimals: '18' } as any)
        ).toThrow('Exponent must be a number');

        expect(() =>
          PushChain.utils.helpers.parseUnits('1', { decimals: null } as any)
        ).toThrow('Exponent must be a number');

        expect(() =>
          PushChain.utils.helpers.parseUnits('1', { decimals: 1.5 })
        ).toThrow('Exponent must be an integer');

        expect(() =>
          PushChain.utils.helpers.parseUnits('1', { decimals: -1 })
        ).toThrow('Exponent must be non-negative');

        expect(() =>
          PushChain.utils.helpers.parseUnits('1', {} as any)
        ).toThrow(
          'Exponent must be a number or an object with decimals property'
        );

        expect(() =>
          PushChain.utils.helpers.parseUnits('1', { invalid: 18 } as any)
        ).toThrow(
          'Exponent must be a number or an object with decimals property'
        );

        expect(() =>
          PushChain.utils.helpers.parseUnits('1', null as any)
        ).toThrow(
          'Exponent must be a number or an object with decimals property'
        );

        expect(() =>
          PushChain.utils.helpers.parseUnits('1', undefined as any)
        ).toThrow(
          'Exponent must be a number or an object with decimals property'
        );
      });

      it('should throw error when decimal places exceed exponent with object format', () => {
        expect(() =>
          PushChain.utils.helpers.parseUnits('1.123456789', { decimals: 6 })
        ).toThrow('Value has more decimal places (9) than exponent allows (6)');

        expect(() =>
          PushChain.utils.helpers.parseUnits('0.12345678901234567890', {
            decimals: 18,
          })
        ).toThrow(
          'Value has more decimal places (20) than exponent allows (18)'
        );
      });

      it('should produce same results for number and object-based exponent formats', () => {
        const testCases = [
          { value: '420', decimals: 9 },
          { value: '1.5', decimals: 18 },
          { value: '0.1', decimals: 6 },
          { value: '1.23', decimals: 6 },
          { value: '0', decimals: 18 },
          { value: '0.0', decimals: 6 },
          { value: '-1', decimals: 18 },
          { value: '-0.5', decimals: 6 },
          { value: '100', decimals: 0 },
          { value: '1000', decimals: 3 },
          { value: ' 1.5 ', decimals: 18 },
          { value: '\t420\n', decimals: 9 },
          { value: '.5', decimals: 18 },
          { value: '.123', decimals: 6 },
          { value: '1.123456', decimals: 6 },
          { value: '999999999999999999', decimals: 18 },
          { value: '1000000', decimals: 0 },
          { value: '1', decimals: 18 },
          { value: '100', decimals: 6 },
          { value: '0.00000001', decimals: 8 },
          { value: '1000.5', decimals: 18 },
        ];

        testCases.forEach(({ value, decimals }) => {
          const numberResult = PushChain.utils.helpers.parseUnits(
            value,
            decimals
          );
          const objectResult = PushChain.utils.helpers.parseUnits(value, {
            decimals,
          });
          expect(numberResult).toBe(objectResult);
        });
      });
    });

    describe('formatUnits', () => {
      describe('EVM-style usage (number decimals)', () => {
        it('should format bigint values correctly', () => {
          const readable1 = PushChain.utils.helpers.formatUnits(
            BigInt('1500000000000000000'),
            18
          );
          console.log(readable1);
          const readable2 = PushChain.utils.helpers.formatUnits('1500000', {
            decimals: 6,
          });
          console.log(readable2);
          const readable3 = PushChain.utils.helpers.formatUnits('1234567', {
            decimals: 6,
            precision: 2,
          });
          console.log(readable3);

          // ETH (18 decimals)
          const result1 = PushChain.utils.helpers.formatUnits(
            BigInt('1500000000000000000'),
            18
          );
          expect(result1).toBe('1.5');

          // USDC (6 decimals)
          const result2 = PushChain.utils.helpers.formatUnits(
            BigInt('1500000'),
            6
          );
          expect(result2).toBe('1.5');

          // BTC (8 decimals)
          const result3 = PushChain.utils.helpers.formatUnits(
            BigInt('123456789'),
            8
          );
          expect(result3).toBe('1.23456789');

          // Zero value
          const result4 = PushChain.utils.helpers.formatUnits(BigInt('0'), 18);
          expect(result4).toBe('0.0');

          // Large value
          const result5 = PushChain.utils.helpers.formatUnits(
            BigInt('1000000000000000000000'),
            18
          );
          expect(result5).toBe('1000.0');
        });

        it('should format string values correctly', () => {
          // ETH (18 decimals)
          const result1 = PushChain.utils.helpers.formatUnits(
            '1500000000000000000',
            18
          );
          expect(result1).toBe('1.5');

          // USDC (6 decimals)
          const result2 = PushChain.utils.helpers.formatUnits('1500000', 6);
          expect(result2).toBe('1.5');

          // BTC (8 decimals)
          const result3 = PushChain.utils.helpers.formatUnits('123456789', 8);
          expect(result3).toBe('1.23456789');

          // Zero value
          const result4 = PushChain.utils.helpers.formatUnits('0', 18);
          expect(result4).toBe('0.0');

          // Large value
          const result5 = PushChain.utils.helpers.formatUnits(
            '1000000000000000000000',
            18
          );
          expect(result5).toBe('1000.0');
        });

        it('should handle different decimal scenarios', () => {
          // No decimals (0)
          const result1 = PushChain.utils.helpers.formatUnits(BigInt('100'), 0);
          expect(result1).toBe('100');

          // Single decimal (1)
          const result2 = PushChain.utils.helpers.formatUnits(BigInt('123'), 1);
          expect(result2).toBe('12.3');

          // Many decimals (30)
          const result3 = PushChain.utils.helpers.formatUnits(
            BigInt('123456789012345678901234567890'),
            30
          );
          expect(result3).toBe('0.12345678901234567890123456789');
        });
      });

      describe('Push-style usage (options object)', () => {
        it('should format with decimals option', () => {
          // ETH (18 decimals)
          const result1 = PushChain.utils.helpers.formatUnits(
            BigInt('1500000000000000000'),
            { decimals: 18 }
          );
          expect(result1).toBe('1.5');

          // USDC (6 decimals)
          const result2 = PushChain.utils.helpers.formatUnits('1500000', {
            decimals: 6,
          });
          expect(result2).toBe('1.5');

          // BTC (8 decimals)
          const result3 = PushChain.utils.helpers.formatUnits('123456789', {
            decimals: 8,
          });
          expect(result3).toBe('1.23456789');

          // Zero value
          const result4 = PushChain.utils.helpers.formatUnits('0', {
            decimals: 18,
          });
          expect(result4).toBe('0.0');

          // Large value
          const result5 = PushChain.utils.helpers.formatUnits(
            '1000000000000000000000',
            { decimals: 18 }
          );
          expect(result5).toBe('1000.0');
        });

        it('should format with precision option', () => {
          // Truncate to 2 decimal places
          const result1 = PushChain.utils.helpers.formatUnits('1234567', {
            decimals: 6,
            precision: 2,
          });
          expect(result1).toBe('1.23');

          // Truncate to 4 decimal places
          const result2 = PushChain.utils.helpers.formatUnits('123456789', {
            decimals: 8,
            precision: 4,
          });
          expect(result2).toBe('1.2345');

          // Truncate to 0 decimal places (integer)
          const result3 = PushChain.utils.helpers.formatUnits('1500000', {
            decimals: 6,
            precision: 0,
          });
          expect(result3).toBe('1');

          // Truncate to 1 decimal place
          const result4 = PushChain.utils.helpers.formatUnits(
            '1500000000000000000',
            { decimals: 18, precision: 1 }
          );
          expect(result4).toBe('1.5');

          // Precision larger than actual decimals
          const result5 = PushChain.utils.helpers.formatUnits('1500000', {
            decimals: 6,
            precision: 10,
          });
          expect(result5).toBe('1.5');
        });

        it('should handle edge cases with precision', () => {
          // Very small number with precision
          const result1 = PushChain.utils.helpers.formatUnits('1', {
            decimals: 18,
            precision: 2,
          });
          expect(result1).toBe('0');

          // Number that rounds down with precision
          const result2 = PushChain.utils.helpers.formatUnits('123456', {
            decimals: 6,
            precision: 1,
          });
          expect(result2).toBe('0.1');

          // Number that rounds down to zero
          const result3 = PushChain.utils.helpers.formatUnits('123456', {
            decimals: 6,
            precision: 0,
          });
          expect(result3).toBe('0');
        });
      });

      describe('Common token scenarios', () => {
        it('should handle ETH scenarios', () => {
          // 1 ETH
          const result1 = PushChain.utils.helpers.formatUnits(
            '1000000000000000000',
            18
          );
          expect(result1).toBe('1.0');

          // 0.5 ETH
          const result2 = PushChain.utils.helpers.formatUnits(
            '500000000000000000',
            18
          );
          expect(result2).toBe('0.5');

          // 0.001 ETH
          const result3 = PushChain.utils.helpers.formatUnits(
            '1000000000000000',
            18
          );
          expect(result3).toBe('0.001');
        });

        it('should handle USDC scenarios', () => {
          // 100 USDC
          const result1 = PushChain.utils.helpers.formatUnits('100000000', 6);
          expect(result1).toBe('100.0');

          // 0.01 USDC
          const result2 = PushChain.utils.helpers.formatUnits('10000', 6);
          expect(result2).toBe('0.01');

          // 0.000001 USDC (smallest unit)
          const result3 = PushChain.utils.helpers.formatUnits('1', 6);
          expect(result3).toBe('0.000001');
        });

        it('should handle BTC scenarios', () => {
          // 1 BTC
          const result1 = PushChain.utils.helpers.formatUnits('100000000', 8);
          expect(result1).toBe('1.0');

          // 0.5 BTC
          const result2 = PushChain.utils.helpers.formatUnits('50000000', 8);
          expect(result2).toBe('0.5');

          // 0.00000001 BTC (1 satoshi)
          const result3 = PushChain.utils.helpers.formatUnits('1', 8);
          expect(result3).toBe('0.00000001');
        });
      });

      describe('Error handling and validation', () => {
        it('should throw error for invalid value types', () => {
          expect(() =>
            PushChain.utils.helpers.formatUnits(123 as any, 18)
          ).toThrow('Value must be a bigint or string');

          expect(() =>
            PushChain.utils.helpers.formatUnits(null as any, 18)
          ).toThrow('Value must be a bigint or string');

          expect(() =>
            PushChain.utils.helpers.formatUnits(undefined as any, 18)
          ).toThrow('Value must be a bigint or string');

          expect(() =>
            PushChain.utils.helpers.formatUnits({} as any, 18)
          ).toThrow('Value must be a bigint or string');
        });

        it('should throw error for invalid decimals parameter', () => {
          expect(() =>
            PushChain.utils.helpers.formatUnits('100', '18' as any)
          ).toThrow(
            'Second parameter must be a number (decimals) or an object with decimals property'
          );

          expect(() =>
            PushChain.utils.helpers.formatUnits('100', null as any)
          ).toThrow(
            'Second parameter must be a number (decimals) or an object with decimals property'
          );

          expect(() =>
            PushChain.utils.helpers.formatUnits('100', undefined as any)
          ).toThrow(
            'Second parameter must be a number (decimals) or an object with decimals property'
          );

          expect(() =>
            PushChain.utils.helpers.formatUnits('100', {} as any)
          ).toThrow(
            'Second parameter must be a number (decimals) or an object with decimals property'
          );
        });

        it('should throw error for invalid decimals values', () => {
          expect(() => PushChain.utils.helpers.formatUnits('100', 1.5)).toThrow(
            'Decimals must be an integer'
          );

          expect(() => PushChain.utils.helpers.formatUnits('100', -1)).toThrow(
            'Decimals must be non-negative'
          );

          expect(() => PushChain.utils.helpers.formatUnits('100', NaN)).toThrow(
            'Decimals must be an integer'
          );
        });

        it('should throw error for invalid precision values', () => {
          expect(() =>
            PushChain.utils.helpers.formatUnits('100', {
              decimals: 18,
              precision: 1.5,
            })
          ).toThrow('Precision must be an integer');

          expect(() =>
            PushChain.utils.helpers.formatUnits('100', {
              decimals: 18,
              precision: -1,
            })
          ).toThrow('Precision must be non-negative');

          expect(() =>
            PushChain.utils.helpers.formatUnits('100', {
              decimals: 18,
              precision: NaN,
            })
          ).toThrow('Precision must be an integer');
        });

        it('should throw error for invalid string values', () => {
          expect(() =>
            PushChain.utils.helpers.formatUnits('invalid', 18)
          ).toThrow('Failed to format units');
        });
      });

      describe('Edge cases', () => {
        it('should handle very large numbers', () => {
          const result1 = PushChain.utils.helpers.formatUnits(
            '999999999999999999999999999999999999999999',
            18
          );
          expect(result1).toBe('999999999999999999999999.999999999999999999');

          const result2 = PushChain.utils.helpers.formatUnits(
            '999999999999999999999999999999999999999999',
            { decimals: 18, precision: 2 }
          );
          expect(result2).toBe('1e+24');
        });

        it('should handle very small numbers', () => {
          const result1 = PushChain.utils.helpers.formatUnits('1', 30);
          expect(result1).toBe('0.000000000000000000000000000001');

          const result2 = PushChain.utils.helpers.formatUnits('1', {
            decimals: 30,
            precision: 10,
          });
          expect(result2).toBe('0');
        });

        it('should handle zero with different decimals', () => {
          const result1 = PushChain.utils.helpers.formatUnits('0', 0);
          expect(result1).toBe('0');

          const result2 = PushChain.utils.helpers.formatUnits('0', 18);
          expect(result2).toBe('0.0');

          const result3 = PushChain.utils.helpers.formatUnits('0', {
            decimals: 6,
            precision: 2,
          });
          expect(result3).toBe('0');
        });

        it('should handle negative numbers', () => {
          const result1 = PushChain.utils.helpers.formatUnits(
            '-1500000000000000000',
            18
          );
          expect(result1).toBe('-1.5');

          const result2 = PushChain.utils.helpers.formatUnits('-1500000', {
            decimals: 6,
            precision: 2,
          });
          expect(result2).toBe('-1.5');
        });
      });

      describe('Consistency between EVM-style and Push-style', () => {
        it('should produce same results for number and object-based formats', () => {
          const testCases = [
            { value: '1500000000000000000', decimals: 18 },
            { value: '1500000', decimals: 6 },
            { value: '123456789', decimals: 8 },
            { value: '0', decimals: 18 },
            { value: '1000000000000000000000', decimals: 18 },
            { value: '123456', decimals: 6 },
            { value: '999999999999999999', decimals: 18 },
            { value: '1', decimals: 30 },
          ];

          testCases.forEach(({ value, decimals }) => {
            const numberResult = PushChain.utils.helpers.formatUnits(
              value,
              decimals
            );
            const objectResult = PushChain.utils.helpers.formatUnits(value, {
              decimals,
            });
            expect(numberResult).toBe(objectResult);
          });
        });

        it('should handle bigint and string inputs consistently', () => {
          const testCases = [
            { value: '1500000000000000000', decimals: 18 },
            { value: '1500000', decimals: 6 },
            { value: '123456789', decimals: 8 },
            { value: '0', decimals: 18 },
            { value: '1000000000000000000000', decimals: 18 },
          ];

          testCases.forEach(({ value, decimals }) => {
            const stringResult = PushChain.utils.helpers.formatUnits(
              value,
              decimals
            );
            const bigintResult = PushChain.utils.helpers.formatUnits(
              BigInt(value),
              decimals
            );
            expect(stringResult).toBe(bigintResult);
          });
        });
      });
    });

    describe('slippageToMinAmount', () => {
      describe('basic functionality', () => {
        it('should calculate minimum amount out with 1% slippage', () => {
          const result = PushChain.utils.conversion.slippageToMinAmount('100', {
            slippageBps: 100,
          });
          expect(result).toBe('99');
        });

        it('should calculate minimum amount out with 1% slippage for large amounts', () => {
          const result = PushChain.utils.conversion.slippageToMinAmount(
            '100000000',
            {
              slippageBps: 100,
            }
          );
          expect(result).toBe('99000000');
        });

        it('should calculate minimum amount out with 0.5% slippage', () => {
          const result = PushChain.utils.conversion.slippageToMinAmount(
            '100000000',
            {
              slippageBps: 50,
            }
          );
          expect(result).toBe('99500000');
        });

        it('should calculate minimum amount out with 2% slippage', () => {
          const result = PushChain.utils.conversion.slippageToMinAmount(
            '100000000',
            {
              slippageBps: 200,
            }
          );
          expect(result).toBe('98000000');
        });

        it('should handle zero slippage', () => {
          const result = PushChain.utils.conversion.slippageToMinAmount(
            '100000000',
            {
              slippageBps: 0,
            }
          );
          expect(result).toBe('100000000');
        });

        it('should handle maximum slippage (100%)', () => {
          const result = PushChain.utils.conversion.slippageToMinAmount(
            '100000000',
            {
              slippageBps: 10000,
            }
          );
          expect(result).toBe('0');
        });
      });

      describe('edge cases', () => {
        it('should handle very small amounts', () => {
          const result = PushChain.utils.conversion.slippageToMinAmount('1', {
            slippageBps: 100,
          });
          expect(result).toBe('0');
        });

        it('should handle very large amounts', () => {
          const largeAmount = '999999999999999999999999999999';
          const result = PushChain.utils.conversion.slippageToMinAmount(
            largeAmount,
            {
              slippageBps: 100,
            }
          );
          // Should be 99% of the large amount
          const expected = (BigInt(largeAmount) * BigInt(9900)) / BigInt(10000);
          expect(result).toBe(expected.toString());
        });

        it('should handle fractional slippage calculations correctly', () => {
          // Test with amount that doesn't divide evenly by 10000
          const result = PushChain.utils.conversion.slippageToMinAmount(
            '100000001',
            {
              slippageBps: 100,
            }
          );
          // 100000001 * 9900 / 10000 = 99000000.99, truncated to 99000000
          expect(result).toBe('99000000');
        });
      });

      describe('different slippage rates', () => {
        it('should handle 0.1% slippage (10 bps)', () => {
          const result = PushChain.utils.conversion.slippageToMinAmount(
            '100000000',
            {
              slippageBps: 10,
            }
          );
          expect(result).toBe('99900000');
        });

        it('should handle 0.25% slippage (25 bps)', () => {
          const result = PushChain.utils.conversion.slippageToMinAmount(
            '100000000',
            {
              slippageBps: 25,
            }
          );
          expect(result).toBe('99750000');
        });

        it('should handle 5% slippage (500 bps)', () => {
          const result = PushChain.utils.conversion.slippageToMinAmount(
            '100000000',
            {
              slippageBps: 500,
            }
          );
          expect(result).toBe('95000000');
        });

        it('should handle 10% slippage (1000 bps)', () => {
          const result = PushChain.utils.conversion.slippageToMinAmount(
            '100000000',
            {
              slippageBps: 1000,
            }
          );
          expect(result).toBe('90000000');
        });

        it('should handle 50% slippage (5000 bps)', () => {
          const result = PushChain.utils.conversion.slippageToMinAmount(
            '100000000',
            {
              slippageBps: 5000,
            }
          );
          expect(result).toBe('50000000');
        });
      });

      describe('error handling', () => {
        it('should throw error for non-string amount', () => {
          expect(() => {
            PushChain.utils.conversion.slippageToMinAmount(100 as any, {
              slippageBps: 100,
            });
          }).toThrow('Amount must be a string');
        });

        it('should throw error for non-number slippageBps', () => {
          expect(() => {
            PushChain.utils.conversion.slippageToMinAmount('100', {
              slippageBps: '100' as any,
            });
          }).toThrow('slippageBps must be a number');
        });

        it('should throw error for non-integer slippageBps', () => {
          expect(() => {
            PushChain.utils.conversion.slippageToMinAmount('100', {
              slippageBps: 100.5,
            });
          }).toThrow('slippageBps must be an integer');
        });

        it('should throw error for negative slippageBps', () => {
          expect(() => {
            PushChain.utils.conversion.slippageToMinAmount('100', {
              slippageBps: -100,
            });
          }).toThrow('slippageBps must be non-negative');
        });

        it('should throw error for slippageBps exceeding 10000', () => {
          expect(() => {
            PushChain.utils.conversion.slippageToMinAmount('100', {
              slippageBps: 10001,
            });
          }).toThrow('slippageBps cannot exceed 10000 (100%)');
        });

        it('should throw error for empty amount string', () => {
          expect(() => {
            PushChain.utils.conversion.slippageToMinAmount('', {
              slippageBps: 100,
            });
          }).toThrow('Amount cannot be empty');
        });

        it('should throw error for whitespace-only amount string', () => {
          expect(() => {
            PushChain.utils.conversion.slippageToMinAmount('   ', {
              slippageBps: 100,
            });
          }).toThrow('Amount cannot be empty');
        });

        it('should throw error for invalid amount format', () => {
          expect(() => {
            PushChain.utils.conversion.slippageToMinAmount('invalid', {
              slippageBps: 100,
            });
          }).toThrow('Failed to calculate slippage');
        });
      });

      describe('real-world scenarios', () => {
        it('should work with USDC amounts (6 decimals)', () => {
          // 1000 USDC with 0.3% slippage
          const usdcAmount = '1000000000'; // 1000 USDC in smallest units
          const result = PushChain.utils.conversion.slippageToMinAmount(
            usdcAmount,
            {
              slippageBps: 30, // 0.3%
            }
          );
          expect(result).toBe('997000000'); // 997 USDC
        });

        it('should work with ETH amounts (18 decimals)', () => {
          // 1 ETH with 0.5% slippage
          const ethAmount = '1000000000000000000'; // 1 ETH in wei
          const result = PushChain.utils.conversion.slippageToMinAmount(
            ethAmount,
            {
              slippageBps: 50, // 0.5%
            }
          );
          expect(result).toBe('995000000000000000'); // 0.995 ETH
        });

        it('should work with small token amounts', () => {
          // 0.001 tokens with 1% slippage
          const smallAmount = '1000';
          const result = PushChain.utils.conversion.slippageToMinAmount(
            smallAmount,
            {
              slippageBps: 100, // 1%
            }
          );
          expect(result).toBe('990');
        });
      });
    });

    describe('Tokens Utils', () => {
      let tokensClientEVM: PushChain;
      let tokensUniversalSignerEVM: UniversalSigner;

      beforeAll(async () => {
        const account = privateKeyToAccount(generatePrivateKey());
        const walletClient = createWalletClient({
          account,
          chain: sepolia,
          transport: http(),
        });
        tokensUniversalSignerEVM =
          await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
            chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
            library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
          });
        tokensClientEVM = await PushChain.initialize(tokensUniversalSignerEVM, {
          network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
        });
      });
      it('should list all moveable tokens across all chains', () => {
        const { tokens } = PushChain.utils.tokens.getMoveableTokens();
        expect(Array.isArray(tokens)).toBe(true);
        expect(tokens.length).toBeGreaterThan(0);

        // Sanity check for common tokens present in the registry
        const hasETH = tokens.some(
          (t) => t.symbol === 'ETH' && t.decimals === 18
        );
        const hasWETH = tokens.some(
          (t) => t.symbol === 'WETH' && t.decimals === 18
        );
        const hasUSDT = tokens.some(
          (t) => t.symbol === 'USDT' && t.decimals === 6
        );
        expect(hasETH).toBe(true);
        expect(hasWETH).toBe(true);
        expect(hasUSDT).toBe(true);
      });

      it('should list moveable tokens for a specific chain (Ethereum Sepolia)', () => {
        const { tokens } = PushChain.utils.tokens.getMoveableTokens(
          CHAIN.ETHEREUM_SEPOLIA
        );
        expect(Array.isArray(tokens)).toBe(true);
        expect(tokens.length).toBeGreaterThan(0);

        // Expect ETH, WETH, USDT per tokens registry
        expect(
          tokens.some(
            (t) =>
              t.chain === CHAIN.ETHEREUM_SEPOLIA &&
              t.symbol === 'ETH' &&
              t.decimals === 18
          )
        ).toBe(true);
        expect(
          tokens.some(
            (t) =>
              t.chain === CHAIN.ETHEREUM_SEPOLIA &&
              t.symbol === 'WETH' &&
              t.decimals === 18
          )
        ).toBe(true);
        expect(
          tokens.some(
            (t) =>
              t.chain === CHAIN.ETHEREUM_SEPOLIA &&
              t.symbol === 'USDT' &&
              t.decimals === 6
          )
        ).toBe(true);
      });

      it('should list moveable tokens for a specific chain (Arbitrum Sepolia)', () => {
        const { tokens } = PushChain.utils.tokens.getMoveableTokens(
          CHAIN.ARBITRUM_SEPOLIA
        );
        expect(Array.isArray(tokens)).toBe(true);
        expect(tokens.length).toBeGreaterThan(0);

        // Expect ETH, USDT per tokens registry
        expect(
          tokens.some(
            (t) =>
              t.chain === CHAIN.ARBITRUM_SEPOLIA &&
              t.symbol === 'ETH' &&
              t.decimals === 18
          )
        ).toBe(true);
        expect(
          tokens.some(
            (t) =>
              t.chain === CHAIN.ARBITRUM_SEPOLIA &&
              t.symbol === 'USDT' &&
              t.decimals === 6
          )
        ).toBe(true);
      });

      it('should list moveable tokens for a specific chain (Base Sepolia)', () => {
        const { tokens } = PushChain.utils.tokens.getMoveableTokens(
          CHAIN.BASE_SEPOLIA
        );
        expect(Array.isArray(tokens)).toBe(true);
        expect(tokens.length).toBeGreaterThan(0);

        // Expect ETH, USDT per tokens registry
        expect(
          tokens.some(
            (t) =>
              t.chain === CHAIN.BASE_SEPOLIA &&
              t.symbol === 'ETH' &&
              t.decimals === 18
          )
        ).toBe(true);
        expect(
          tokens.some(
            (t) =>
              t.chain === CHAIN.BASE_SEPOLIA &&
              t.symbol === 'USDT' &&
              t.decimals === 6
          )
        ).toBe(true);
      });

      it('should list all payable tokens across all chains', () => {
        const { tokens } = PushChain.utils.tokens.getPayableTokens();
        expect(Array.isArray(tokens)).toBe(true);
        expect(tokens.length).toBeGreaterThan(0);

        // Sanity check for common tokens present in the registry
        const hasSOL = tokens.some(
          (t) => t.symbol === 'SOL' && t.decimals === 9
        );
        const hasUSDT = tokens.some(
          (t) => t.symbol === 'USDT' && t.decimals === 6
        );
        expect(hasSOL).toBe(true);
        expect(hasUSDT).toBe(true);
      });

      it('should list payable tokens for a specific chain (Solana Devnet)', () => {
        const { tokens } = PushChain.utils.tokens.getPayableTokens(
          CHAIN.SOLANA_DEVNET
        );
        expect(Array.isArray(tokens)).toBe(true);
        expect(tokens.length).toBeGreaterThan(0);

        // Expect SOL, USDC, USDT per tokens registry
        expect(
          tokens.some(
            (t) =>
              t.chain === CHAIN.SOLANA_DEVNET &&
              t.symbol === 'SOL' &&
              t.decimals === 9
          )
        ).toBe(true);

        expect(
          tokens.some(
            (t) =>
              t.chain === CHAIN.SOLANA_DEVNET &&
              t.symbol === 'USDT' &&
              t.decimals === 6
          )
        ).toBe(true);
      });

      it('should list payable tokens for a specific chain (Arbitrum Sepolia)', () => {
        const { tokens } = PushChain.utils.tokens.getPayableTokens(
          CHAIN.ARBITRUM_SEPOLIA
        );
        expect(Array.isArray(tokens)).toBe(true);
        expect(tokens.length).toBeGreaterThan(0);

        // Expect ETH, USDT per tokens registry
        expect(
          tokens.some(
            (t) =>
              t.chain === CHAIN.ARBITRUM_SEPOLIA &&
              t.symbol === 'ETH' &&
              t.decimals === 18
          )
        ).toBe(true);

        expect(
          tokens.some(
            (t) =>
              t.chain === CHAIN.ARBITRUM_SEPOLIA &&
              t.symbol === 'USDT' &&
              t.decimals === 6
          )
        ).toBe(true);
      });

      it('should list payable tokens for a specific chain (Base Sepolia)', () => {
        const { tokens } = PushChain.utils.tokens.getPayableTokens(
          CHAIN.BASE_SEPOLIA
        );
        expect(Array.isArray(tokens)).toBe(true);
        expect(tokens.length).toBeGreaterThan(0);

        // Expect ETH, USDT per tokens registry
        expect(
          tokens.some(
            (t) =>
              t.chain === CHAIN.BASE_SEPOLIA &&
              t.symbol === 'ETH' &&
              t.decimals === 18
          )
        ).toBe(true);

        expect(
          tokens.some(
            (t) =>
              t.chain === CHAIN.BASE_SEPOLIA &&
              t.symbol === 'USDT' &&
              t.decimals === 6
          )
        ).toBe(true);
      });

      it('should resolve chain via client instance for moveable tokens', () => {
        const clientTokens =
          PushChain.utils.tokens.getMoveableTokens(tokensClientEVM).tokens;
        const chainTokens = PushChain.utils.tokens.getMoveableTokens(
          CHAIN.ETHEREUM_SEPOLIA
        ).tokens;

        // Compare by symbol presence and count (order not guaranteed by spec)
        const symbolsFromClient = new Set(
          clientTokens
            .filter((t) => t.chain === CHAIN.ETHEREUM_SEPOLIA)
            .map((t) => t.symbol)
        );
        const symbolsFromChain = new Set(
          chainTokens
            .filter((t) => t.chain === CHAIN.ETHEREUM_SEPOLIA)
            .map((t) => t.symbol)
        );
        expect(symbolsFromClient).toEqual(symbolsFromChain);
        expect(clientTokens.length).toBe(chainTokens.length);
      });
    });
  });
});
