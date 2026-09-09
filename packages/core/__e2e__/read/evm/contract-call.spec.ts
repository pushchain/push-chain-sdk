import '@e2e/shared/setup';
/**
 * E2E · read state · typed contract call. `abi` encodes the eth_call AND decodes the
 * result, so `value` comes back typed — here `totalSupply()` of a Sepolia ERC-20,
 * cross-checked with a direct eth_call at the same pinned block.
 */
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { PushChain } from '../../../src';
import { CHAIN } from '../../../src/lib/constants/enums';
import { SEPOLIA_RPC } from '@e2e/shared/constants';
import { CALLBACK_GAS, FULL_BUDGET_CLIENT, makePushEoaClient, pushKey, sendRead, SLOW_PATH } from '../_shared';

/** Sepolia USDT used across the suite's Route 1 specs. */
const TOKEN = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const;
const ABI = [
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const;
const READ = PushChain.CONSTANTS.READ;

const d = pushKey ? describe : describe.skip;

d('read state › EVM typed contract call', () => {
  const sepoliaRpc = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });

  it('abi/functionName read returns the decoded return value', async () => {
    const { client } = await makePushEoaClient(pushKey!);
    const prepared = await client.universal.prepareRead(TOKEN, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      abi: ABI,
      functionName: 'totalSupply',
      callback: { target: FULL_BUDGET_CLIENT, gasLimit: CALLBACK_GAS },
      expiryBlocks: SLOW_PATH.expiryBlocks,
    });
    expect(prepared.encodedQuery.resultShape).toMatchObject({ kind: 'evmCall', functionName: 'totalSupply' });

    const { read } = await sendRead(client, prepared, FULL_BUDGET_CLIENT);
    // resume by tx hash knows nothing about the ABI: hand the shape back for decoding
    const done = await read.wait({ ...SLOW_PATH.wait, resultShape: prepared.encodedQuery.resultShape });
    expect(done.status).toBe(READ.STATUS.FULFILLED);
    expect(done.callbackDelivered).toBe(true);

    const truth = await sepoliaRpc.readContract({ address: TOKEN, abi: ABI, functionName: 'totalSupply', blockNumber: prepared.spec.blockNumber });
    expect(done.decoded).toEqual({ kind: 'evmCall', values: [truth] });
    expect(done.value).toEqual([truth]);
  }, SLOW_PATH.jestTimeoutMs);
});
