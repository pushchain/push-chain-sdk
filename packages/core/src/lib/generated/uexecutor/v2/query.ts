// V2 query types for uexecutor.v2.Query service
// Uses UniversalTxV2 with expanded OutboundTx fields
/* eslint-disable */
import { BinaryReader, BinaryWriter } from '@bufbuild/protobuf/wire';
import type { UniversalTxV2 as UniversalTxMsg } from './types';
import { UniversalTxV2Codec } from './types';

export const protobufPackage = 'uexecutor.v2';

export interface QueryGetUniversalTxRequestV2 {
  id: string;
}

export interface QueryGetUniversalTxResponseV2 {
  universalTx?: UniversalTxMsg | undefined;
}

function createBaseQueryGetUniversalTxRequestV2(): QueryGetUniversalTxRequestV2 {
  return { id: '' };
}

export const QueryGetUniversalTxRequestV2 = {
  encode(
    message: QueryGetUniversalTxRequestV2,
    writer: BinaryWriter = new BinaryWriter()
  ): BinaryWriter {
    if (message.id !== '') writer.uint32(10).string(message.id);
    return writer;
  },

  decode(
    input: BinaryReader | Uint8Array,
    length?: number
  ): QueryGetUniversalTxRequestV2 {
    const reader =
      input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryGetUniversalTxRequestV2();
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

  fromPartial(object: { id?: string }): QueryGetUniversalTxRequestV2 {
    return { id: object.id ?? '' };
  },
};

function createBaseQueryGetUniversalTxResponseV2(): QueryGetUniversalTxResponseV2 {
  return { universalTx: undefined };
}

export const QueryGetUniversalTxResponseV2 = {
  encode(
    message: QueryGetUniversalTxResponseV2,
    writer: BinaryWriter = new BinaryWriter()
  ): BinaryWriter {
    if (message.universalTx !== undefined) {
      UniversalTxV2Codec.encode(
        message.universalTx,
        writer.uint32(10).fork()
      ).join();
    }
    return writer;
  },

  decode(
    input: BinaryReader | Uint8Array,
    length?: number
  ): QueryGetUniversalTxResponseV2 {
    const reader =
      input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryGetUniversalTxResponseV2();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.universalTx = UniversalTxV2Codec.decode(
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
  }): QueryGetUniversalTxResponseV2 {
    return { universalTx: object.universalTx ?? undefined };
  },
};
