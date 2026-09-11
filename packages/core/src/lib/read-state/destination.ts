import { READ_NAMESPACE, type ReadNamespace } from '../constants/read-state';
import { UnsupportedReadDestinationError } from './errors';
import type { ReadDestination, ResolvedDestination } from './read-state.types';

const KNOWN: ReadonlySet<string> = new Set(Object.values(READ_NAMESPACE));

/**
 * Split a destination into the pieces the contract, the oracle and the node use.
 *
 * - `ReadSpec.account.chainNamespace` / `chainId` are the two halves.
 * - `UniversalCore.chainHeightByChainNamespace` is keyed by the JOINED `caip2`.
 * - The node routes on `chainNamespace + ":" + chainId`.
 *
 * Passing the joined form as the namespace would produce `eip155:1:1` on the node,
 * so it is rejected here.
 */
export function resolveDestination(dest: ReadDestination): ResolvedDestination {
  let chainNamespace: string;
  let chainId: string;
  if ('chain' in dest) {
    const idx = dest.chain.indexOf(':');
    if (idx <= 0) {
      throw new UnsupportedReadDestinationError(`chain is not CAIP-2: ${dest.chain}`);
    }
    chainNamespace = dest.chain.slice(0, idx);
    chainId = dest.chain.slice(idx + 1);
  } else {
    chainNamespace = dest.chainNamespace;
    chainId = dest.chainId;
  }
  if (!chainNamespace || !chainId) {
    throw new UnsupportedReadDestinationError('destination needs both chainNamespace and chainId');
  }
  if (chainNamespace.includes(':')) {
    throw new UnsupportedReadDestinationError(
      `chainNamespace must be the bare namespace, not CAIP-2: ${chainNamespace}`,
      { hint: 'Pass { chainNamespace: "eip155", chainId: "1" } or { chain: CHAIN.X }.' },
    );
  }
  if (!KNOWN.has(chainNamespace)) {
    throw new UnsupportedReadDestinationError(`unsupported read namespace: ${chainNamespace}`, {
      destination: `${chainNamespace}:${chainId}`,
      hint: `Supported: ${[...KNOWN].join(', ')}`,
    });
  }
  return {
    chainNamespace,
    chainId,
    caip2: `${chainNamespace}:${chainId}`,
    namespace: chainNamespace as ReadNamespace,
  };
}
