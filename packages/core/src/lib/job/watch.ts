import { decodeEventLog, getAbiItem, getAddress, type Log } from 'viem';
import { JOB_KERNEL_ABI as ABI } from '../market/contracts/AgenticCommerce';
import { deployment, type StackRuntime } from '../market/runtime';
import { JobError } from '../market/errors';
import { fingerprint } from '../market/data';
import type { JobEvent, JobWatchOptions } from './types';

const names = [
  'JobCreated',
  'BudgetSet',
  'JobFunded',
  'JobSubmitted',
  'JobCompleted',
  'JobRejected',
  'JobExpired',
  'Refunded',
] as const;
const kinds = [
  'Created',
  'BudgetSet',
  'Funded',
  'Submitted',
  'Completed',
  'Rejected',
  'Expired',
  'Refunded',
];

export function watchJob(
  rt: StackRuntime,
  jobId: bigint,
  callback: (event: JobEvent) => void,
  options: JobWatchOptions
): () => void {
  const d = deployment(rt);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cursor = options.cursor && { ...options.cursor };
  let next = cursor?.blockNumber ?? options.fromBlock;
  const interval = options.pollIntervalMs ?? 3000;
  if (
    !Number.isSafeInteger(interval) ||
    interval < 25 ||
    (next !== undefined && (typeof next !== 'bigint' || next < BigInt(0))) ||
    (cursor &&
      (!Number.isSafeInteger(cursor.logIndex) ||
        cursor.logIndex < 0 ||
        (cursor.blockHash && !/^0x[\da-f]{64}$/i.test(cursor.blockHash)))) ||
    (cursor && options.fromBlock !== undefined)
  )
    throw new JobError(
      'INVALID_WATCH_OPTIONS',
      'Use a nonnegative block or a delivered-log cursor, and a polling interval of at least 25ms.'
    );
  const notify = (event: JobEvent): void => {
    try {
      callback(event);
    } catch (error) {
      if (event.kind !== 'Error' && !stopped) {
        try {
          callback({
            jobId,
            kind: 'Error',
            error,
            cursor: cursor && { ...cursor },
          });
        } catch {
          /* A consumer exception must not rewind delivery or reject an unobserved promise. */
        }
      }
    }
  };
  const poll = async () => {
    try {
      const head = await rt.agw.reader.getBlockNumber();
      if (stopped) return;
      if (cursor) {
        if (head < cursor.blockNumber)
          throw new JobError(
            'WATCH_REORG',
            'The delivered cursor is ahead of the canonical head. Reload status before continuing.'
          );
        const block =
          rt.agw.reader.getBlock &&
          (await rt.agw.reader.getBlock({ blockNumber: cursor.blockNumber }));
        if (
          head < cursor.blockNumber ||
          (cursor.blockHash &&
            block?.hash &&
            cursor.blockHash.toLowerCase() !== block.hash.toLowerCase())
        )
          throw new JobError(
            'WATCH_REORG',
            'The delivered cursor is no longer canonical. Reload job status and restart from a reviewed block.'
          );
      }
      if (next === undefined) next = head;
      const end = next + BigInt(999) < head ? next + BigInt(999) : head;
      if (next <= end) {
        const start = next;
        const groups = await Promise.all(
          names.map((name) =>
            rt.agw.reader.getLogs({
              address: d.kernel,
              event: getAbiItem({ abi: ABI, name }),
              args: { jobId },
              fromBlock: start,
              toBlock: end,
            })
          )
        );
        if (stopped) return;
        const unique = new Map<
          string,
          { log: Log; event: ReturnType<typeof decodeEventLog> }
        >();
        for (const log of groups.flat()) {
          if (log.removed)
            throw new JobError(
              'WATCH_REORG',
              'The RPC returned a removed job log. Reload status before continuing.'
            );
          if (
            getAddress(log.address) !== getAddress(d.kernel) ||
            log.blockNumber === null ||
            log.logIndex === null ||
            log.blockNumber < start ||
            log.blockNumber > end
          )
            throw new JobError(
              'INCONSISTENT_READ',
              'The RPC returned an unmined or out-of-range job log.'
            );
          const event = decodeEventLog({
            abi: ABI,
            data: log.data,
            topics: log.topics,
            strict: true,
          });
          if (
            (event.args as { jobId?: bigint }).jobId !== jobId ||
            !names.includes(event.eventName as (typeof names)[number])
          )
            throw new JobError(
              'INCONSISTENT_READ',
              'The RPC returned a different job or unsupported event.'
            );
          const key = `${log.blockNumber}:${log.logIndex}`;
          const previous = unique.get(key);
          if (previous && fingerprint(previous.log) !== fingerprint(log))
            throw new JobError(
              'INCONSISTENT_READ',
              'Two different logs occupy the same job cursor.'
            );
          unique.set(key, { log, event });
        }
        const ordered = [...unique.values()].sort(
          (a, b) =>
            Number(
              (a.log.blockNumber as bigint) - (b.log.blockNumber as bigint)
            ) || (a.log.logIndex as number) - (b.log.logIndex as number)
        );
        for (const { log, event } of ordered) {
          if (stopped) return;
          const blockNumber = log.blockNumber as bigint;
          const logIndex = log.logIndex as number;
          if (
            cursor &&
            (blockNumber < cursor.blockNumber ||
              (blockNumber === cursor.blockNumber &&
                logIndex <= cursor.logIndex))
          )
            continue;
          cursor = {
            blockNumber,
            logIndex,
            ...(log.blockHash ? { blockHash: log.blockHash } : {}),
          };
          notify({
            jobId,
            kind: kinds[
              names.indexOf(event.eventName as (typeof names)[number])
            ],
            txHash: log.transactionHash ?? undefined,
            blockNumber,
            data: event.args,
            cursor: { ...cursor },
          });
        }
        next = end + BigInt(1);
      }
    } catch (error) {
      if (stopped) return;
      if (error instanceof JobError && error.code === 'WATCH_REORG')
        stopped = true;
      notify({ jobId, kind: 'Error', error, cursor: cursor && { ...cursor } });
    } finally {
      if (!stopped)
        timer = setTimeout(() => {
          void poll();
        }, interval);
    }
  };
  void poll();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
