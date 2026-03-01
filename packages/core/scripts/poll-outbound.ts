/**
 * Standalone script to poll outbound transaction status on Push Chain.
 *
 * Usage:
 *   npx ts-node packages/core/scripts/poll-outbound.ts <PUSH_TX_HASH> [--interval 10] [--timeout 300]
 *
 * Example:
 *   npx ts-node packages/core/scripts/poll-outbound.ts 0xf02deb97edcf51fbfb02123c9e8b99aacc3b90cb5d51d891bcc28db7919ea06a
 *   npx ts-node packages/core/scripts/poll-outbound.ts 0xf02deb97... --interval 5 --timeout 600
 */

import {
  StargateClient,
  QueryClient,
  createProtobufRpcClient,
} from '@cosmjs/stargate';
import { Tendermint34Client } from '@cosmjs/tendermint-rpc';
import {
  QueryGetUniversalTxRequest,
  QueryGetUniversalTxResponse,
} from '../src/lib/generated/uexecutor/v1/query';
import { UniversalTxStatus } from '../src/lib/generated/uexecutor/v1/types';

// ── Config ──────────────────────────────────────────────────────────────
const RPC_URL = 'https://donut.rpc.push.org/';

const STATUS_NAMES: Record<number, string> = {
  0: 'UNSPECIFIED',
  1: 'INBOUND_SUCCESS',
  2: 'PENDING_INBOUND_EXECUTION',
  3: 'PC_EXECUTED_SUCCESS',
  4: 'PC_EXECUTED_FAILED',
  5: 'PC_PENDING_REVERT',
  6: 'OUTBOUND_PENDING',
  7: 'OUTBOUND_SUCCESS',
  8: 'OUTBOUND_FAILED',
  9: 'CANCELED',
};

// ── CLI arg parsing ─────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0].startsWith('--')) {
    console.error(
      'Usage: npx ts-node packages/core/scripts/poll-outbound.ts <PUSH_TX_HASH> [--interval 10] [--timeout 300]'
    );
    process.exit(1);
  }

  const txHash = args[0];
  let interval = 10;
  let timeout = 300;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--interval' && args[i + 1]) {
      interval = parseInt(args[++i], 10);
    } else if (args[i] === '--timeout' && args[i + 1]) {
      timeout = parseInt(args[++i], 10);
    }
  }

  return { txHash, intervalMs: interval * 1000, timeoutMs: timeout * 1000 };
}

// ── Step A: Extract universalTx ID from Cosmos tx events ────────────────
async function extractUniversalTxId(
  txHash: string,
  rpcUrl: string
): Promise<string> {
  console.log(`\n[Step A] Fetching Cosmos tx for: ${txHash}`);
  const client = await StargateClient.connect(rpcUrl);

  const query = `ethereum_tx.ethereumTxHash='${txHash}'`;
  const results = await client.searchTx(query);

  if (results.length === 0) {
    throw new Error(`No Cosmos-indexed tx found for EVM hash ${txHash}`);
  }

  console.log(`[Step A] Found ${results.length} Cosmos tx result(s)`);

  const cosmosTx = results[0];
  for (const event of cosmosTx.events) {
    if (event.type === 'outbound_created') {
      const utxIdAttr = event.attributes?.find(
        (attr: { key: string; value?: string }) => attr.key === 'utx_id'
      );
      if (utxIdAttr?.value) {
        const id = utxIdAttr.value.startsWith('0x')
          ? utxIdAttr.value
          : `0x${utxIdAttr.value}`;
        console.log(
          `[Step A] Found utx_id from outbound_created event: ${id}`
        );
        return id;
      }
    }
  }

  // Dump all events for debugging
  console.log(`[Step A] No outbound_created event found. All events:`);
  for (const event of cosmosTx.events) {
    console.log(`  event.type: ${event.type}`);
    for (const attr of event.attributes || []) {
      console.log(`    ${attr.key} = ${attr.value}`);
    }
  }

  throw new Error(
    'Could not extract utx_id from outbound_created event. See events above.'
  );
}

