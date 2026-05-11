/**
 * External-tx-hash display helpers.
 *
 * Lives at a neutral cross-module location so both the orchestrator and the
 * universal-tx-detector module can import without creating a circular /
 * back-layered dependency (orchestrator/internals imports detector via
 * inbound-tracker.ts; detector must not import back into orchestrator).
 *
 * The SDK stores SVM (Solana) outbound tx signatures as `0x`-prefixed hex
 * internally — that's how the Cosmos keeper indexes them. Users, however,
 * expect Solana explorers / RPCs to see base58 signatures. `toExternalTxHashDisplay`
 * is the one-way conversion applied at every user-facing boundary; the
 * internal canonical form stays hex.
 */

import { CHAIN_INFO, VM_NAMESPACE } from '../constants/chain';
import { CHAIN, VM } from '../constants/enums';
import { bs58 } from '../internal/bs58';

/**
 * Convert an outbound tx hash from the internal canonical form (`0x`-prefixed
 * hex, as Cosmos delivers it) to the form users expect on the destination
 * chain. SVM signatures (64 bytes) become base58; EVM hashes pass through
 * unchanged. Idempotent: a value that already lacks `0x` or whose chain isn't
 * SVM is returned as-is.
 *
 * Used at user-facing boundaries that surface `externalTxHash` (receipt
 * construction in response-builder, cascade hop info in cascade.ts, detector
 * public-API output normalization). Do NOT apply at internal boundaries —
 * `findChildUtxIdFromExternalTx` and the Cosmos tx-search query in
 * inbound-tracker.ts expect the raw hex form.
 */
export function toExternalTxHashDisplay(
  chain: CHAIN | undefined,
  rawTxHash: string | undefined
): string | undefined {
  if (!rawTxHash) return rawTxHash;
  if (!chain || CHAIN_INFO[chain]?.vm !== VM.SVM) return rawTxHash;
  if (!rawTxHash.startsWith('0x')) return rawTxHash;
  const bytes = new Uint8Array(Buffer.from(rawTxHash.slice(2), 'hex'));
  return bs58.encode(Buffer.from(bytes));
}

/**
 * Map a CAIP namespace string (e.g. `'solana:devnet'`, `'eip155:11155111'`)
 * to the corresponding `CHAIN` enum value, or `null` if no matching chain is
 * registered. Used to resolve `PushChainOutboundSummary.destinationChain`
 * (string) to a CHAIN enum so `toExternalTxHashDisplay` can decide whether
 * to convert.
 */
export function chainFromNamespace(namespace: string): CHAIN | null {
  for (const [chainKey, info] of Object.entries(CHAIN_INFO)) {
    const expected = `${VM_NAMESPACE[info.vm]}:${info.chainId}`;
    if (expected === namespace) {
      return chainKey as CHAIN;
    }
  }
  return null;
}
