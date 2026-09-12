// Minimal generated types for uexecutor.v1 Query service
// Hand-authored to avoid requiring protoc at build time in this repo
/* eslint-disable */
import { BinaryReader, BinaryWriter } from '@bufbuild/protobuf/wire';
import type { UniversalTx as UniversalTxMsg } from './types';
import { UniversalTx as UniversalTxCodec } from './types';

export const protobufPackage = 'uexecutor.v1';

export interface UexecutorParams {
  someValue: boolean;
  maxGaslessTxGas: bigint;
}

export interface QueryParamsRequest {}

export interface QueryParamsResponse {
  params?: UexecutorParams | undefined;
}

export interface QueryGetUniversalTxRequest {
  id: string;
}

export interface QueryGetUniversalTxResponse {
  universalTx?: UniversalTxMsg | undefined;
}

function createBaseUexecutorParams(): UexecutorParams {
  return { someValue: false, maxGaslessTxGas: BigInt(0) };
}

export const UexecutorParams = {
  encode(
    message: UexecutorParams,
    writer: BinaryWriter = new BinaryWriter()
  ): BinaryWriter {
    if (message.someValue === true) writer.uint32(16).bool(message.someValue);
    if (message.maxGaslessTxGas !== BigInt(0)) {
      writer.uint32(24).uint64(message.maxGaslessTxGas);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): UexecutorParams {
    const reader =
      input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseUexecutorParams();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 2:
          message.someValue = reader.bool();
          break;
        case 3:
          message.maxGaslessTxGas = BigInt(reader.uint64().toString());
          break;
        default:
          if ((tag & 7) === 4 || tag === 0) return message;
          reader.skip(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: {
    someValue?: boolean;
    maxGaslessTxGas?: bigint;
  }): UexecutorParams {
    return {
      someValue: object.someValue ?? false,
      maxGaslessTxGas: object.maxGaslessTxGas ?? BigInt(0),
    };
  },
};

export const QueryParamsRequest = {
  encode(
    _message: QueryParamsRequest,
    writer: BinaryWriter = new BinaryWriter()
  ): BinaryWriter {
    return writer;
  },
  decode(
    input: BinaryReader | Uint8Array,
    length?: number
  ): QueryParamsRequest {
    const reader =
      input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    while (reader.pos < end) {
      const tag = reader.uint32();
      if ((tag & 7) === 4 || tag === 0) return {};
      reader.skip(tag & 7);
    }
    return {};
  },
  fromPartial(_object: Record<string, never>): QueryParamsRequest {
    return {};
  },
};

function createBaseQueryParamsResponse(): QueryParamsResponse {
  return { params: undefined };
}

export const QueryParamsResponse = {
  encode(
    message: QueryParamsResponse,
    writer: BinaryWriter = new BinaryWriter()
  ): BinaryWriter {
    if (message.params !== undefined) {
      UexecutorParams.encode(message.params, writer.uint32(10).fork()).join();
    }
    return writer;
  },
  decode(
    input: BinaryReader | Uint8Array,
    length?: number
  ): QueryParamsResponse {
    const reader =
      input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseQueryParamsResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.params = UexecutorParams.decode(reader, reader.uint32());
          break;
        default:
          if ((tag & 7) === 4 || tag === 0) return message;
          reader.skip(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: {
    params?: Partial<UexecutorParams>;
  }): QueryParamsResponse {
    return {
      params:
        object.params === undefined
          ? undefined
          : UexecutorParams.fromPartial(object.params),
    };
  },
};

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
