import '@e2e/shared/setup';
/**
 * E2E · read state · typed contract call. `abi` encodes the eth_call AND decodes the
 * result, so `value` comes back typed — here `totalSupply()` of a Sepolia ERC-20,
 * cross-checked with a direct eth_call at the same pinned block.
 */
import { PushChain } from '../../../src';
import { CHAIN } from '../../../src/lib/constants/enums';
import { CALLBACK_GAS, FULL_BUDGET_CLIENT, READ_CLIENT_ABI, makePushEoaClient, pushKey, SLOW_PATH, createProgressTracker, retryTruth, sepoliaTruth } from '../_shared';

/** Sepolia USDT used across the suite's Route 1 specs. */
const TOKEN = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const;
const ABI = [
  // A non-selected overload verifies that result decoding retains the exact function.
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const;
const READ = PushChain.CONSTANTS.READ;

const d = pushKey ? describe : describe.skip;

d('read state › EVM typed contract call', () => {
  const sepoliaRpc = sepoliaTruth();

  it('abi/functionName read returns the decoded return value', async () => {
    const tracker = createProgressTracker();
    const { client } = await makePushEoaClient(pushKey!, (event) => {
      // Every READ-TX payload must be JSON-serialisable (no raw bigints) for consumers.
      if (event.id.startsWith('READ-TX-')) expect(() => JSON.stringify(event)).not.toThrow();
      tracker.hook(event);
    });
    const prepared = await client.universal.prepareRead(TOKEN, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      abi: ABI,
      functionName: 'totalSupply',
      args: [],
      callback: { target: FULL_BUDGET_CLIENT, gasLimit: CALLBACK_GAS, request: { abi: READ_CLIENT_ABI, functionName: 'request' } },
      expiryBlocks: SLOW_PATH.expiryBlocks,
    });
    expect(prepared.encodedQuery.resultShape).toMatchObject({ kind: 'evmCall', functionName: 'totalSupply' });

    const { reads: [done] } = await client.universal.executeReads([prepared], { advanced: { timeout: SLOW_PATH.wait.timeoutMs, pollingIntervalMs: SLOW_PATH.wait.pollingIntervalMs } });
    expect(done.status).toBe(READ.STATUS.FULFILLED);
    expect(done.callbackDelivered).toBe(true);

    const truth = await retryTruth(() => sepoliaRpc.readContract({ address: TOKEN, abi: ABI, functionName: 'totalSupply', args: [], blockNumber: prepared.spec.blockNumber }));
    expect(done.decoded).toEqual({ kind: 'evmCall', value: truth });
    expect(done.value).toBe(truth);
  }, SLOW_PATH.jestTimeoutMs);
});
