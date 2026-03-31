/**
 * Outbound transaction tracking and UTX ID extraction, extracted from Orchestrator.
 */

import { keccak256, toBytes } from 'viem';
import { CHAIN_INFO } from '../../constants/chain';
import type { PushClient } from '../../push-client/push-client';
import type { PUSH_NETWORK } from '../../constants/enums';
import type { OrchestratorContext } from './context';
import { printLog } from './context';
import { getPushChainForNetwork } from './helpers';

// ============================================================================
// UTX ID Computation
// ============================================================================

export function computeUniversalTxId(
  pushNetwork: PUSH_NETWORK,
  pushChainTxHash: string
): string {
  const pushChain = getPushChainForNetwork(pushNetwork);
  const pushChainId = CHAIN_INFO[pushChain].chainId;
  const input = `eip155:${pushChainId}:${pushChainTxHash}`;
  return keccak256(toBytes(input));
}

// ============================================================================
// UTX ID Extraction from Cosmos Events
// ============================================================================

export async function extractUniversalSubTxIdFromTx(
  ctx: OrchestratorContext,
  pushChainTxHash: string
): Promise<string | null> {
  printLog(ctx, `[extractUniversalSubTxIdFromTx] Fetching Cosmos tx for: ${pushChainTxHash}`);

  try {
    const cosmosTx = await ctx.pushClient.getCosmosTx(pushChainTxHash);

    if (!cosmosTx?.events) {
      printLog(ctx, `[extractUniversalSubTxIdFromTx] No events in Cosmos tx`);
      return null;
    }

    for (const event of cosmosTx.events) {
      if (event.type === 'outbound_created') {
        const utxIdAttr = event.attributes?.find(
          (attr: { key: string; value?: string }) => attr.key === 'utx_id'
        );
        if (utxIdAttr?.value) {
          const universalsubTxId = utxIdAttr.value.startsWith('0x')
            ? utxIdAttr.value
            : `0x${utxIdAttr.value}`;
          printLog(
            ctx,
            `[extractUniversalSubTxIdFromTx] Found universalsubTxId from outbound_created event: ${universalsubTxId}`
          );
          return universalsubTxId;
        }
      }
    }

    printLog(ctx, `[extractUniversalSubTxIdFromTx] No outbound_created event found`);
    return null;
  } catch (error) {
    printLog(
      ctx,
      `[extractUniversalSubTxIdFromTx] Error: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

export async function extractAllUniversalSubTxIds(
  ctx: OrchestratorContext,
  pushChainTxHash: string
): Promise<string[]> {
  printLog(ctx, `[extractAllUniversalSubTxIds] Fetching Cosmos tx for: ${pushChainTxHash}`);

  try {
    const cosmosTx = await ctx.pushClient.getCosmosTx(pushChainTxHash);

    if (!cosmosTx?.events) {
      printLog(ctx, `[extractAllUniversalSubTxIds] No events in Cosmos tx`);
      return [];
    }

    const subTxIds: string[] = [];
    for (const event of cosmosTx.events) {
      if (event.type === 'outbound_created') {
        const utxIdAttr = event.attributes?.find(
          (attr: { key: string; value?: string }) => attr.key === 'utx_id'
        );
        if (utxIdAttr?.value) {
          const id = utxIdAttr.value.startsWith('0x')
            ? utxIdAttr.value
            : `0x${utxIdAttr.value}`;
          subTxIds.push(id);
        }
      }
    }

    printLog(
      ctx,
      `[extractAllUniversalSubTxIds] Found ${subTxIds.length} sub-tx IDs: ${subTxIds.join(', ')}`
    );
    return subTxIds;
  } catch (error) {
    printLog(
      ctx,
      `[extractAllUniversalSubTxIds] Error: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}
