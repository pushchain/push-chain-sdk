import { parseAbi } from 'viem';
import type { ChainTarget, PushChain, ReadOptions, ReadPrepareOptions, ReadQueryOptions, ReadCallbackOptions, ReadValue, ValidateReadCall } from '../../../index';
import { CHAIN } from '../../constants/enums';
import type { BatchReadResponse, PreparedRead, UniversalReadResponse } from '../read-state.types';

const address = '0x1111111111111111111111111111111111111111';
const abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'claimable', stateMutability: 'nonpayable', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'quote', stateMutability: 'payable', inputs: [], outputs: [{ type: 'uint128' }, { type: 'bool' }] },
] as const;

/** A literal Anchor IDL type, as `anchor build` generates it. */
type CounterIdl = {
  address: '11111111111111111111111111111111';
  metadata: { name: 'counter'; version: '1'; spec: '0.1.0' };
  instructions: [];
  accounts: [{ name: 'Counter'; discriminator: [1, 2, 3, 4, 5, 6, 7, 8] }, { name: 'StakeVault'; discriminator: [8, 7, 6, 5, 4, 3, 2, 1] }];
  types: [
    { name: 'Counter'; type: { kind: 'struct'; fields: [{ name: 'count'; type: 'u64' }] } },
    { name: 'StakeVault'; type: { kind: 'struct'; fields: [{ name: 'owner'; type: 'pubkey' }] } },
  ];
};
declare const counterIdl: CounterIdl;

