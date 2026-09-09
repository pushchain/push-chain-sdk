/**
 * live-read-uea.ts — the UEA-ORIGINATED live read.
 *
 * Sends the read request THROUGH a Universal Executor Account via the SDK's own Route 1
 * (Sepolia-origin signer → UniversalPayload → MsgExecutePayload → UEA executes the call).
 * ReadRequested is therefore emitted inside CallUEAExecutePayload — the exact path the N1
 * fix (push-chain d4ef66db) added ingestion to. If x/ucallback records it and it settles,
 * N1 works live.
 *
 *   cd packages/core && npx ts-node --transpile-only ../../plan/read-state-tools/live-read-uea.ts
 *
 * Needs packages/core/.env: EVM_PRIVATE_KEY (Sepolia-origin owner with a deployed UEA on Donut).
 * Costs ~0.05 PC budget from the UEA (refunded minus burn) + Push gas.
 */
import path from 'path';
import { config as dotenv } from 'dotenv';
dotenv({ path: path.resolve(__dirname, '../../packages/core/.env') });

import {
  createWalletClient, createPublicClient, http, encodeAbiParameters, encodeFunctionData,
  parseEther, toEventSelector, type Hex, type Abi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { PushChain } from '../../packages/core/src';

const DONUT_RPC = 'https://evm.donut.rpc.push.org/';
const UC = '0x00000000000000000000000000000000000000c2' as const;
const CORE = '0x00000000000000000000000000000000000000C0' as const;
const CLIENT = '0x5F7221d31a01A71662cABEeC2567c55ad03E2fb7' as const; // FullBudgetReadClient, deployed 2026-09-09
const BUDGET = parseEther('0.05');

const READ_REQUESTED = toEventSelector(
  'ReadRequested(uint256,((string,string,bytes),bytes,uint16,uint64,uint64,uint256,address),address,address,uint64,uint256,uint256,uint256)',
);
const specComponents = [
  { name: 'account', type: 'tuple', components: [
    { name: 'chainNamespace', type: 'string' }, { name: 'chainId', type: 'string' }, { name: 'owner', type: 'bytes' } ] },
  { name: 'query', type: 'bytes' }, { name: 'minConfirmations', type: 'uint16' }, { name: 'blockNumber', type: 'uint64' },
  { name: 'expiryPushChainHeight', type: 'uint64' }, { name: 'maxFee', type: 'uint256' }, { name: 'revertRecipient', type: 'address' },
] as const;
const clientAbi = [
  { type: 'function', name: 'request', stateMutability: 'payable',
    inputs: [{ name: 'spec', type: 'tuple', components: specComponents }, { name: 'gasLimit', type: 'uint64' }],
    outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'completed', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
] as const satisfies Abi;
const ucAbi = [
  { type: 'function', name: 'statusOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'totalEscrowed', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const satisfies Abi;
const coreAbi = [
  { type: 'function', name: 'chainHeightByChainNamespace', stateMutability: 'view', inputs: [{ type: 'string' }], outputs: [{ type: 'uint256' }] },
] as const satisfies Abi;

async function main() {
  const pk = (process.env.EVM_PRIVATE_KEY!.startsWith('0x') ? process.env.EVM_PRIVATE_KEY! : '0x' + process.env.EVM_PRIVATE_KEY!) as Hex;
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(process.env.EVM_RPC) });
  const donut = createPublicClient({ transport: http(DONUT_RPC) });

  const { CHAIN, PUSH_NETWORK } = PushChain.CONSTANTS;
  const signer = await PushChain.utils.signer.toUniversalFromKeypair(wallet, {
    chain: CHAIN.ETHEREUM_SEPOLIA,
    library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
  });
  const client = await PushChain.initialize(signer, {
    network: PUSH_NETWORK.TESTNET_DONUT,
    ...(process.env.EVM_RPC ? { rpcUrls: { [CHAIN.ETHEREUM_SEPOLIA]: [process.env.EVM_RPC] } } : {}),
  });
  const uea = client.universal.account as Hex;
  console.log('origin (Sepolia EOA):', account.address);
  console.log('UEA on Donut        :', uea, ' balance', (Number(await donut.getBalance({ address: uea })) / 1e18).toFixed(4), 'PC');
  console.log('_requestNonce before:', Number(await donut.getStorageAt({ address: UC, slot: '0x4' })));

  // preflight
  const height = await donut.readContract({ address: CORE, abi: coreAbi, functionName: 'chainHeightByChainNamespace', args: ['eip155:11155111'] });
  const pin = height - 1n;
  const pushHead = await donut.getBlockNumber();
  const expiry = pushHead + 1000n;

  // I1: ONE tuple. I2: abi.encode(address) payload.
  const payload = encodeAbiParameters([{ type: 'address' }], ['0x000000000000000000000000000000000000dEaD']);
  const query = encodeAbiParameters(
    [{ type: 'tuple', components: [
      { name: 'queryType', type: 'uint8' },
      { name: 'blockRef', type: 'tuple', components: [{ name: 'refType', type: 'uint8' }, { name: 'blockNumber', type: 'uint64' }] },
      { name: 'payload', type: 'bytes' } ] }],
    [{ queryType: 0, blockRef: { refType: 0, blockNumber: pin }, payload }],
  );
  const spec = {
    account: { chainNamespace: 'eip155', chainId: '11155111', owner: '0x000000000000000000000000000000000000dEaD' as Hex },
    query, minConfirmations: 1, blockNumber: pin, expiryPushChainHeight: expiry,
    maxFee: parseEther('100'), revertRecipient: uea,   // refundTo = the sending account (the UEA) — Q8 default
  };
  const data = encodeFunctionData({ abi: clientAbi, functionName: 'request', args: [spec, 200_000n] });
  console.log(`pin ${pin} (oracle ${height})  expiry ${expiry}  budget ${BUDGET}  refundTo ${uea}`);

  // send THROUGH the UEA
  const t0 = Date.now();
  const tx = await client.universal.sendTransaction({ to: CLIENT, value: BUDGET, data });
  console.log('push tx hash        :', tx.hash);
  const receipt: any = await tx.wait();
  console.log('receipt status      :', receipt?.status, ' block', receipt?.blockNumber?.toString?.() ?? receipt?.blockNumber);

  const log = (receipt?.logs ?? []).find((l: any) => l.address?.toLowerCase() === UC && l.topics?.[0] === READ_REQUESTED);
  if (!log) { console.log('!! no ReadRequested log from UniversalCallback in the receipt'); console.log(JSON.stringify(receipt?.logs?.map((l: any) => ({ a: l.address, t0: l.topics?.[0] })), null, 0)); process.exit(1); }
  const requestId = log.topics[1] as Hex;
  console.log('requestId           :', requestId);
  console.log('_requestNonce after :', Number(await donut.getStorageAt({ address: UC, slot: '0x4' })));

  // watch: 1 PENDING · 2 EXECUTED · 3 SETTLED · 4 EXPIRED
  for (let i = 0; i < 30; i++) {
    const st = await donut.readContract({ address: UC, abi: ucAbi, functionName: 'statusOf', args: [BigInt(requestId)] });
    const done = await donut.readContract({ address: CLIENT, abi: clientAbi, functionName: 'completed' });
    console.log(`${new Date().toLocaleTimeString()}  statusOf=${st}  callbackCompleted=${done}  (+${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    if (st === 3 || st === 4) break;
    await new Promise(r => setTimeout(r, 10_000));
  }
  console.log('escrowed now        :', (await donut.readContract({ address: UC, abi: ucAbi, functionName: 'totalEscrowed' })).toString());
  console.log('UEA balance after   :', (Number(await donut.getBalance({ address: uea })) / 1e18).toFixed(4), 'PC');
  console.log(`\nnode check:  plan/read-state-tools/node-read.sh tx ${tx.hash}\n             plan/read-state-tools/node-read.sh id ${requestId}`);
}
main().catch(e => { console.error('FAILED:', e?.message ?? e); process.exit(1); });
