import type { Address } from 'viem';
import { UNIVERSAL_CALLBACK_EVM } from '../constants/abi/universalCallback.evm';
import { UNIVERSAL_CORE_EVM } from '../constants/abi/prc20.evm';
import { UNIVERSAL_CALLBACK_ADDRESSES, UNIVERSAL_CORE_ADDRESSES } from '../constants/chain';
import type { PUSH_NETWORK } from '../constants/enums';
import { READ_NAMESPACE } from '../constants/read-state';
import type { PushClient } from '../push-client/push-client';
import { resolveDestination } from './destination';
import { ReadHeightUnavailableError, UnsupportedReadDestinationError } from './errors';
import type { ReadDestination, ReadPreflight } from './read-state.types';

/** The slice of OrchestratorContext preflight needs — keeps it testable with a bare mock. */
export interface PreflightDeps {
  pushClient: Pick<PushClient, 'readContract' | 'getGasPrice' | 'publicClient'>;
  pushNetwork: PUSH_NETWORK;
}

/**
 * Fetch the on-chain values a valid ReadSpec depends on. Four reads against Push Chain,
 * none against the destination:
 *
 *   UniversalCore.chainHeightByChainNamespace(caip2)   → blockNumber ceiling
 *   UniversalCallback.estimateFee(ns, chainId)          → protocol fee (msg.value floor)
 *   UniversalCallback.blockedDomains(ns, chainId)       → fail fast on a blocklisted domain
 *   eth_blockNumber + eth_gasPrice                      → expiry + budget sizing
 *
 * The height is keyed by the FULL CAIP-2 id — the oracle writes it that way. Passing the
 * bare namespace reads 0 and was the C1 blocker.
 */
export async function preflightRead(deps: PreflightDeps, destination: ReadDestination): Promise<ReadPreflight> {
  const dest = resolveDestination(destination);
  const universalCore = UNIVERSAL_CORE_ADDRESSES[deps.pushNetwork] as Address;
  const universalCallback = UNIVERSAL_CALLBACK_ADDRESSES[deps.pushNetwork] as Address;
  const { pushClient } = deps;

  const [observedChainHeight, protocolFee, blocked, pushBlockNumber, pushGasPrice] = await Promise.all([
    pushClient.readContract<bigint>({
      address: universalCore,
      abi: UNIVERSAL_CORE_EVM,
      functionName: 'chainHeightByChainNamespace',
      args: [dest.caip2],
    }),
    pushClient.readContract<bigint>({
      address: universalCallback,
      abi: UNIVERSAL_CALLBACK_EVM,
      functionName: 'estimateFee',
      args: [dest.chainNamespace, dest.chainId],
    }),
    pushClient.readContract<boolean>({
      address: universalCallback,
      abi: UNIVERSAL_CALLBACK_EVM,
      functionName: 'blockedDomains',
      args: [dest.chainNamespace, dest.chainId],
    }),
    pushClient.publicClient.getBlockNumber(),
    pushClient.getGasPrice(),
  ]);

  if (blocked) {
    throw new UnsupportedReadDestinationError('destination is on the UniversalCallback blocklist', {
      destination: dest.caip2,
    });
  }
  // Heightless namespaces (web2) legitimately read 0 and must pin blockNumber = 0.
  // For a blockchain, 0 means no chain-meta oracle is voting → the guard can never pass.
  if (dest.namespace !== READ_NAMESPACE.WEB2 && observedChainHeight === 0n) {
    throw new ReadHeightUnavailableError(dest.caip2);
  }

  return {
    destination: dest,
    protocolFee,
    observedChainHeight,
    pushBlockNumber,
    pushGasPrice,
    universalCallback,
    universalCore,
    fetchedAt: Date.now(),
  };
}
