#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * PushPay native PUSD multicall repro against the published SDK.
 *
 * This intentionally does NOT import the workspace-local SDK. It installs
 * @pushchain/core@6.0.19 into the repo's ignored tmp/ directory and imports
 * from that isolated node_modules via createRequire.
 *
 * Run:
 *   PUSHPAY_E2E=1 \
 *   PUSHPAY_RECIPIENT=0x7b17Cf9c4a2733607b7c6638D2137E486Ab4C787 \
 *   node packages/core/__e2e__/push/pushpay-published-sdk.cjs
 */

const { execFileSync } = require('child_process');
const { createRequire } = require('module');
const fs = require('fs');
const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../../.env'),
});

const SDK_VERSION = '6.0.19';
const INSTALL_ROOT = process.env['PUBLISHED_SDK_INSTALL_ROOT']
  ? path.resolve(process.env['PUBLISHED_SDK_INSTALL_ROOT'])
  : path.resolve(__dirname, '../../../../tmp/published-sdk-core-6.0.19');

const PUSH_RPC = 'https://evm.donut.rpc.push.org/';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const PUSHPAY_CORE = '0x6a03976df2ae697b642c4310b22ee224cc70f384';
const PUSD = '0x774c799646bB60103e38Fd65b18D81bbDD1Aa760';
const ONE_PUSD = BigInt(1000000);
const PUSHPAY_OUTPUT_PUSD = 0;

const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
];

const PUSHPAY_CORE_PAY_ABI = [
  {
    type: 'function',
    name: 'payDirect',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'sourceToken', type: 'address' },
      { name: 'sourceAmount', type: 'uint256' },
      { name: 'output', type: 'uint8' },
    ],
    outputs: [],
  },
];

function ensurePublishedSdk() {
  const pkgJson = path.join(
    INSTALL_ROOT,
    'node_modules',
    '@pushchain',
    'core',
    'package.json'
  );

  if (fs.existsSync(pkgJson)) {
    const installed = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
    if (installed.version === SDK_VERSION) return;
  }

  fs.mkdirSync(INSTALL_ROOT, { recursive: true });
  execFileSync(
    'npm',
    [
      'install',
      '--prefix',
      INSTALL_ROOT,
      '--no-audit',
      '--no-fund',
      `@pushchain/core@${SDK_VERSION}`,
    ],
    { stdio: 'inherit' }
  );
}

function getErrorMessage(err) {
  return err?.shortMessage || err?.details || err?.message || String(err);
}

async function waitForReceipt(publicClient, hash) {
  let lastErr;
  for (let i = 0; i < 12; i++) {
    try {
      return await publicClient.getTransactionReceipt({ hash });
    } catch (err) {
      lastErr = err;
      console.log(`receipt retry ${i + 1}/12: ${getErrorMessage(err)}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw lastErr;
}

async function main() {
  if (process.env['PUSHPAY_E2E'] !== '1') {
    throw new Error('Set PUSHPAY_E2E=1 to run; this sends real PUSD.');
  }

  const privateKey = process.env['PUSH_PRIVATE_KEY'];
  if (!privateKey) throw new Error('PUSH_PRIVATE_KEY not set');

  ensurePublishedSdk();

  const publishedRequire = createRequire(path.join(INSTALL_ROOT, 'index.cjs'));
  const { PushChain } = publishedRequire('@pushchain/core');
  const {
    createPublicClient,
    createWalletClient,
    formatUnits,
    http,
    isAddress,
  } = publishedRequire('viem');
  const { privateKeyToAccount } = publishedRequire('viem/accounts');

  const account = privateKeyToAccount(privateKey);
  const recipient = process.env['PUSHPAY_RECIPIENT'] || account.address;
  if (!isAddress(recipient)) {
    throw new Error(`PUSHPAY_RECIPIENT must be an EVM address, got: ${recipient}`);
  }

  const publicClient = createPublicClient({
    transport: http(PUSH_RPC, { retryCount: 5, retryDelay: 1000 }),
  });
  const readPusdBalance = (owner) =>
    publicClient.readContract({
      address: PUSD,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [owner],
    });
  const readPusdAllowance = () =>
    publicClient.readContract({
      address: PUSD,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, PUSHPAY_CORE],
    });

  const payerBefore = await readPusdBalance(account.address);
  const recipientBefore =
    recipient.toLowerCase() === account.address.toLowerCase()
      ? payerBefore
      : await readPusdBalance(recipient);

  if (payerBefore < ONE_PUSD) {
    throw new Error(
      `Need at least 1 PUSD at ${account.address}; current balance is ${formatUnits(
        payerBefore,
        6
      )} PUSD`
    );
  }

  console.log(`published SDK: @pushchain/core@${SDK_VERSION}`);
  console.log(
    `payer=${account.address} recipient=${recipient} payerBefore=${formatUnits(
      payerBefore,
      6
    )} PUSD`
  );

  const walletClient = createWalletClient({
    account,
    transport: http(PUSH_RPC),
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
    printTraces: true,
    progressHook: (event) => console.log(`[${event.id}] ${event.title}`),
  });

  const approveData = PushChain.utils.helpers.encodeTxData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [PUSHPAY_CORE, ONE_PUSD],
  });
  const payDirectData = PushChain.utils.helpers.encodeTxData({
    abi: PUSHPAY_CORE_PAY_ABI,
    functionName: 'payDirect',
    args: [recipient, PUSD, ONE_PUSD, PUSHPAY_OUTPUT_PUSD],
  });

  const tx = await client.universal.sendTransaction({
    to: ZERO_ADDRESS,
    value: BigInt(0),
    data: [
      { to: PUSD, value: BigInt(0), data: approveData },
      { to: PUSHPAY_CORE, value: BigInt(0), data: payDirectData },
    ],
  });
  console.log(`tx.hash=${tx.hash}`);

  let receipt;
  try {
    receipt = await tx.wait();
  } catch (err) {
    console.log(`tx.wait failed, falling back to direct receipt polling: ${getErrorMessage(err)}`);
    receipt = await waitForReceipt(publicClient, tx.hash);
  }

  const status = receipt.status === 1 || receipt.status === 'success' ? 'success' : receipt.status;
  console.log(`receipt.status=${status}`);
  if (status !== 'success') {
    throw new Error(`Published SDK PushPay tx failed with status=${String(receipt.status)}`);
  }

  const allowanceAfter = await readPusdAllowance();
  const payerAfter = await readPusdBalance(account.address);
  const recipientAfter =
    recipient.toLowerCase() === account.address.toLowerCase()
      ? payerAfter
      : await readPusdBalance(recipient);

  console.log(`payerAfter=${formatUnits(payerAfter, 6)} PUSD`);
  console.log(`recipientAfter=${formatUnits(recipientAfter, 6)} PUSD`);

  if (allowanceAfter !== BigInt(0)) {
    throw new Error(`Expected allowance to be 0, got ${allowanceAfter.toString()}`);
  }
  if (recipient.toLowerCase() !== account.address.toLowerCase()) {
    if (payerAfter > payerBefore - ONE_PUSD) {
      throw new Error('Expected payer to spend at least 1 PUSD');
    }
    if (recipientAfter <= recipientBefore) {
      throw new Error('Expected recipient PUSD balance to increase');
    }
    if (recipientAfter > recipientBefore + ONE_PUSD) {
      throw new Error('Recipient received more than the 1 PUSD source amount');
    }
  }

  console.log(`OK published SDK PushPay tx ${tx.hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
