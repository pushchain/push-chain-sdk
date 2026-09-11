import { READ_NAMESPACE } from '../../constants/read-state';
import { resolveDestination } from '../destination';
import { InvalidReadQueryError, UnsupportedReadDestinationError } from '../errors';
import type { EncodedReadQuery, ReadDestination, ReadQuery } from '../read-state.types';
import { encodeEvmQueryEnvelope } from './evm';
import { encodeSvmQueryEnvelope } from './svm';
import { encodeWeb2QueryEnvelope } from './web2';

export * from './evm';
export * from './svm';
export * from './web2';

const EVM_TYPES: ReadonlySet<string> = new Set(['accountBalance', 'contractCall', 'storageSlot']);
const SVM_TYPES: ReadonlySet<string> = new Set(['lamportBalance', 'splTokenAccount', 'rawAccountData']);

/**
 * Encode any read query for its destination. Rejects a query kind that does not
 * belong to the destination's namespace (e.g. a `storageSlot` read against Solana).
 */
export function encodeReadQuery(
  destination: ReadDestination,
  query: ReadQuery,
  options: { blockNumber?: bigint; minSlot?: bigint } = {},
): EncodedReadQuery {
  const dest = resolveDestination(destination);
  switch (dest.namespace) {
    case READ_NAMESPACE.EVM: {
      if (!EVM_TYPES.has(query.type)) throw new InvalidReadQueryError(`query type ${query.type} is not valid for ${dest.caip2}`);
      if (options.blockNumber === undefined) {
        throw new InvalidReadQueryError('EVM reads need options.blockNumber (the pinned destination height)');
      }
      return encodeEvmQueryEnvelope(query as never, { blockNumber: options.blockNumber });
    }
    case READ_NAMESPACE.SVM: {
      if (!SVM_TYPES.has(query.type)) throw new InvalidReadQueryError(`query type ${query.type} is not valid for ${dest.caip2}`);
      return encodeSvmQueryEnvelope(query as never, { minSlot: options.minSlot });
    }
    case READ_NAMESPACE.WEB2: {
      if (query.type !== 'http') throw new InvalidReadQueryError(`query type ${query.type} is not valid for web2`);
      return encodeWeb2QueryEnvelope(query);
    }
    default:
      throw new UnsupportedReadDestinationError(`unsupported namespace: ${dest.namespace}`);
  }
}
