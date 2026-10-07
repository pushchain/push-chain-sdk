import type { Address } from 'viem';
import { AgenticCapability, requireCapability } from '../capabilities';
import type { AgenticGeneration } from '../deployments';
import type { ChainReader } from '../contracts/reader';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import type { Checkpoint } from '../agentic.types';
import { Snapshot, scanLogs } from './snapshot';

const MAX_ATTEMPTS = 2;

/**
 * w.checkpoints(): Checkpointed events in (block, tx, log) order, checked
 * against the wallet's checkpointCount() at the same snapshot block.
 * `sinceBlock` is inclusive. Evaluators should compare counts — one block can
 * hold several ticks, and allowance pulls change balances without any tick.
 */
export async function readCheckpoints(
  reader: ChainReader,
  gen: AgenticGeneration,
  wallet: Address,
  sinceBlock?: bigint
): Promise<{ checkpoints: Checkpoint[]; count: bigint; blockNumber: bigint }> {
  requireCapability(gen.capabilities, AgenticCapability.CHECKPOINTS);
  let lastError: AgenticError | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const snap = await Snapshot.at(reader);
    const count = BigInt(
      await snap.read<bigint>(wallet, gen.contracts.abis.wallet, 'checkpointCount')
    );
    const from = sinceBlock !== undefined && sinceBlock > gen.startBlock ? sinceBlock : gen.startBlock;
    const logs = await scanLogs(
      reader,
      { address: wallet, event: gen.contracts.events.checkpointed },
      from,
      snap.blockNumber
    );
    const decoded = gen.contracts
      .parseCheckpointed(logs, wallet)
      .sort((a, b) =>
        a.blockNumber !== b.blockNumber
          ? a.blockNumber < b.blockNumber
            ? -1
            : 1
          : a.transactionIndex !== b.transactionIndex
            ? a.transactionIndex - b.transactionIndex
            : a.logIndex - b.logIndex
      );
    const problem = validateSequence(decoded.map((c) => c.seq), count, sinceBlock === undefined || from === gen.startBlock);
    if (!problem) {
      return {
        count,
        blockNumber: snap.blockNumber,
        checkpoints: decoded.map(({ seq, kind, ref, blockNumber, txHash }) => ({
          seq,
          kind,
          ref,
          blockNumber,
          txHash,
        })),
      };
    }
    lastError = new AgenticError(AGENTIC_ERROR_CODE.INCONSISTENT_READ, problem, {
      details: { wallet, count, blockNumber: snap.blockNumber },
    });
  }
  throw lastError as AgenticError;
}

/** Sequence must be contiguous, end at `count`, and start at 1 for a full scan. */
export function validateSequence(seqs: number[], count: bigint, fullRange: boolean): string | null {
  for (let i = 1; i < seqs.length; i++) {
    if (seqs[i] !== seqs[i - 1] + 1) return `checkpoint sequence gap between ${seqs[i - 1]} and ${seqs[i]}`;
  }
  if (fullRange) {
    if (BigInt(seqs.length) !== count) {
      return `found ${seqs.length} Checkpointed events but checkpointCount() is ${count}`;
    }
    if (seqs.length > 0 && seqs[0] !== 1) return `first checkpoint seq is ${seqs[0]}, expected 1`;
    return null;
  }
  if (seqs.length > 0 && BigInt(seqs[seqs.length - 1]) !== count) {
    return `last checkpoint seq ${seqs[seqs.length - 1]} does not match checkpointCount() ${count}`;
  }
  return null;
}
