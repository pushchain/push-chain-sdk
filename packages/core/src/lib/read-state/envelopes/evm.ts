import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  getAbiItem,
  isAddress,
  isHex,
  pad,
  size,
  toHex,
  type AbiFunction,
  type Hex,
} from 'viem';
import { READ_NAMESPACE } from '../../constants/read-state';
import { InvalidReadQueryError } from '../errors';
import type { EncodedReadQuery, EvmReadQuery, ReadResultShape } from '../read-state.types';

/** `universalClient/externalchains/evm/read_envelope.go` — evmQueryType. */
export const EVM_QUERY_TYPE = {
  ACCOUNT_BALANCE: 0,
  CONTRACT_CALL: 1,
  STORAGE_SLOT: 2,
} as const;

/** Only AT_NUMBER exists in v1. */
const EVM_BLOCK_REF_AT_NUMBER = 0;

/**
 * The validator unpacks `abi.Arguments{ ONE tuple }`. The envelope MUST therefore be
 * `abi.encode(struct)` — a single dynamic tuple with a 0x20 head offset — never the
 * fields as separate parameters. The three-parameter layout parses only by coincidence
 * when queryType == 0 and cost the first live read (2026-09-09).
 */
const EVM_ENVELOPE_ABI = [
  {
    type: 'tuple',
    components: [
      { name: 'queryType', type: 'uint8' },
      {
        name: 'blockRef',
        type: 'tuple',
        components: [
          { name: 'refType', type: 'uint8' },
          { name: 'blockNumber', type: 'uint64' },
        ],
      },
      { name: 'payload', type: 'bytes' },
    ],
  },
] as const;

const UINT64_MAX = (1n << 64n) - 1n;

function assertAddress(value: string, what: string): asserts value is Hex {
  if (!isAddress(value)) throw new InvalidReadQueryError(`${what} is not an EVM address: ${value}`);
}

function assertBlockNumber(blockNumber: bigint): void {
  if (blockNumber < 0n || blockNumber > UINT64_MAX) {
    throw new InvalidReadQueryError(`blockNumber out of uint64 range: ${blockNumber}`);
  }
}

/** Normalise a storage slot (hex or bigint) to bytes32. */
export function toStorageSlot(slot: Hex | bigint): Hex {
  if (typeof slot === 'bigint') {
    if (slot < 0n || slot >= 1n << 256n) throw new InvalidReadQueryError(`storage slot out of range: ${slot}`);
    return toHex(slot, { size: 32 });
  }
  if (!isHex(slot)) throw new InvalidReadQueryError(`storage slot is not hex: ${slot}`);
  if (size(slot) > 32) throw new InvalidReadQueryError(`storage slot longer than 32 bytes: ${slot}`);
  return pad(slot, { size: 32 });
}

function encodeEnvelope(queryType: number, blockNumber: bigint, payload: Hex): Hex {
  return encodeAbiParameters(EVM_ENVELOPE_ABI, [
    { queryType, blockRef: { refType: EVM_BLOCK_REF_AT_NUMBER, blockNumber }, payload },
  ]);
}

/**
 * Encode an `eip155` read query. Pure — `blockNumber` is the pinned destination
 * height and is also mirrored into `ReadSpec.blockNumber` by the spec builder.
 */
export function encodeEvmQueryEnvelope(query: EvmReadQuery, options: { blockNumber: bigint }): EncodedReadQuery {
  const { blockNumber } = options;
  assertBlockNumber(blockNumber);
  assertAddress(query.target, 'target');

  let queryType: number;
  let payload: Hex;
  let resultShape: ReadResultShape;

  switch (query.type) {
    case 'accountBalance': {
      queryType = EVM_QUERY_TYPE.ACCOUNT_BALANCE;
      // abi.encode(address) — 32 bytes. The raw 20-byte address is rejected by validators.
      payload = encodeAbiParameters([{ type: 'address' }], [query.target]);
      resultShape = { kind: 'uint256' };
      break;
    }
    case 'contractCall': {
      queryType = EVM_QUERY_TYPE.CONTRACT_CALL;
      let callData: Hex;
      if ('callData' in query) {
        if (!isHex(query.callData) || size(query.callData) < 4) {
          throw new InvalidReadQueryError('callData must be hex with at least a 4-byte selector');
        }
        callData = query.callData;
        resultShape = { kind: 'raw' };
      } else {
        const item = getAbiItem({
          abi: query.abi,
          name: query.functionName,
          args: query.args as never,
        }) as AbiFunction | undefined;
        if (!item || item.type !== 'function') {
          throw new InvalidReadQueryError(`function not found in abi: ${query.functionName}`);
        }
        if (item.stateMutability !== 'view' && item.stateMutability !== 'pure') {
          throw new InvalidReadQueryError(
            `${query.functionName} is ${item.stateMutability}; reads must target view/pure functions`,
          );
        }
        callData = encodeFunctionData({
          abi: query.abi,
          functionName: query.functionName,
          args: query.args as never,
        });
        resultShape = { kind: 'evmCall', abi: [item], functionName: query.functionName };
      }
      payload = encodeAbiParameters([{ type: 'address' }, { type: 'bytes' }], [query.target, callData]);
      break;
    }
    case 'storageSlot': {
      queryType = EVM_QUERY_TYPE.STORAGE_SLOT;
      payload = encodeAbiParameters(
        [{ type: 'address' }, { type: 'bytes32' }],
        [query.target, toStorageSlot(query.slot)],
      );
      resultShape = { kind: 'bytes32' };
      break;
    }
    default:
      throw new InvalidReadQueryError(`unknown EVM query type: ${(query as { type: string }).type}`);
  }

  return {
    namespace: READ_NAMESPACE.EVM,
    queryType,
    encoded: encodeEnvelope(queryType, blockNumber, payload),
    blockRef: blockNumber,
    resultShape,
    warnings: [],
  };
}

/** Decode an envelope with the exact tuple shape the validator uses. */
export function decodeEvmQueryEnvelope(encoded: Hex): {
  queryType: number;
  refType: number;
  blockNumber: bigint;
  payload: Hex;
} {
  const [env] = decodeAbiParameters(EVM_ENVELOPE_ABI, encoded);
  return {
    queryType: env.queryType,
    refType: env.blockRef.refType,
    blockNumber: env.blockRef.blockNumber,
    payload: env.payload,
  };
}
