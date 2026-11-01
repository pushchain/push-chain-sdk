/** No dotenv, signers or transactions: inspect both networks before funding a wire test. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createPublicClient, fallback, http, parseAbi, type Address } from 'viem';
import { CHAIN_INFO, getPushViemChain } from '../../src/lib/constants/chain';
import { CHAIN } from '../../src/lib/constants/enums';
import { loadAgwManifest, verifyAgwManifest } from '../agw/_manifest';
import { inspectSvmWirePrograms, svmWireConnection, SVM_WIRE_CHAIN } from '../shared/agw-svm-preflight';

async function main() {
  const manifest = loadAgwManifest();
  const push = createPublicClient({ chain: getPushViemChain(CHAIN.PUSH_TESTNET_DONUT), transport: fallback(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC.map((u) => http(u))) });
  await verifyAgwManifest(push, manifest);
  const block = await push.getBlockNumber();
  const token = await push.readContract({ address: '0x00000000000000000000000000000000000000C0',
    abi: parseAbi(['function gasTokenPRC20ByChainNamespace(string) view returns (address)']),
    functionName: 'gasTokenPRC20ByChainNamespace', args: [SVM_WIRE_CHAIN], blockNumber: block }) as Address;
  const source = await push.readContract({ address: token, abi: parseAbi(['function SOURCE_CHAIN_NAMESPACE() view returns (string)']), functionName: 'SOURCE_CHAIN_NAMESPACE', blockNumber: block });
  if (source !== SVM_WIRE_CHAIN) throw new Error('Gas PRC20 does not match Solana devnet');
  const quote = await push.readContract({ address: '0x00000000000000000000000000000000000000C0',
    abi: parseAbi(['function getOutboundTxGasAndFees(address,uint256) view returns (address,uint256,uint256,uint256,string,uint256)']),
    functionName: 'getOutboundTxGasAndFees', args: [token, BigInt(0)], blockNumber: block });
  const solana = await inspectSvmWirePrograms(svmWireConnection());
  const result = { push: { chainId: await push.getChainId(), block, sourceCommit: manifest.sourceCommit, token, quote }, solana, transactionsSent: 0 };
  const json = JSON.stringify(result, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
  const output = process.argv[2];
  if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, json); }
  process.stdout.write(json);
}
main().catch((error) => { console.error((error as Error).message); process.exitCode = 1; });
