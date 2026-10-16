import type { Abi, AbiEvent, Address, Hex, Log, PublicClient, TransactionReceipt } from 'viem';

/**
 * The narrow chain-read surface the AGW module needs. Tests mock it; the SDK
 * adapts the Push client's viem PublicClient. Every snapshot read passes an
 * explicit `blockNumber` so dependent reads observe one state.
 */
export interface ChainReader {
  readContract(args: {
    address: Address;
    abi: Abi | readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    blockNumber?: bigint;
  }): Promise<unknown>;
  getBlockNumber(): Promise<bigint>;
  getCode(args: { address: Address; blockNumber?: bigint }): Promise<Hex | undefined>;
  getBalance(args: { address: Address; blockNumber?: bigint }): Promise<bigint>;
  getLogs(args: {
    address: Address;
    event: AbiEvent;
    args?: Record<string, unknown>;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<Log[]>;
  getTransactionReceipt(args: { hash: Hex }): Promise<TransactionReceipt>;
}

export function chainReaderFromPublicClient(client: PublicClient): ChainReader {
  // viem's generics are narrower than this module's needs; the casts are
  // confined to this adapter.
  return {
    readContract: (args) =>
      client.readContract(args as Parameters<PublicClient['readContract']>[0]),
    getBlockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
    getCode: (args) => client.getCode(args),
    getBalance: (args) => client.getBalance(args),
    getLogs: (args) =>
      client.getLogs(args as Parameters<PublicClient['getLogs']>[0]) as Promise<Log[]>,
    getTransactionReceipt: (args) => client.getTransactionReceipt(args),
  };
}
