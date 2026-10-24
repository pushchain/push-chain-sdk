/** Read-only. Key material stays in memory; never printed, copied or logged. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import dotenv from 'dotenv';
import { createPublicClient, http, formatEther, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getPushViemChain } from '../../../../packages/core/src/lib/constants/chain';
import { CHAIN } from '../../../../packages/core/src/lib/constants/enums';
import { loadAgwManifest, verifyAgwManifest } from '../../../../packages/core/__e2e__/agw/_manifest';

async function main() {
  const env = dotenv.parse(readFileSync(resolve(__dirname, '../../../../packages/core/.env')));
  const raw = env.PUSH_PRIVATE_KEY;
  if (!raw || !/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error('Configured PUSH_PRIVATE_KEY is missing or invalid');
  let account;
  try { account = privateKeyToAccount(raw as `0x${string}`); }
  catch { throw new Error('Configured PUSH_PRIVATE_KEY cannot be used'); }
  const chain = getPushViemChain(CHAIN.PUSH_TESTNET_DONUT)!;
  const client = createPublicClient({ chain, transport: http('https://evm.donut.rpc.push.org/') });
  if (await client.getChainId() !== 42101) throw new Error('Unexpected chain; no funding permitted');
  await verifyAgwManifest(client, loadAgwManifest());
  const [balance, block] = await Promise.all([client.getBalance({ address: account.address }), client.getBlockNumber()]);
  const result = { checkedAt: new Date().toISOString(), chainId: 42101, block: block.toString(), wiringVerified: true,
    ownerBalancePC: formatEther(balance), nativeSmokeBudgetPC: '6', sufficientForNativeSmoke: balance >= parseEther('6'),
    keysPresent: { push: true, evm: !!env.EVM_PRIVATE_KEY, solana: !!env.SOLANA_PRIVATE_KEY }, transactionsSubmitted: false };
  writeFileSync(join(__dirname, 'preflight.json'), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.sufficientForNativeSmoke) throw new Error('Owner balance is below the native smoke reserve; no funding performed');
}
main().catch(() => { process.stderr.write('Read-only preflight did not complete; no funding was performed.\n'); process.exitCode = 1; });
