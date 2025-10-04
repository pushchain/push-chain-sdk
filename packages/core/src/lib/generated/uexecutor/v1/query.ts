// Minimal generated types for uexecutor.v1 Query service
// Hand-authored to avoid requiring protoc at build time in this repo
/* eslint-disable */
import { BinaryReader, BinaryWriter } from '@bufbuild/protobuf/wire';
import type { UniversalTx as UniversalTxMsg } from './types';
import { UniversalTx as UniversalTxCodec } from './types';

export const protobufPackage = 'uexecutor.v1';

export interface QueryGetUniversalTxRequest {
  id: string;
}

export interface QueryGetUniversalTxResponse {
  universalTx?: UniversalTxMsg | undefined;
}

function createBaseQueryGetUniversalTxRequest(): QueryGetUniversalTxRequest {
  return { id: '' };
}

export const QueryGetUniversalTxRequest = {
  encode(
    message: QueryGetUniversalTxRequest,
    writer: BinaryWriter = new BinaryWriter()
  ): BinaryWriter {
    if (message.id !== '') writer.uint32(10).string(message.id);
    return writer;
  },
  decode(
    input: BinaryReader | Uint8Array,
    length?: number
  ): QueryGetUniversalTxRequest {
    const reader =
      input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryGetUniversalTxRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.id = reader.string();
          break;
        default:
          if ((tag & 7) === 4 || tag === 0) {
            return message;
          }
          reader.skip(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: { id?: string }): QueryGetUniversalTxRequest {
    return { id: object.id ?? '' };
  },
};

function createBaseQueryGetUniversalTxResponse(): QueryGetUniversalTxResponse {
  return { universalTx: undefined };
}

export const QueryGetUniversalTxResponse = {
  encode(
    message: QueryGetUniversalTxResponse,
    writer: BinaryWriter = new BinaryWriter()
  ): BinaryWriter {
    if (message.universalTx !== undefined) {
      UniversalTxCodec.encode(
        message.universalTx,
        writer.uint32(10).fork()
      ).join();
    }
    return writer;
  },
  decode(
    input: BinaryReader | Uint8Array,
    length?: number
  ): QueryGetUniversalTxResponse {
    const reader =
      input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryGetUniversalTxResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.universalTx = UniversalTxCodec.decode(
            reader,
            reader.uint32()
          );
          break;
        default:
          if ((tag & 7) === 4 || tag === 0) {
            return message;
          }
          reader.skip(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: {
    universalTx?: UniversalTxMsg;
  }): QueryGetUniversalTxResponse {
    return { universalTx: object.universalTx ?? undefined };
  },
};
