/**
 * Standalone e2e: native-Push EIP-7702 atomic multicall.
 *
 * Drives the real SDK path (sendPushTx → EvmClient.sendBatch7702) against Push
 * testnet + the deployed PushBatchExecutor. Sends 3 increments in one type-4 tx
 * and asserts the counter advanced by exactly 3, the tx was type-4, and the EOA
 * carries the 7702 delegation designator.
 *
 * Run from packages/core (ts-node is the runner available in this workspace):
 *   ../../node_modules/.bin/ts-node --transpile-only \
 *     --compiler-options '{"module":"commonjs","moduleResolution":"node","esModuleInterop":true,"resolveJsonModule":true}' \
 *     __e2e__/scripts/e2e-7702-multicall.ts
 */
import 'dotenv/config';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PushChain } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';
import {
  PUSH_BATCH_EXECUTOR_ADDRESS,
  getBatchExecutorAddress,
} from '../../src/lib/constants/chain';
import { COUNTER_ADDRESS_PAYABLE } from '../../src/lib/push-chain/helpers/addresses';
import { COUNTER_ABI_PAYABLE } from '../../src/lib/push-chain/helpers/abis';

const RPC = 'https://evm.donut.rpc.push.org/';

const pushDonut = defineChain({
  id: 42101,
  name: 'Push Donut Testnet',
  nativeCurrency: { name: 'Push', symbol: 'PC', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`❌ ASSERT FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ ${msg}`);
}

async function main() {
  const pk = (process.env['PUSH_PRIVATE_KEY'] ||
    process.env['EVM_PRIVATE_KEY']) as `0x${string}`;
  if (!pk) throw new Error('PUSH_PRIVATE_KEY / EVM_PRIVATE_KEY not set');

  const account = privateKeyToAccount(pk);
  console.log(`Signer EOA: ${account.address}`);
  console.log(
    `Configured executor: ${getBatchExecutorAddress(CHAIN.PUSH_TESTNET_DONUT)}`
  );

  const walletClient = createWalletClient({
    account,
    chain: pushDonut,
    transport: http(RPC),
  });
  const publicClient = createPublicClient({ chain: pushDonut, transport: http(RPC) });

  const signer = await PushChain.utils.signer.toUniversalFromKeypair(
    walletClient,
    {
      chain: CHAIN.PUSH_TESTNET_DONUT,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    }
  );
  assert(
    typeof signer.signAuthorization === 'function',
    'signer exposes signAuthorization (7702-capable)'
  );

  const client = await PushChain.initialize(signer, {
    network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
  });

  const readCount = () =>
    publicClient.readContract({
      address: COUNTER_ADDRESS_PAYABLE,
      abi: COUNTER_ABI_PAYABLE as never,
      functionName: 'countPC',
    }) as Promise<bigint>;

  const before = await readCount();
  console.log(`countPC before: ${before}`);

  const incrementData = PushChain.utils.helpers.encodeTxData({
    abi: COUNTER_ABI_PAYABLE as unknown as any[],
    functionName: 'increment',
  }) as `0x${string}`;

  const N = 3;
  const calls = Array.from({ length: N }, () => ({
    to: COUNTER_ADDRESS_PAYABLE,
    value: BigInt(0),
    data: incrementData,
  }));

  console.log(`\nSending ${N}-call multicall via native EIP-7702...`);
  const tx = await client.universal.sendTransaction({
    to: COUNTER_ADDRESS_PAYABLE,
    data: calls,
  });
  console.log(`tx hash: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`receipt status: ${receipt.status}`);
  assert(receipt.status === 1, 'transaction succeeded');

  // Inspect the on-chain tx type — must be eip7702 (type 4).
  const onchain = await publicClient.getTransaction({
    hash: tx.hash as `0x${string}`,
  });
  console.log(`tx type: ${onchain.type}`);
  assert(onchain.type === 'eip7702', 'tx is a single type-4 (eip7702) transaction');

  const after = await readCount();
  console.log(`countPC after: ${after}`);
  assert(
    after === before + BigInt(N),
    `counter advanced by exactly ${N} atomically (${before} → ${after})`
  );

  // EOA should now carry the 7702 delegation designator: 0xef0100 || executor.
  const code = await publicClient.getCode({ address: account.address });
  const expectedExecutor = PUSH_BATCH_EXECUTOR_ADDRESS[CHAIN.PUSH_TESTNET_DONUT]!;
  const expectedDesignator = (
    '0xef0100' + expectedExecutor.slice(2)
  ).toLowerCase();
  console.log(`EOA code: ${code}`);
  assert(
    (code ?? '').toLowerCase() === expectedDesignator,
    'EOA delegated to PushBatchExecutor (0xef0100 ‖ executor)'
  );

  console.log('\n🎉 e2e 7702 multicall passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
