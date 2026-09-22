/**
 * Live N1 probe: Push contract -> its Sepolia CEA -> Push contract -> registry read.
 *
 * Run from packages/core after deploying CEAReadStateReceiver.sol:
 *   CEA_READ_RECEIVER=0x... npx ts-node --transpile-only __e2e__/read/tools/live-read-cea.ts
 */
import path from 'path';
import { config as dotenv } from 'dotenv';
dotenv({ path: path.resolve(__dirname, '../../../.env') });

import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  http,
  parseEther,
  type Abi,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PushChain } from '../../../src';
import { CHAIN, PUSH_NETWORK } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { CEA_EVM } from '../../../src/lib/constants/abi/cea.evm';
import { UNIVERSAL_READ_REGISTRY_EVM } from '../../../src/lib/constants/abi/universalReadRegistry.evm';
import { UEA_MULTICALL_SELECTOR } from '../../../src/lib/constants/selectors';
import { getCEAAddress } from '../../../src/lib/orchestrator/cea-utils';
import { getActiveStakingFixtures } from '../../shared/chain-fixtures';
import {
  queryOutboundGasFees,
  waitForOutboundRelay,
} from '../../shared/outbound-helpers';
import { PUSH_CHAIN_DEF } from '../../docs-examples/_helpers/docs-fund';

const RECEIVER = (process.env.CEA_READ_RECEIVER ??
  '0x650306a2e404f233146607D970494449E6e8Eb1C') as `0x${string}`;
const ZERO = '0x0000000000000000000000000000000000000000' as const;
const CALLBACK_GAS = 500_000n;
const OUTBOUND_GAS = 1_000_000n;
const OUTBOUND_VALUE = parseEther('50');

const specComponents = [
  {
    name: 'account',
    type: 'tuple',
    components: [
      { name: 'chainNamespace', type: 'string' },
      { name: 'chainId', type: 'string' },
      { name: 'owner', type: 'bytes' },
    ],
  },
  { name: 'query', type: 'bytes' },
  { name: 'minConfirmations', type: 'uint16' },
  { name: 'blockNumber', type: 'uint64' },
  { name: 'expiryPushChainHeight', type: 'uint64' },
  { name: 'maxFee', type: 'uint256' },
  { name: 'revertRecipient', type: 'address' },
] as const;

const receiverAbi = [
  { type: 'function', name: 'REGISTRY', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function',
    name: 'triggerOutbound',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'req',
        type: 'tuple',
        components: [
          { name: 'recipient', type: 'bytes' },
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'gasLimit', type: 'uint256' },
          { name: 'gasPrice', type: 'uint256' },
          { name: 'maxPCForGas', type: 'uint256' },
          { name: 'payload', type: 'bytes' },
          { name: 'revertRecipient', type: 'address' },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'lastRequestId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'lastInboundTxId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes32' }],
  },
] as const satisfies Abi;

