import { parseAbi } from 'viem';
import type { PushChain, ReadOptions, ReadPrepareOptions, ReadQueryOptions, ReadCallbackOptions, ReadValue, ValidateReadCall } from '../../../index';
import { CHAIN } from '../../constants/enums';
import { READ_CHAIN_WEB2 } from '../read-params';
import type { UniversalReadResponse } from '../read-state.types';

const address = '0x1111111111111111111111111111111111111111';
const abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const;

// Compiled by ts-jest; never executed or connected to a network.
async function checkTypes(client: PushChain) {
  // @ts-expect-error mutually exclusive query kinds
  const mixed: ReadOptions = { chain: CHAIN.ETHEREUM_SEPOLIA, token: address, storageSlot: 0n };
  // @ts-expect-error storage is EVM only
  const svm: ReadOptions = { chain: CHAIN.SOLANA_DEVNET, storageSlot: 0n };
  // @ts-expect-error web2 chain requires extraction options
  const web: ReadOptions = { chain: READ_CHAIN_WEB2 };
  // @ts-expect-error web2 queries cannot target an EVM chain
  const wrongWeb: ReadOptions = { chain: CHAIN.ETHEREUM_SEPOLIA, web2: { extract: [] } };
  // @ts-expect-error custom callbacks require gas
  const callback: ReadOptions = { chain: CHAIN.ETHEREUM_SEPOLIA, callback: { target: address } };
  // @ts-expect-error preparation has no lifecycle settings
  const lifecycle: ReadPrepareOptions = { chain: CHAIN.ETHEREUM_SEPOLIA, waitForCompletion: true };
  // @ts-expect-error args require an ABI
  const args: ReadOptions = { chain: CHAIN.ETHEREUM_SEPOLIA, args: [] };
  // @ts-expect-error only view/pure ABI functions are readable
  client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA, abi, functionName: 'transfer' });
  // @ts-expect-error missing ABI argument
  client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA, abi, functionName: 'balanceOf' });
  // @ts-expect-error wrong argument type
  client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA, abi, functionName: 'balanceOf', args: [123] });
  const native: UniversalReadResponse<bigint> = await client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA });
  const call: UniversalReadResponse<readonly [bigint]> = await client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA, abi, functionName: 'balanceOf', args: [address] });
  const webResult: UniversalReadResponse<readonly [bigint, boolean]> = await client.universal.read('https://example.com', { chain: READ_CHAIN_WEB2, web2: { extract: [{ path: '$.price', valueType: 'uint256' }, { path: '$.ok', valueType: 'bool' }] } });
  const prepared = await client.universal.prepareRead(address, { chain: CHAIN.ETHEREUM_SEPOLIA });
  const batch: [UniversalReadResponse<bigint>] = await client.universal.executeReads([prepared]);
  const resumed: UniversalReadResponse<bigint> = await native.wait();
  void [mixed, svm, web, wrongWeb, callback, lifecycle, args, native, call, webResult, batch, resumed];
}

test('public read type contracts compile', () => { expect(typeof checkTypes).toBe('function'); });

const overloaded = parseAbi([
  'function foo(address x) view returns (uint256)',
  'function foo(uint256 x) view returns (uint256,bool)',
]);
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type ResultValue<R> = R extends UniversalReadResponse<infer V> ? V : never;

async function checkOverloads(client: PushChain) {
  const single = await client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA, abi: overloaded, functionName: 'foo', args: [address] });
  const multi = await client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA, abi: overloaded, functionName: 'foo', args: [1n] });
  // Exact equality rejects never (which assignment-only tests incorrectly accept).
  const singleType: Assert<Equal<ResultValue<typeof single>, readonly [bigint]>> = true;
  const multiType: Assert<Equal<ResultValue<typeof multi>, readonly [bigint, boolean]>> = true;
  const prepared = await client.universal.prepareRead(address, { chain: CHAIN.ETHEREUM_SEPOLIA, abi: overloaded, functionName: 'foo', args: [address] });
  const [result] = await client.universal.executeReads([prepared]);
  const batchType: Assert<Equal<ResultValue<typeof result>, readonly [bigint]>> = true;
  const resumed = await result.wait();
  const waitType: Assert<Equal<ResultValue<typeof resumed>, readonly [bigint]>> = true;
  void [singleType, multiType, batchType, waitType];
}
// Imports resolve from the same package entrypoint consumers use.
type ExportChecks = [ReadQueryOptions, ReadCallbackOptions, ReadValue<ReadOptions>, ValidateReadCall<ReadOptions>];
test('overload and package export type contracts compile', () => { expect(typeof checkOverloads).toBe('function'); });