// ── Step B: Poll gRPC for universalTx status ────────────────────────────
async function pollOutbound(
  universalTxId: string,
  rpcUrl: string,
  intervalMs: number,
  timeoutMs: number
): Promise<void> {
  // Strip 0x for gRPC query
  const queryId = universalTxId.startsWith('0x')
    ? universalTxId.slice(2)
    : universalTxId;

  console.log(`\n[Step B] Polling universalTx ID: ${queryId}`);
  console.log(
    `[Step B] Interval: ${intervalMs / 1000}s | Timeout: ${timeoutMs / 1000}s | RPC: ${rpcUrl}\n`
  );

  const tmClient = await Tendermint34Client.connect(rpcUrl);
  const queryClient = new QueryClient(tmClient);
  const rpc = createProtobufRpcClient(queryClient);

  const startTime = Date.now();
  let pollCount = 0;

  while (Date.now() - startTime < timeoutMs) {
    pollCount++;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const t0 = Date.now();

    try {
      const request = QueryGetUniversalTxRequest.fromPartial({ id: queryId });
      const responseBytes = await rpc.request(
        'uexecutor.v1.Query',
        'GetUniversalTx',
        QueryGetUniversalTxRequest.encode(request).finish()
      );
      const response = QueryGetUniversalTxResponse.decode(responseBytes);
      const rpcMs = Date.now() - t0;

      const utx = response?.universalTx;
      const statusNum = utx?.universalStatus ?? -1;
      const statusName =
        STATUS_NAMES[statusNum] ?? `UNKNOWN(${statusNum})`;
      const outboundHash = utx?.outboundTx?.txHash || '';

      // Full JSON response
      console.log(
        `── Poll #${pollCount} | ${elapsed}s elapsed | ${rpcMs}ms rpc ──`
      );
      console.log(
        JSON.stringify(
          response,
          (k, v) => (typeof v === 'bigint' ? v.toString() : v),
          2
        )
      );
      console.log(
        `SUMMARY: status=${statusNum} (${statusName}) | outboundTx.txHash='${outboundHash}' | dest='${utx?.outboundTx?.destinationChain || ''}' | recipient='${utx?.outboundTx?.recipient || ''}' | amount='${utx?.outboundTx?.amount || ''}'`
      );

      // Check terminal states
      if (outboundHash) {
        console.log(`\n=== OUTBOUND TX FOUND ===`);
        console.log(`External TX Hash: ${outboundHash}`);
        console.log(`Destination: ${utx?.outboundTx?.destinationChain}`);
        console.log(`Recipient: ${utx?.outboundTx?.recipient}`);
        console.log(`Amount: ${utx?.outboundTx?.amount}`);
        console.log(`Asset: ${utx?.outboundTx?.assetAddr}`);
        process.exit(0);
      }

      if (
        statusNum === UniversalTxStatus.OUTBOUND_FAILED ||
        statusNum === UniversalTxStatus.PC_EXECUTED_FAILED ||
        statusNum === UniversalTxStatus.CANCELED
      ) {
        console.log(`\n=== TERMINAL FAILURE STATE: ${statusName} ===`);
        process.exit(1);
      }
    } catch (error) {
      console.log(
        `── Poll #${pollCount} | ${elapsed}s elapsed | ERROR ──`
      );
      console.log(
        error instanceof Error ? error.message : String(error)
      );
    }

    console.log('');

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  console.log(
    `\n=== TIMEOUT after ${pollCount} polls (${((Date.now() - startTime) / 1000).toFixed(1)}s) ===`
  );
  process.exit(2);
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const { txHash, intervalMs, timeoutMs } = parseArgs();

  console.log(`Push Chain Outbound TX Poller`);
  console.log(`TX Hash: ${txHash}`);
  console.log(`RPC: ${RPC_URL}`);

  const universalTxId = await extractUniversalTxId(txHash, RPC_URL);
  await pollOutbound(universalTxId, RPC_URL, intervalMs, timeoutMs);
}

main().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
