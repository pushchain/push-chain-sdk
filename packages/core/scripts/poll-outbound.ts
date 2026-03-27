/**
 * Standalone script to poll outbound transaction status on Push Chain.
 * Supports cascaded txs: follows parent → child UTX chains via inbound events.
 *
 * Usage:
 *   npx ts-node packages/core/scripts/poll-outbound.ts <PUSH_TX_HASH> [--interval 10] [--timeout 300] [--depth 2]
 *
 * Example:
 *   npx ts-node packages/core/scripts/poll-outbound.ts 0x5a711714c54bed06173bb113f674361995d4073c69cdc864586daf7e9bc81a62
 *   npx ts-node packages/core/scripts/poll-outbound.ts 0x5a7117... --interval 5 --timeout 600 --depth 3
 */

import {
  StargateClient,
  QueryClient,
  createProtobufRpcClient,
} from '@cosmjs/stargate';
import { Tendermint34Client } from '@cosmjs/tendermint-rpc';
import {
  QueryGetUniversalTxRequestV2,
  QueryGetUniversalTxResponseV2,
} from '../src/lib/generated/uexecutor/v2/query';
import {
  UniversalTxStatus,
  OutboundStatus,
  outboundStatusToJSON,
  txTypeToJSON,
} from '../src/lib/generated/uexecutor/v2/types';

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
      'Usage: npx ts-node packages/core/scripts/poll-outbound.ts <PUSH_TX_HASH> [--interval 10] [--timeout 300] [--depth 2]'
    );
    process.exit(1);
  }

  const txHash = args[0];
  let interval = 10;
  let timeout = 300;
  let depth = 2;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--interval' && args[i + 1]) {
      interval = parseInt(args[++i], 10);
    } else if (args[i] === '--timeout' && args[i + 1]) {
      timeout = parseInt(args[++i], 10);
    } else if (args[i] === '--depth' && args[i + 1]) {
      depth = parseInt(args[++i], 10);
    }
  }

  return { txHash, intervalMs: interval * 1000, timeoutMs: timeout * 1000, depth };
}

// ── Step A: Extract ALL utx_ids from Cosmos tx events ────────────────
async function extractAllUtxIds(
  txHash: string,
  rpcUrl: string
): Promise<{ utxIds: string[]; allEvents: Array<{ type: string; attrs: Record<string, string> }> }> {
  console.log(`\n[Step A] Fetching Cosmos tx for: ${txHash}`);
  const client = await StargateClient.connect(rpcUrl);

  const query = `ethereum_tx.ethereumTxHash='${txHash}'`;
  const results = await client.searchTx(query);

  if (results.length === 0) {
    throw new Error(`No Cosmos-indexed tx found for EVM hash ${txHash}`);
  }

  console.log(`[Step A] Found ${results.length} Cosmos tx result(s)`);

  const utxIds = new Set<string>();
  const allEvents: Array<{ type: string; attrs: Record<string, string> }> = [];

  for (const cosmosTx of results) {
    for (const event of cosmosTx.events) {
      const attrs: Record<string, string> = {};
      for (const attr of event.attributes || []) {
        if (attr.key && attr.value) attrs[attr.key] = attr.value;
      }
      allEvents.push({ type: event.type, attrs });

      if (event.type === 'outbound_created') {
        const utxId = attrs['utx_id'];
        const txId = attrs['tx_id'];
        if (utxId) {
          const id = utxId.startsWith('0x') ? utxId : `0x${utxId}`;
          utxIds.add(id);
          console.log(`[Step A] outbound_created: utx_id=${id} tx_id=${txId || 'N/A'} dest=${attrs['destination_chain'] || 'N/A'}`);
        }
      }
    }
  }

  if (utxIds.size === 0) {
    console.log(`[Step A] No outbound_created events. Dumping all events:`);
    for (const ev of allEvents) {
      console.log(`  ${ev.type}: ${JSON.stringify(ev.attrs)}`);
    }
  }

  return { utxIds: [...utxIds], allEvents };
}

