// Minimal generated types for ucallback.v1
// Hand-authored to avoid requiring protoc at build time in this repo.
// DO NOT run `yarn build:proto` — scripts/protoc-generate.sh removes src/lib/generated
// wholesale and cannot regenerate this file.
//
// Mirrors push-chain/proto/ucallback/v1/types.proto (develop, 2026-09-09). Field
// numbers are load-bearing; verified against real Donut responses in
// read-state/__tests__/ucallback-codec.spec.ts.
/* eslint-disable */
import { BinaryReader, BinaryWriter } from '@bufbuild/protobuf/wire';
import { PCTx } from '../../uexecutor/v1/types';

export { PCTx };

export const protobufPackage = 'ucallback.v1';

export interface MessageFns<T> {
  encode(message: T, writer?: BinaryWriter): BinaryWriter;
  decode(input: BinaryReader | Uint8Array, length?: number): T;
  fromPartial(object: Partial<T>): T;
}

/** Deterministic reason a read produced an ERROR observation. */
export enum ReadErrorCode {
  READ_ERROR_UNSPECIFIED = 0,
  READ_ERROR_INVALID_QUERY = 1,
  READ_ERROR_UNSUPPORTED = 2,
  READ_ERROR_REVERTED = 3,
  READ_ERROR_NOT_FOUND = 4,
  READ_ERROR_INVALID_RESULT = 5,
  READ_ERROR_REJECTED = 6,
  UNRECOGNIZED = -1,
}

/** Outcome a universal validator observed for a read. */
export enum ReadStatus {
  READ_STATUS_UNSPECIFIED = 0,
  READ_STATUS_SUCCESS = 1,
  READ_STATUS_ERROR = 2,
  UNRECOGNIZED = -1,
}

/** Lifecycle state of a read request on Push Chain. */
export enum UniversalReadStatus {
  UNIVERSAL_READ_STATUS_UNSPECIFIED = 0,
  /** ingested, awaiting votes */
  UNIVERSAL_READ_STATUS_PENDING = 1,
  /** at least one vote, no quorum yet */
  UNIVERSAL_READ_STATUS_VOTING = 2,
  /** fulfil tx succeeded — does NOT imply the app callback ran */
  UNIVERSAL_READ_STATUS_FULFILLED = 3,
  /** expireExternalRead accepted by the contract */
  UNIVERSAL_READ_STATUS_EXPIRED = 4,
  /** contract had already settled the request another way */
  UNIVERSAL_READ_STATUS_FAILED = 5,
  /** gave up after MaxExpiryAttempts; needs manual intervention */
  UNIVERSAL_READ_STATUS_ABORTED = 6,
  UNRECOGNIZED = -1,
}

export interface ReadRequest {
  /** uint256 requestId as 0x-prefixed hex */
  requestId: string;
  /** CAIP-2, e.g. "eip155:1"; web2 uses "web2:https" */
  destinationChain: string;
  /** 20-byte address or 32-byte pubkey */
  owner: Uint8Array;
  /** chain-specific envelope, abi.encode(tuple) */
  query: Uint8Array;
  minConfirmations: number;
  destinationBlockHeight: number;
  expiryBlockHeight: number;
  createdAtHeight: number;
  callbackTarget: string;
  originalFunder: string;
  /** uint256 decimal string */
  feesDeposited: string;
  /** uint256 decimal string */
  maxFee: string;
  requestedTxHash: string;
  requestedLogIndex: number;
  /** uint256 decimal string */
  protocolFee: string;
  /** uint256 decimal string */
  callbackBudget: string;
  callbackGasLimit: number;
  revertRecipient: string;
}

export interface AggregateValue {
  extractIndex: number;
  mode: number;
  value: Uint8Array;
}

export interface ReadResult {
  status: ReadStatus;
  /** ABI-encoded payload delivered to the app; empty on ERROR */
  resultData: Uint8Array;
  /** v2 only — always empty in v1 */
  aggregates: AggregateValue[];
  errorCode: ReadErrorCode;
}

export interface UniversalRead {
  id: string;
  request: ReadRequest | undefined;
  result: ReadResult | undefined;
  status: UniversalReadStatus;
  ballotKey: string;
  pcTx: PCTx[];
  errorMsg: string;
  expiryAttempts: number;
}

