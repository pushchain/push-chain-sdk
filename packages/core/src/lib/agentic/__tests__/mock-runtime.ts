import type { Address, Hex } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import type { UniversalTxResponse } from '../../orchestrator/orchestrator.types';
import type { ProgressEvent } from '../../progress-hook/progress-hook.types';
import type { AgenticRuntime } from '../runtime';
import { ADDR, FakeChain, PUSH_NS } from './fake-chain';

export interface MockRuntime extends AgenticRuntime {
  executeMock: jest.Mock;
  atomicMock: jest.Mock;
  events: ProgressEvent[];
  perCallEvents: ProgressEvent[];
  fake: FakeChain;
}

/** A response shaped like core's R1 response for a call to `to`. */
export function fakeResponse(over: Partial<UniversalTxResponse> = {}): UniversalTxResponse {
  const resp = {
    hash: `0x${'aa'.repeat(32)}`,
    origin: `eip155:42101:${ADDR.agent}`,
    blockNumber: BigInt(101),
    blockHash: '0x',
    transactionIndex: 0,
    chainId: '42101',
    from: ADDR.agent,
    to: ADDR.target,
    nonce: 1,
    data: '0x',
    value: BigInt(0),
    gasLimit: BigInt(21000),
    accessList: [],
    wait: async () => ({
      hash: resp.hash,
      blockNumber: BigInt(101),
      blockHash: '0x',
      transactionIndex: 0,
      from: resp.from,
      to: resp.to,
      contractAddress: null,
      gasPrice: BigInt(0),
      gasUsed: BigInt(0),
      cumulativeGasUsed: BigInt(0),
      logs: [],
      logsBloom: '0x',
      status: 1 as const,
      raw: { from: resp.from, to: resp.to },
    }),
    progressHook: () => undefined,
    type: '2',
    typeVerbose: 'eip1559',
    atomic: true,
    signature: { r: '0x', s: '0x', v: 0 },
    ...over,
  } as unknown as UniversalTxResponse;
  return resp;
}

export function mockRuntime(
  fake: FakeChain,
  over: Partial<AgenticRuntime> & { signer?: Address; readOnly?: boolean } = {}
): MockRuntime {
  const events: ProgressEvent[] = [];
  const perCallEvents: ProgressEvent[] = [];
  const executeMock = jest.fn(async (params: { to: string; data?: Hex }) =>
    fakeResponse({ to: params.to, data: (params.data as string) ?? '0x' })
  );
  const atomicMock = jest.fn(async (params: { to: string }) => fakeResponse({ to: params.to }));
  const signer = over.signer ?? ADDR.agent;
  const rt: MockRuntime = {
    network: PUSH_NETWORK.TESTNET_DONUT,
    pushChainNamespace: PUSH_NS,
    reader: fake,
    isReadOnly: over.readOnly ?? false,
    signerPushAccount: () => signer,
    signerOrigin: () => ({ chain: CHAIN.PUSH_TESTNET_DONUT, address: signer }),
    signerIsPushNative: () => true,
    execute: executeMock as unknown as AgenticRuntime['execute'],
    executeAtomicBatch: atomicMock as unknown as AgenticRuntime['executeAtomicBatch'],
    emit: (event, perCall) => {
      events.push(event);
      if (perCall) {
        perCallEvents.push(event);
        perCall(event);
      }
    },
    signerAccountDeployed: async () => true,
    signerBalance: async () => BigInt(10) ** BigInt(20),
    getGasPrice: async () => BigInt(1),
    quoteOutbound: async () => ({ protocolFee: BigInt(100), nativeValueForGas: BigInt(1000), gasLimitUsed: BigInt(200_000) }),
    resolveCEA: async () => ({ cea: '0x000000000000000000000000000000000000CeA1' as Address, isDeployed: true }),
    resolvePrc20: () => '0x0000000000000000000000000000000000007070' as Address,
    nowSeconds: () => 1_700_000_000,
    ...over,
    executeMock,
    atomicMock,
    events,
    perCallEvents,
    fake,
  };
  if (over.execute) rt.execute = over.execute;
  return rt;
}