// Compiled by ts-jest; never executed or connected to a network.
async function checkTypes(client: PushChain) {
  // @ts-expect-error token program is inferred from the mint
  const removed: ReadOptions = { chain: CHAIN.SOLANA_DEVNET, token: address, tokenProgram: 'token-2022' };
  const accountIdl = { address, metadata: { name: 'counter', version: '1', spec: '0.1.0' }, instructions: [], accounts: [{ name: 'counter', discriminator: [1,2,3,4,5,6,7,8] }], types: [{ name: 'counter', type: { kind: 'struct', fields: [{ name: 'count', type: 'u64' }] } }] } satisfies import('@coral-xyz/anchor').Idl;
  // A dynamic IDL yields an unknown result rather than incorrectly promising bigint.
  const decodedAccount = await client.universal.read(address, { chain: CHAIN.SOLANA_DEVNET, idl: accountIdl });
  const decodedValue: unknown = decodedAccount.value;
  await client.universal.read(address, { chain: CHAIN.SOLANA_DEVNET, idl: accountIdl, functionName: 'counter' });
  // @ts-expect-error IDL is Solana-only
  const wrongNamespace: ReadOptions = { chain: CHAIN.ETHEREUM_SEPOLIA, idl: accountIdl };
  // @ts-expect-error accountName was removed; the layout is functionName
  const removedAccountName: ReadOptions = { chain: CHAIN.SOLANA_DEVNET, idl: accountIdl, accountName: 'counter' };
  // @ts-expect-error idl and abi are mutually exclusive
  const idlAndAbi: ReadOptions = { chain: CHAIN.SOLANA_DEVNET, idl: accountIdl, abi };
  // A literal IDL types the value: by name in any case style, or as the union when inferred.
  const byPascal = await client.universal.read(address, { chain: CHAIN.SOLANA_DEVNET, idl: counterIdl, functionName: 'Counter' });
  const bySnake = await client.universal.read(address, { chain: CHAIN.SOLANA_DEVNET, idl: counterIdl, functionName: 'stake_vault' });
  const byCamel = await client.universal.read(address, { chain: CHAIN.SOLANA_DEVNET, idl: counterIdl, functionName: 'stakeVault' });
  const inferred = await client.universal.read(address, { chain: CHAIN.SOLANA_DEVNET, idl: counterIdl });
  const pda = await client.universal.read(counterIdl.address, { chain: CHAIN.SOLANA_DEVNET, idl: counterIdl, functionName: 'counter', args: [] });
  type _typed = [
    Assert<Equal<ResultValue<typeof byPascal>['count'], import('@coral-xyz/anchor').BN>>,
    Assert<Equal<ResultValue<typeof bySnake>['owner'], import('@solana/web3.js').PublicKey>>,
    Assert<Equal<ResultValue<typeof byCamel>, ResultValue<typeof bySnake>>>,
    Assert<Equal<ResultValue<typeof inferred>, ResultValue<typeof byPascal> | ResultValue<typeof bySnake>>>,
    Assert<Equal<ResultValue<typeof pda>, ResultValue<typeof byPascal>>>,
  ];
  // @ts-expect-error not an account layout in the IDL
  client.universal.read(address, { chain: CHAIN.SOLANA_DEVNET, idl: counterIdl, functionName: 'missing' });
  client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA, callback: { gasLimit: 750_000n } });
  client.universal.prepareRead(address, { chain: CHAIN.ETHEREUM_SEPOLIA, callback: { target: address, gasLimit: 200_000n } });
  client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA, callback: { target: address, gasLimit: 200_000n, abi, functionName: 'request', args: (spec, gas) => [spec, gas] } });
  // @ts-expect-error execution requires the custom request entrypoint
  const missingEntrypoint: ReadOptions = { chain: CHAIN.ETHEREUM_SEPOLIA, callback: { target: address, gasLimit: 200_000n } };
  // @ts-expect-error registry entrypoint is internal
  const registryAbi: ReadOptions = { chain: CHAIN.ETHEREUM_SEPOLIA, callback: { abi, functionName: 'request' } };
  // @ts-expect-error removed callback.request shape
  const legacy: ReadPrepareOptions = { chain: CHAIN.ETHEREUM_SEPOLIA, callback: { target: address, gasLimit: 200_000n, request: { abi, functionName: 'request' } } };
  // @ts-expect-error mutually exclusive query kinds
  const mixed: ReadOptions = { chain: CHAIN.ETHEREUM_SEPOLIA, token: address, storageSlot: 0n };
  // @ts-expect-error storage is EVM only
  const svm: ReadOptions = { chain: CHAIN.SOLANA_DEVNET, storageSlot: 0n };
  // @ts-expect-error Solana chooses its finalized slot internally
  const svmPin: ReadOptions = { chain: CHAIN.SOLANA_DEVNET, blockNumber: 1n };
  // @ts-expect-error web2 chain requires extraction options
  const web: ReadOptions = { chain: CHAIN.WEB2 };
  // @ts-expect-error web2 queries cannot target an EVM chain
  const wrongWeb: ReadOptions = { chain: CHAIN.ETHEREUM_SEPOLIA, web2: { extract: [] } };
  // @ts-expect-error Web2 is a read-only destination, not a transaction chain
  const web2Transaction: ChainTarget = { address, chain: CHAIN.WEB2 };
  // @ts-expect-error a custom target needs its request entrypoint (abi + functionName)
  const callback: ReadOptions = { chain: CHAIN.ETHEREUM_SEPOLIA, callback: { target: address } };
  // callback gas is optional for custom targets too (defaults to 500_000n)
  const defaultGas: ReadOptions = { chain: CHAIN.ETHEREUM_SEPOLIA, callback: { target: address, abi, functionName: 'request' } };
  const preparedDefaultGas: ReadPrepareOptions = { chain: CHAIN.ETHEREUM_SEPOLIA, callback: { target: address } };
  // A non-literal ABI types value as unknown (viem returns one output bare), not as an array.
  const looseAbi = abi as unknown as import('viem').Abi;
  const loose = await client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA, abi: looseAbi, functionName: 'balanceOf', args: [address] });
  type _loose = Assert<Equal<ResultValue<typeof loose>, unknown>>;
  // @ts-expect-error preparation has no lifecycle settings
  const lifecycle: ReadPrepareOptions = { chain: CHAIN.ETHEREUM_SEPOLIA, waitForCompletion: true };
  // @ts-expect-error args require an ABI
  const args: ReadOptions = { chain: CHAIN.ETHEREUM_SEPOLIA, args: [] };
  // Any mutability reads: the validator simulates the call with eth_call and never executes it.
  const nonpayable: UniversalReadResponse<bigint> = await client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA, abi, functionName: 'claimable', args: [address] });
  const payable: UniversalReadResponse<readonly [bigint, boolean]> = await client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA, abi, functionName: 'quote' });
  client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA, abi, functionName: 'transfer' });
  // @ts-expect-error nonpayable functions still type-check their args
  client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA, abi, functionName: 'claimable', args: [1n] });
  // @ts-expect-error missing ABI argument
  client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA, abi, functionName: 'balanceOf' });
  // @ts-expect-error wrong argument type
  client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA, abi, functionName: 'balanceOf', args: [123] });
  const native: UniversalReadResponse<bigint> = await client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA });
  const token: UniversalReadResponse<bigint> = await client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA, token: address });
  const call: UniversalReadResponse<bigint> = await client.universal.read(address, { chain: CHAIN.ETHEREUM_SEPOLIA, abi, functionName: 'balanceOf', args: [address] });
  const webResult: UniversalReadResponse<readonly [bigint, boolean]> = await client.universal.read('https://example.com', { chain: CHAIN.WEB2, web2: { extract: [{ path: '$.price', valueType: 'uint256' }, { path: '$.ok', valueType: 'bool' }] } });
  const prepared = await client.universal.prepareRead(address, { chain: CHAIN.ETHEREUM_SEPOLIA });
  const batch: BatchReadResponse<readonly [PreparedRead<bigint>]> = await client.universal.executeReads([prepared]);
  const resumed: UniversalReadResponse<bigint> = await native.wait();
  void [defaultGas, preparedDefaultGas, nonpayable, payable, decodedValue, wrongNamespace, removedAccountName, idlAndAbi, mixed, svm, svmPin, web, wrongWeb, web2Transaction, callback, lifecycle, args, native, token, call, webResult, batch, resumed];
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
  const singleType: Assert<Equal<ResultValue<typeof single>, bigint>> = true;
  const multiType: Assert<Equal<ResultValue<typeof multi>, readonly [bigint, boolean]>> = true;
  const prepared = await client.universal.prepareRead(address, { chain: CHAIN.ETHEREUM_SEPOLIA, abi: overloaded, functionName: 'foo', args: [address] });
  const { reads: [result] } = await client.universal.executeReads([prepared]);
  const batchType: Assert<Equal<ResultValue<typeof result>, bigint>> = true;
  const resumed = await result.wait();
  const waitType: Assert<Equal<ResultValue<typeof resumed>, bigint>> = true;
  void [singleType, multiType, batchType, waitType];
}
// Imports resolve from the same package entrypoint consumers use.
type ExportChecks = [ReadQueryOptions, ReadCallbackOptions, ReadValue<ReadOptions>, ValidateReadCall<ReadOptions>];
test('overload and package export type contracts compile', () => { expect(typeof checkOverloads).toBe('function'); });