function createBaseReadRequest(): ReadRequest {
  return {
    requestId: '',
    destinationChain: '',
    owner: new Uint8Array(0),
    query: new Uint8Array(0),
    minConfirmations: 0,
    destinationBlockHeight: 0,
    expiryBlockHeight: 0,
    createdAtHeight: 0,
    callbackTarget: '',
    originalFunder: '',
    feesDeposited: '',
    maxFee: '',
    requestedTxHash: '',
    requestedLogIndex: 0,
    protocolFee: '',
    callbackBudget: '',
    callbackGasLimit: 0,
    revertRecipient: '',
  };
}

export const ReadRequest: MessageFns<ReadRequest> = {
  encode(message: ReadRequest, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.requestId !== '') writer.uint32(10).string(message.requestId);
    if (message.destinationChain !== '') writer.uint32(18).string(message.destinationChain);
    if (message.owner.length !== 0) writer.uint32(26).bytes(message.owner);
    if (message.query.length !== 0) writer.uint32(34).bytes(message.query);
    if (message.minConfirmations !== 0) writer.uint32(40).uint32(message.minConfirmations);
    if (message.destinationBlockHeight !== 0) writer.uint32(48).uint64(message.destinationBlockHeight);
    if (message.expiryBlockHeight !== 0) writer.uint32(56).uint64(message.expiryBlockHeight);
    if (message.createdAtHeight !== 0) writer.uint32(64).uint64(message.createdAtHeight);
    if (message.callbackTarget !== '') writer.uint32(74).string(message.callbackTarget);
    if (message.originalFunder !== '') writer.uint32(82).string(message.originalFunder);
    if (message.feesDeposited !== '') writer.uint32(90).string(message.feesDeposited);
    if (message.maxFee !== '') writer.uint32(98).string(message.maxFee);
    if (message.requestedTxHash !== '') writer.uint32(106).string(message.requestedTxHash);
    if (message.requestedLogIndex !== 0) writer.uint32(112).uint64(message.requestedLogIndex);
    if (message.protocolFee !== '') writer.uint32(122).string(message.protocolFee);
    if (message.callbackBudget !== '') writer.uint32(130).string(message.callbackBudget);
    if (message.callbackGasLimit !== 0) writer.uint32(136).uint64(message.callbackGasLimit);
    if (message.revertRecipient !== '') writer.uint32(146).string(message.revertRecipient);
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): ReadRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseReadRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.requestId = reader.string(); break;
        case 2: message.destinationChain = reader.string(); break;
        case 3: message.owner = reader.bytes(); break;
        case 4: message.query = reader.bytes(); break;
        case 5: message.minConfirmations = reader.uint32(); break;
        case 6: message.destinationBlockHeight = longToNumber(reader.uint64()); break;
        case 7: message.expiryBlockHeight = longToNumber(reader.uint64()); break;
        case 8: message.createdAtHeight = longToNumber(reader.uint64()); break;
        case 9: message.callbackTarget = reader.string(); break;
        case 10: message.originalFunder = reader.string(); break;
        case 11: message.feesDeposited = reader.string(); break;
        case 12: message.maxFee = reader.string(); break;
        case 13: message.requestedTxHash = reader.string(); break;
        case 14: message.requestedLogIndex = longToNumber(reader.uint64()); break;
        case 15: message.protocolFee = reader.string(); break;
        case 16: message.callbackBudget = reader.string(); break;
        case 17: message.callbackGasLimit = longToNumber(reader.uint64()); break;
        case 18: message.revertRecipient = reader.string(); break;
        default:
          if ((tag & 7) === 4 || tag === 0) return message;
          reader.skip(tag & 7);
          break;
      }
    }
    return message;
  },

  fromPartial(object: Partial<ReadRequest>): ReadRequest {
    return { ...createBaseReadRequest(), ...object };
  },
};

function createBaseAggregateValue(): AggregateValue {
  return { extractIndex: 0, mode: 0, value: new Uint8Array(0) };
}

