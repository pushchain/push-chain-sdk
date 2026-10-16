import type { AbiEvent, Address, Log } from 'viem';
import type { ChainReader } from '../contracts/reader';
import {
  AGENTIC_ERROR_CODE,
  AgenticError,
  type AgenticErrorCode,
} from '../errors';

/**
 * All reads of one logical operation are pinned to a single block so dependent
 * reads (enumerate IDs → per-ID config) observe one state. An RPC failure is
 * surfaced as an error; it is never treated as "empty".
 */
export class Snapshot {
  constructor(
    readonly reader: ChainReader,
    readonly blockNumber: bigint,
    private readonly failCode: AgenticErrorCode = AGENTIC_ERROR_CODE.RULE_READ_FAILED
  ) {}

  static async at(
    reader: ChainReader,
    failCode: AgenticErrorCode = AGENTIC_ERROR_CODE.RULE_READ_FAILED
  ): Promise<Snapshot> {
    let block: bigint;
    try {
      block = await reader.getBlockNumber();
    } catch (cause) {
      throw new AgenticError(
        failCode,
        'could not read the current Push block number',
        { cause }
      );
    }
    return new Snapshot(reader, block, failCode);
  }

  async read<T>(
    address: Address,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[] = []
  ): Promise<T> {
    try {
      return (await this.reader.readContract({
        address,
        abi,
        functionName,
        args,
        blockNumber: this.blockNumber,
      })) as T;
    } catch (cause) {
      throw new AgenticError(
        this.failCode,
        `${functionName} read on ${address} failed at block ${this.blockNumber}`,
        {
          cause,
          details: { address, functionName, blockNumber: this.blockNumber },
        }
      );
    }
  }

  async code(address: Address): Promise<boolean> {
    try {
      const code = await this.reader.getCode({
        address,
        blockNumber: this.blockNumber,
      });
      return !!code && code !== '0x';
    } catch (cause) {
      throw new AgenticError(this.failCode, `getCode(${address}) failed`, {
        cause,
      });
    }
  }
}

/** Max block span per eth_getLogs request. */
// Donut's public RPC limits eth_getLogs ranges to a distance of 1,000 blocks.
export const LOG_PAGE_BLOCKS = BigInt(1_000);

/**
 * Paginated log scan [fromBlock, toBlock] inclusive. A failed page fails the
 * whole scan; partial results are never returned.
 */
export async function scanLogs(
  reader: ChainReader,
  args: { address: Address; event: AbiEvent; args?: Record<string, unknown> },
  fromBlock: bigint,
  toBlock: bigint,
  page: bigint = LOG_PAGE_BLOCKS
): Promise<Log[]> {
  const out: Log[] = [];
  if (fromBlock > toBlock) return out;
  for (let start = fromBlock; start <= toBlock; start += page) {
    const end =
      start + page - BigInt(1) > toBlock ? toBlock : start + page - BigInt(1);
    try {
      out.push(
        ...(await reader.getLogs({ ...args, fromBlock: start, toBlock: end }))
      );
    } catch (cause) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.RULE_READ_FAILED,
        `log scan for ${args.event.name} failed for blocks ${start}-${end}`,
        { cause }
      );
    }
  }
  return out;
}