async function main() {
  const rawKey = process.env.PUSH_PRIVATE_KEY;
  if (!rawKey)
    throw new Error('PUSH_PRIVATE_KEY is required in packages/core/.env');
  const key = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as Hex;
  const account = privateKeyToAccount(key);
  const rpc = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0];
  const publicClient = createPublicClient({
    chain: PUSH_CHAIN_DEF,
    transport: http(rpc),
  });
  const wallet = createWalletClient({
    account,
    chain: PUSH_CHAIN_DEF,
    transport: http(rpc),
  });
  const signer = await PushChain.utils.signer.toUniversalFromKeypair(wallet, {
    chain: CHAIN.PUSH_TESTNET_DONUT,
    library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
  });
  const client = await PushChain.initialize(signer, {
    network: PUSH_NETWORK.TESTNET_DONUT,
  });

  const fixture = getActiveStakingFixtures().find(
    (f) => f.chain === CHAIN.ETHEREUM_SEPOLIA
  );
  if (!fixture) throw new Error('Sepolia fixture is not active');
  const cea = await getCEAAddress(RECEIVER, CHAIN.ETHEREUM_SEPOLIA);
  const receiverRegistry = await publicClient.readContract({ address: RECEIVER, abi: receiverAbi, functionName: 'REGISTRY' });
  if (receiverRegistry.toLowerCase() !== PushChain.CONSTANTS.READ.UNIVERSAL_READ_REGISTRY_ADDRESS.TESTNET_DONUT.toLowerCase()) {
    throw new Error('CEA receiver uses the previous registry. Redeploy CEAReadStateReceiver.sol and set CEA_READ_RECEIVER before running.');
  }
  console.log('receiver:', RECEIVER);
  console.log('receiver CEA:', cea.cea, 'deployed before:', cea.isDeployed);
  console.log(
    'owner balance:',
    formatEther(await publicClient.getBalance({ address: account.address })),
    'PC'
  );

  const prepared = await client.universal.prepareRead(
    '0x000000000000000000000000000000000000dEaD',
    {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      callback: { gasLimit: CALLBACK_GAS },
      refundTo: RECEIVER,
      expiryBlocks: 1_500n,
    }
  );

  const receiverBalance = await publicClient.getBalance({ address: RECEIVER });
  const requiredReceiverBalance = prepared.value + parseEther('0.01');
  if (receiverBalance < requiredReceiverBalance) {
    const hash = await wallet.sendTransaction({
      to: RECEIVER,
      value: requiredReceiverBalance - receiverBalance,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log('funded receiver:', hash);
  }

  const readPayload = encodeAbiParameters(
    [
      { name: 'spec', type: 'tuple', components: specComponents },
      { name: 'queryKey', type: 'bytes32' },
      { name: 'callbackGasLimit', type: 'uint64' },
      { name: 'readValue', type: 'uint256' },
    ],
    [prepared.spec as never, prepared.queryKey, CALLBACK_GAS, prepared.value]
  );
  const universalPayload = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          { name: 'gasLimit', type: 'uint256' },
          { name: 'maxFeePerGas', type: 'uint256' },
          { name: 'maxPriorityFeePerGas', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'vType', type: 'uint8' },
        ],
      },
    ],
    [
      {
        to: ZERO,
        value: 0n,
        data: readPayload,
        gasLimit: 1_000_000n,
        maxFeePerGas: 10_000_000_000n,
        maxPriorityFeePerGas: 0n,
        nonce: 0n,
        deadline: 0n,
        vType: 1,
      },
    ]
  );
  const sendBack = encodeFunctionData({
    abi: CEA_EVM,
    functionName: 'sendUniversalTxToUEA',
    args: [ZERO, 0n, universalPayload, account.address],
  });
  const multicallBody = encodeAbiParameters(
    [
      {
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    [[{ to: cea.cea as `0x${string}`, value: 0n, data: sendBack }]]
  );
  const ceaPayload = `${UEA_MULTICALL_SELECTOR}${multicallBody.slice(
    2
  )}` as Hex;

  const fees = await queryOutboundGasFees(
    publicClient,
    fixture.staking.pUsdtToken,
    OUTBOUND_GAS
  );
  console.log(
    'quoted outbound native requirement:',
    formatEther(fees.nativeValueForGas),
    'PC; sending',
    formatEther(OUTBOUND_VALUE)
  );
  const triggerData = encodeFunctionData({
    abi: receiverAbi,
    functionName: 'triggerOutbound',
    args: [
      {
        recipient: '0x',
        token: fixture.staking.pUsdtToken,
        amount: 0n,
        gasLimit: OUTBOUND_GAS,
        gasPrice: 0n,
        maxPCForGas: OUTBOUND_VALUE,
        payload: ceaPayload,
        revertRecipient: account.address,
      },
    ],
  });
  const previousRequestId = await publicClient.readContract({
    address: RECEIVER, abi: receiverAbi, functionName: 'lastRequestId',
  });
  const triggerHash = await wallet.sendTransaction({
    to: RECEIVER,
    data: triggerData,
    value: OUTBOUND_VALUE,
    gas: 1_500_000n,
  });
  const triggerReceipt = await publicClient.waitForTransactionReceipt({
    hash: triggerHash,
  });
  if (triggerReceipt.status !== 'success')
    throw new Error(`trigger reverted: ${triggerHash}`);
  console.log('Push outbound tx:', triggerHash);
  const outbound = await waitForOutboundRelay(
    triggerHash,
    PUSH_NETWORK.TESTNET_DONUT,
    { timeoutMs: 300_000 }
  );
  console.log('Sepolia CEA execution tx:', outbound.externalTxHash);

  const started = Date.now();
  let requestId = 0n;
  while (Date.now() - started < 600_000) {
    requestId = await publicClient.readContract({
      address: RECEIVER,
      abi: receiverAbi,
      functionName: 'lastRequestId',
    });
    if (requestId !== 0n && requestId !== previousRequestId) break;
    console.log('waiting for CEA inbound on Push...');
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  if (requestId === 0n || requestId === previousRequestId)
    throw new Error(
      'CEA inbound arrived without creating a read (or did not arrive before timeout)'
    );
  const inboundTxId = await publicClient.readContract({
    address: RECEIVER,
    abi: receiverAbi,
    functionName: 'lastInboundTxId',
  });
  console.log('CEA inbound tx id:', inboundTxId);
  console.log(
    'read request id:',
    `0x${requestId.toString(16).padStart(64, '0')}`
  );

  const tracked = await client.universal.trackRead(
    { requestId },
    {
      resultShape: prepared.resultShape,
      advanced: { timeout: 600_000, pollingIntervalMs: 3_000 },
    }
  );
  const done = tracked.isTerminal
    ? tracked
    : await tracked.wait({ timeoutMs: 600_000, pollingIntervalMs: 3_000 });
  console.log('node-indexed Push tx:', done.txHash);
  console.log(
    'terminal status:',
    done.status,
    'value:',
    done.value?.toString()
  );
  if (done.status !== PushChain.CONSTANTS.READ.STATUS.FULFILLED || done.callbackDelivered !== true || done.raw?.status !== PushChain.CONSTANTS.READ.RESULT_STATUS.SUCCESS) {
    throw new Error(`read did not fulfil: ${done.status} ${done.errorMsg}`);
  }
  if (done.request.spec.blockNumber !== prepared.spec.blockNumber || done.request.spec.query !== prepared.spec.query) {
    throw new Error('receiver read does not match this run');
  }
  const stored = await publicClient.readContract({
    address: PushChain.CONSTANTS.READ.UNIVERSAL_READ_REGISTRY_ADDRESS.TESTNET_DONUT,
    abi: UNIVERSAL_READ_REGISTRY_EVM, functionName: 'resultByRequestId', args: [requestId],
  });
  if (stored.requestId !== requestId || stored.resultData !== done.raw.resultData) {
    throw new Error('registry storage does not match the fulfilled request');
  }
  console.log('PASS: fresh CEA request, successful consensus, callback delivered, registry result verified');
}

main().catch((error) => {
  console.error('FAILED:', error?.message ?? error);
  process.exit(1);
});