export const AggregateValue: MessageFns<AggregateValue> = {
  encode(message: AggregateValue, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.extractIndex !== 0) writer.uint32(8).uint32(message.extractIndex);
    if (message.mode !== 0) writer.uint32(16).uint32(message.mode);
    if (message.value.length !== 0) writer.uint32(26).bytes(message.value);
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): AggregateValue {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseAggregateValue();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.extractIndex = reader.uint32(); break;
        case 2: message.mode = reader.uint32(); break;
        case 3: message.value = reader.bytes(); break;
        default:
          if ((tag & 7) === 4 || tag === 0) return message;
          reader.skip(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: Partial<AggregateValue>): AggregateValue {
    return { ...createBaseAggregateValue(), ...object };
  },
};

function createBaseReadResult(): ReadResult {
  return { status: 0, resultData: new Uint8Array(0), aggregates: [], errorCode: 0 };
}

export const ReadResult: MessageFns<ReadResult> = {
  encode(message: ReadResult, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.status !== 0) writer.uint32(8).int32(message.status);
    if (message.resultData.length !== 0) writer.uint32(18).bytes(message.resultData);
    for (const v of message.aggregates) AggregateValue.encode(v, writer.uint32(42).fork()).join();
    if (message.errorCode !== 0) writer.uint32(48).int32(message.errorCode);
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): ReadResult {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseReadResult();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.status = reader.int32() as ReadStatus; break;
        case 2: message.resultData = reader.bytes(); break;
        case 5: message.aggregates.push(AggregateValue.decode(reader, reader.uint32())); break;
        case 6: message.errorCode = reader.int32() as ReadErrorCode; break;
        default:
          if ((tag & 7) === 4 || tag === 0) return message;
          reader.skip(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: Partial<ReadResult>): ReadResult {
    return { ...createBaseReadResult(), ...object, aggregates: object.aggregates ?? [] };
  },
};

function createBaseUniversalRead(): UniversalRead {
  return {
    id: '',
    request: undefined,
    result: undefined,
    status: 0,
    ballotKey: '',
    pcTx: [],
    errorMsg: '',
    expiryAttempts: 0,
  };
}

export const UniversalRead: MessageFns<UniversalRead> = {
  encode(message: UniversalRead, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.id !== '') writer.uint32(10).string(message.id);
    if (message.request !== undefined) ReadRequest.encode(message.request, writer.uint32(18).fork()).join();
    if (message.result !== undefined) ReadResult.encode(message.result, writer.uint32(26).fork()).join();
    if (message.status !== 0) writer.uint32(32).int32(message.status);
    if (message.ballotKey !== '') writer.uint32(42).string(message.ballotKey);
    for (const v of message.pcTx) PCTx.encode(v, writer.uint32(50).fork()).join();
    if (message.errorMsg !== '') writer.uint32(58).string(message.errorMsg);
    if (message.expiryAttempts !== 0) writer.uint32(64).uint32(message.expiryAttempts);
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): UniversalRead {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseUniversalRead();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.id = reader.string(); break;
        case 2: message.request = ReadRequest.decode(reader, reader.uint32()); break;
        case 3: message.result = ReadResult.decode(reader, reader.uint32()); break;
        case 4: message.status = reader.int32() as UniversalReadStatus; break;
        case 5: message.ballotKey = reader.string(); break;
        case 6: message.pcTx.push(PCTx.decode(reader, reader.uint32())); break;
        case 7: message.errorMsg = reader.string(); break;
        case 8: message.expiryAttempts = reader.uint32(); break;
        default:
          if ((tag & 7) === 4 || tag === 0) return message;
          reader.skip(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: Partial<UniversalRead>): UniversalRead {
    return { ...createBaseUniversalRead(), ...object, pcTx: object.pcTx ?? [] };
  },
};

function longToNumber(int64: { toString(): string }): number {
  const num = globalThis.Number(int64.toString());
  if (num > globalThis.Number.MAX_SAFE_INTEGER) {
    throw new globalThis.Error('Value is larger than Number.MAX_SAFE_INTEGER');
  }
  if (num < globalThis.Number.MIN_SAFE_INTEGER) {
    throw new globalThis.Error('Value is smaller than Number.MIN_SAFE_INTEGER');
  }
  return num;
}
