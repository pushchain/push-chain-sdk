import '@e2e/shared/setup';
/**
 * Shared pieces for the read-state e2e tree.
 *
 * Nothing here deploys. The specs call two tiny UniversalReadClient contracts
 * deployed on Donut on 2026-09-09 from plan/read-state-tools/ForkReadStateFixVerification.t.sol:
 *   FullBudgetReadClient  — stores the callback outcome; `completed()` flips on delivery
 *   RevertingReadClient   — `onUniversalData` always reverts (proves callbackDelivered=false)
 * Both expose `request(ReadSpec spec, uint64 gasLimit) payable` and forward msg.value.
 */
import { createWalletClient, http, toFunctionSelector, type Abi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PushChain, toCallData, type PreparedRead, type UniversalReadResponse } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { PUSH_CHAIN_DEF } from '../docs-examples/_helpers/docs-fund';
import { createProgressTracker } from '@e2e/shared/progress-tracker';

export const FULL_BUDGET_CLIENT = '0x5F7221d31a01A71662cABEeC2567c55ad03E2fb7' as const;
export const REVERTING_CLIENT = '0x15372211E4d3A70C24FBD8bcdFe5EB77d516e51a' as const;
export const CALLBACK_SELECTOR = toFunctionSelector('onUniversalData(uint256,bytes)');
export const CALLBACK_GAS = 200_000n;

/**
 * Validator latency on Donut swings from ~10 s to several minutes (a contract-call
 * read took ~7 min on 2026-09-09). Give every fulfil-path read a long on-chain life
 * and a matching client wait so a slow ballot is not reported as a failure.
 */
export const SLOW_PATH = {
  expiryBlocks: 900n, // ~20 min of Push blocks
  wait: { timeoutMs: 560_000, pollingIntervalMs: 3_000 },
  jestTimeoutMs: 600_000,
} as const;

const SPEC_COMPONENTS = [
  { name: 'account', type: 'tuple', components: [
    { name: 'chainNamespace', type: 'string' }, { name: 'chainId', type: 'string' }, { name: 'owner', type: 'bytes' } ] },
  { name: 'query', type: 'bytes' }, { name: 'minConfirmations', type: 'uint16' }, { name: 'blockNumber', type: 'uint64' },
  { name: 'expiryPushChainHeight', type: 'uint64' }, { name: 'maxFee', type: 'uint256' }, { name: 'revertRecipient', type: 'address' },
] as const;

export const READ_CLIENT_ABI = [
  { type: 'function', name: 'request', stateMutability: 'payable',
    inputs: [{ name: 'spec', type: 'tuple', components: SPEC_COMPONENTS }, { name: 'gasLimit', type: 'uint64' }],
    outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'completed', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
] as const satisfies Abi;

export const pushKey = process.env['PUSH_PRIVATE_KEY'] as Hex | undefined;
export const evmKey = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;
export const solanaKey = process.env['SOLANA_PRIVATE_KEY'];

/** A Push-native EOA client — the "app frontend on Push" persona. */
export async function makePushEoaClient(key: Hex, progressHook?: (e: any) => void) {
  const account = privateKeyToAccount(key);
  const walletClient = createWalletClient({ account, chain: PUSH_CHAIN_DEF, transport: http(PUSH_CHAIN_DEF.rpcUrls.default.http[0]) });
  const signer = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
    chain: CHAIN.PUSH_TESTNET_DONUT,
    library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
  });
  const client = await PushChain.initialize(signer, { network: PUSH_NETWORK.TESTNET_DONUT, progressHook });
  return { client, account };
}

/**
 * The contract-dev flow the SDK supports today: splice the prepared spec into the
 * client's own entrypoint, send it, then resume by tx hash.
 */
export async function sendRead(client: PushChain, prepared: PreparedRead, target: `0x${string}`): Promise<{ txHash: Hex; read: UniversalReadResponse }> {
  const { data, value } = toCallData(prepared, { abi: READ_CLIENT_ABI, functionName: 'request' });
  const tx = await client.universal.sendTransaction({ to: target, data, value });
  await tx.wait();
  const txHash = tx.hash as Hex;
  const reads = await client.universal.trackRead({ txHash });
  expect(reads).toHaveLength(1);
  return { txHash, read: reads[0] };
}

export { createProgressTracker };
