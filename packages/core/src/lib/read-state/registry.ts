import { encodeAbiParameters, keccak256, type Address, type Hex, type PublicClient } from 'viem';
import { PUSH_NETWORK } from '../constants/enums';
import { REGISTRY_CALLBACK_GAS, UNIVERSAL_READ_REGISTRY_ADDRESS, WEB2_DEFAULT_TIMEOUT_MS } from '../constants/read-state';
import { UNIVERSAL_READ_REGISTRY_EVM } from '../constants/abi/universalReadRegistry.evm';
import { encodeReadQuery } from './envelopes';
import { resolveDestination } from './destination';
import { InvalidReadQueryError, ReadRegistryUnavailableError } from './errors';
import type { ReadCallback, ReadDestination, ReadQuery } from './read-state.types';

/** Versioned logical identity. Height, fee, expiry, refund, callback and HTTP timeout are excluded. */
export function computeReadQueryKey(destination: ReadDestination, query: ReadQuery): Hex {
  const dest = resolveDestination(destination);
  // Use fixed references in the existing canonical encoders; never hash live heights.
  const encoded = encodeReadQuery(destination, query.type === 'http' ? { ...query, timeoutMs: WEB2_DEFAULT_TIMEOUT_MS } : query,
    { blockNumber: 1n, minSlot: 0n });
  return keccak256(encodeAbiParameters(
    [{ type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'bytes' }, { type: 'bytes' }],
    ['pushchain:universal-read:query:v1', dest.chainNamespace, dest.chainId, encoded.ownerBytes ?? '0x', encoded.encoded],
  ));
}

export function getReadRegistryAddress(network: PUSH_NETWORK): Address {
  const address = (UNIVERSAL_READ_REGISTRY_ADDRESS as Partial<Record<PUSH_NETWORK, Address>>)[network];
  if (!address) throw new ReadRegistryUnavailableError('read registry');
  return address;
}

export function resolveReadCallback(callback: ReadCallback | undefined, network: PUSH_NETWORK, queryKey: Hex): ReadCallback & { gasLimit: bigint } {
  if (callback?.target !== undefined) {
    if (callback.gasLimit === undefined) throw new InvalidReadQueryError('callback.gasLimit is required for a custom target');
    return { ...callback, gasLimit: callback.gasLimit };
  }
  if (callback?.request !== undefined) throw new InvalidReadQueryError('callback.request requires callback.target');
  return {
    target: getReadRegistryAddress(network),
    gasLimit: callback?.gasLimit ?? REGISTRY_CALLBACK_GAS,
    request: { abi: UNIVERSAL_READ_REGISTRY_EVM, functionName: 'read', args: (spec, gas) => [spec, queryKey, gas] },
  };
}

/** Raw registry storage only: presence does not prove successful consensus or freshness. */
export function getRegistryReadResult(client: Pick<PublicClient, 'readContract'>, network: PUSH_NETWORK, requestId: bigint) {
  return client.readContract({ address: getReadRegistryAddress(network), abi: UNIVERSAL_READ_REGISTRY_EVM,
    functionName: 'resultByRequestId', args: [requestId] });
}

/** Keys are caller-supplied labels; verify the associated request before relying on its identity. */
export function getLatestRegistryReadResult(client: Pick<PublicClient, 'readContract'>, network: PUSH_NETWORK, reader: Address, queryKey: Hex) {
  return client.readContract({ address: getReadRegistryAddress(network), abi: UNIVERSAL_READ_REGISTRY_EVM,
    functionName: 'latestResult', args: [reader, queryKey] });
}
