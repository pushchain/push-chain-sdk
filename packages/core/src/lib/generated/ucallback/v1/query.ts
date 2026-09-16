// Minimal generated types for ucallback.v1 Query service
// Hand-authored to avoid requiring protoc at build time in this repo.
// DO NOT run `yarn build:proto` (see types.ts).
//
// Only the two RPCs the SDK uses. AllPendingReadRequests / AllAbortedReadRequests /
// Params need cosmos pagination types that are not vendored here.
/* eslint-disable */
import { BinaryReader, BinaryWriter } from '@bufbuild/protobuf/wire';
import { UniversalRead } from './types';

/** Service name for createProtobufRpcClient(...).request(SERVICE, method, bytes). */
export const UCALLBACK_QUERY_SERVICE = 'ucallback.v1.Query';

export interface QueryUniversalReadRequest {
  /** uint256 requestId as 0x-prefixed hex */
  requestId: string;
}
export interface QueryUniversalReadResponse {
  read: UniversalRead | undefined;
}
export interface QueryReadsByTxRequest {
  /** Push tx hash, 0x-prefixed lowercase */
  txHash: string;
}
export interface QueryReadsByTxResponse {
  /** every read the tx requested, in request-id order */
  reads: UniversalRead[];
}

export const QueryUniversalReadRequest = {
  encode(message: QueryUniversalReadRequest, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.requestId !== '') writer.uint32(10).string(message.requestId);
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryUniversalReadRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: QueryUniversalReadRequest = { requestId: '' };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.requestId = reader.string(); break;
        default:
          if ((tag & 7) === 4 || tag === 0) return message;
          reader.skip(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: { requestId?: string }): QueryUniversalReadRequest {
    return { requestId: object.requestId ?? '' };
  },
};

export const QueryUniversalReadResponse = {
  encode(message: QueryUniversalReadResponse, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.read !== undefined) UniversalRead.encode(message.read, writer.uint32(10).fork()).join();
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryUniversalReadResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: QueryUniversalReadResponse = { read: undefined };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.read = UniversalRead.decode(reader, reader.uint32()); break;
        default:
          if ((tag & 7) === 4 || tag === 0) return message;
          reader.skip(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: { read?: UniversalRead }): QueryUniversalReadResponse {
    return { read: object.read };
  },
};

export const QueryReadsByTxRequest = {
  encode(message: QueryReadsByTxRequest, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    if (message.txHash !== '') writer.uint32(10).string(message.txHash);
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryReadsByTxRequest {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: QueryReadsByTxRequest = { txHash: '' };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.txHash = reader.string(); break;
        default:
          if ((tag & 7) === 4 || tag === 0) return message;
          reader.skip(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: { txHash?: string }): QueryReadsByTxRequest {
    return { txHash: object.txHash ?? '' };
  },
};

export const QueryReadsByTxResponse = {
  encode(message: QueryReadsByTxResponse, writer: BinaryWriter = new BinaryWriter()): BinaryWriter {
    for (const v of message.reads) UniversalRead.encode(v, writer.uint32(10).fork()).join();
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): QueryReadsByTxResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: QueryReadsByTxResponse = { reads: [] };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: message.reads.push(UniversalRead.decode(reader, reader.uint32())); break;
        default:
          if ((tag & 7) === 4 || tag === 0) return message;
          reader.skip(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: { reads?: UniversalRead[] }): QueryReadsByTxResponse {
    return { reads: object.reads ?? [] };
  },
};