// ── Step B: Query a single UTX by ID ────────────────────────────────
async function queryUtx(
  queryId: string,
  rpc: ReturnType<typeof createProtobufRpcClient>,
  label: string
): Promise<QueryGetUniversalTxResponseV2 | null> {
  const id = queryId.startsWith('0x') ? queryId.slice(2) : queryId;
  try {
    const request = QueryGetUniversalTxRequestV2.fromPartial({ id });
    const responseBytes = await rpc.request(
      'uexecutor.v2.Query',
      'GetUniversalTx',
      QueryGetUniversalTxRequestV2.encode(request).finish()
    );
    return QueryGetUniversalTxResponseV2.decode(responseBytes);
  } catch (error) {
    console.log(`[${label}] Query failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// ── Step C: Print UTX details ────────────────────────────────────────
function printUtx(response: QueryGetUniversalTxResponseV2, label: string): string[] {
  const utx = response?.universalTx;
  if (!utx) {
    console.log(`[${label}] No universalTx in response`);
    return [];
  }

  const statusNum = utx.universalStatus ?? -1;
  const statusName = STATUS_NAMES[statusNum] ?? `UNKNOWN(${statusNum})`;

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`${label} | UTX ID: ${utx.id}`);
  console.log(`${'═'.repeat(80)}`);
  console.log(`  Status: ${statusNum} (${statusName})`);

  // Inbound info
  if (utx.inboundTx) {
    const ib = utx.inboundTx;
    console.log(`  Inbound: chain=${ib.sourceChain} | txHash=${ib.txHash} | amount=${ib.amount} | txType=${ib.txType}`);
    if (ib.universalPayload) {
      console.log(`  Inbound Payload: to=${ib.universalPayload.to} | nonce=${ib.universalPayload.nonce} | dataLen=${ib.universalPayload.data?.length || 0}`);
    }
  }

  // PC Txs
  if (utx.pcTx?.length) {
    for (let i = 0; i < utx.pcTx.length; i++) {
      const pc = utx.pcTx[i];
      console.log(`  PCTx[${i}]: hash=${pc.txHash} | gas=${pc.gasUsed} | sender=${pc.sender}`);
    }
  }

  // Outbound Txs
  const childTxHashes: string[] = [];
  if (utx.outboundTx?.length) {
    for (let i = 0; i < utx.outboundTx.length; i++) {
      const ob = utx.outboundTx[i];
      const obStatus = outboundStatusToJSON(ob.outboundStatus);
      const txType = txTypeToJSON(ob.txType);
      const extHash = ob.observedTx?.txHash || '';
      console.log(`  Outbound[${i}]: id=${ob.id} | status=${obStatus} | type=${txType} | dest=${ob.destinationChain} | recipient=${ob.recipient} | amount=${ob.amount} | extTxHash=${extHash || 'EMPTY'}`);

      // Collect observed external tx hashes for child UTX discovery
      if (extHash && extHash !== 'EMPTY') {
        childTxHashes.push(extHash);
      }
    }
  } else {
    console.log(`  No outbound txs`);
  }

  return childTxHashes;
}

// ── Step D: Find child UTX IDs from external tx hashes ───────────────
async function findChildUtxIds(
  externalTxHashes: string[],
  rpcUrl: string
): Promise<string[]> {
  const client = await StargateClient.connect(rpcUrl);
  const childUtxIds = new Set<string>();

  for (const extHash of externalTxHashes) {
    // Search for inbound events created from this external tx
    try {
      // Try searching by the external tx hash in inbound events
      const query = `universal_tx_created.inbound_tx_hash='${extHash}'`;
      const results = await client.searchTx(query);
      for (const tx of results) {
        for (const event of tx.events) {
          if (event.type === 'universal_tx_created' || event.type === 'outbound_created') {
            for (const attr of event.attributes || []) {
              if (attr.key === 'utx_id' && attr.value) {
                const id = attr.value.startsWith('0x') ? attr.value : `0x${attr.value}`;
                childUtxIds.add(id);
              }
            }
          }
        }
      }
    } catch {
      // Query might not be supported — skip
    }
  }

  return [...childUtxIds];
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const { txHash, intervalMs, timeoutMs, depth } = parseArgs();

  console.log(`Push Chain Cascade TX Inspector`);
  console.log(`TX Hash: ${txHash}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Max depth: ${depth}`);

  // Connect RPC for queries
  const tmClient = await Tendermint34Client.connect(RPC_URL);
  const queryClient = new QueryClient(tmClient);
  const rpc = createProtobufRpcClient(queryClient);

  // Step 1: Extract parent UTX IDs
  const { utxIds } = await extractAllUtxIds(txHash, RPC_URL);
  if (utxIds.length === 0) {
    console.error('No UTX IDs found. Exiting.');
    process.exit(1);
  }

  // Step 2: Query parent UTX(s)
  const visitedUtxIds = new Set<string>();
  const queue: Array<{ utxId: string; level: number }> = utxIds.map(id => ({ utxId: id, level: 0 }));

  while (queue.length > 0) {
    const { utxId, level } = queue.shift()!;
    const normalizedId = utxId.startsWith('0x') ? utxId : `0x${utxId}`;

    if (visitedUtxIds.has(normalizedId)) continue;
    visitedUtxIds.add(normalizedId);

    if (level > depth) {
      console.log(`\n[Depth ${level}] Skipping UTX ${normalizedId} (exceeds max depth ${depth})`);
      continue;
    }

    const label = level === 0 ? `PARENT (L${level})` : `CHILD (L${level})`;
    const response = await queryUtx(normalizedId, rpc, label);
    if (!response) continue;

    const externalTxHashes = printUtx(response, label);

    // Step 3: For each outbound with an external tx hash, try to find child UTXs
    if (level < depth && externalTxHashes.length > 0) {
      console.log(`\n[${label}] Searching for child UTXs from ${externalTxHashes.length} external tx hash(es)...`);

      // Try direct child UTX discovery
      const childIds = await findChildUtxIds(externalTxHashes, RPC_URL);
      if (childIds.length > 0) {
        console.log(`[${label}] Found ${childIds.length} child UTX ID(s): ${childIds.join(', ')}`);
        for (const childId of childIds) {
          queue.push({ utxId: childId, level: level + 1 });
        }
      } else {
        // Fallback: try querying each external hash as a potential Push Chain EVM tx
        for (const extHash of externalTxHashes) {
          try {
            const { utxIds: childUtxIds } = await extractAllUtxIds(extHash, RPC_URL);
            // These would be from the inbound execution on Push Chain
            // But the extHash is a BSC hash, not a Push Chain hash — skip
          } catch {
            // Expected — external hashes are not Push Chain tx hashes
          }
        }
        console.log(`[${label}] No child UTXs found via direct search. Child outbounds may be under inbound UTX.`);

        // Try: search for inbound_created events that reference outbound IDs
        const utx = response?.universalTx;
        if (utx?.outboundTx) {
          for (const ob of utx.outboundTx) {
            if (ob.observedTx?.txHash) {
              // Try searching cosmos events by the observed tx hash
              try {
                const client = await StargateClient.connect(RPC_URL);
                // Search for vote_inbound events with this tx hash
                const query = `vote_inbound.tx_hash='${ob.observedTx.txHash}'`;
                const results = await client.searchTx(query);
                for (const tx of results) {
                  for (const event of tx.events) {
                    if (event.type === 'outbound_created') {
                      for (const attr of event.attributes || []) {
                        if (attr.key === 'utx_id' && attr.value) {
                          const id = attr.value.startsWith('0x') ? attr.value : `0x${attr.value}`;
                          if (!visitedUtxIds.has(id)) {
                            console.log(`[${label}] Found child UTX via vote_inbound: ${id}`);
                            queue.push({ utxId: id, level: level + 1 });
                          }
                        }
                      }
                    }
                  }
                }
              } catch {
                // Query not supported
              }
            }
          }
        }
      }
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`INSPECTION COMPLETE`);
  console.log(`${'═'.repeat(80)}`);
  console.log(`Total UTXs inspected: ${visitedUtxIds.size}`);
  console.log(`UTX IDs: ${[...visitedUtxIds].join(', ')}`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
