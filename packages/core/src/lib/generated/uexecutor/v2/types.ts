// Code generated to match uexecutor/v1/types.proto with expanded OutboundTx
// This provides v2 types with full OutboundTx fields and repeated outbound_tx array
/* eslint-disable */
import { BinaryReader, BinaryWriter } from '@bufbuild/protobuf/wire';

export const protobufPackage = 'uexecutor.v2';

// Re-export enums from v1 that are unchanged
export {
  VerificationType,
  verificationTypeFromJSON,
  verificationTypeToJSON,
  UniversalTxStatus,
  universalTxStatusFromJSON,
  universalTxStatusToJSON,
} from '../v1/types';

// Import types from v1 that are unchanged
import {
  UniversalPayload,
  Inbound,
  PCTx,
  UniversalTxStatus,
} from '../v1/types';

// Re-export for convenience
export { UniversalPayload, Inbound, PCTx };

/**
 * TxType enum for outbound transaction types
 * Matches chain proto: uexecutor/v1/types.proto TxType
 */
export enum TxType {
  UNSPECIFIED_TX = 0,
  GAS = 1,
  GAS_AND_PAYLOAD = 2,
  FUNDS = 3,
  FUNDS_AND_PAYLOAD = 4,
  PAYLOAD = 5,
  INBOUND_REVERT = 6,
  UNRECOGNIZED = -1,
}

export function txTypeFromJSON(object: any): TxType {
  switch (object) {
    case 0:
    case 'UNSPECIFIED_TX':
      return TxType.UNSPECIFIED_TX;
    case 1:
    case 'GAS':
      return TxType.GAS;
    case 2:
    case 'GAS_AND_PAYLOAD':
      return TxType.GAS_AND_PAYLOAD;
    case 3:
    case 'FUNDS':
      return TxType.FUNDS;
    case 4:
    case 'FUNDS_AND_PAYLOAD':
      return TxType.FUNDS_AND_PAYLOAD;
    case 5:
    case 'PAYLOAD':
      return TxType.PAYLOAD;
    case 6:
    case 'INBOUND_REVERT':
      return TxType.INBOUND_REVERT;
    case -1:
    case 'UNRECOGNIZED':
    default:
      return TxType.UNRECOGNIZED;
  }
}

export function txTypeToJSON(object: TxType): string {
  switch (object) {
    case TxType.UNSPECIFIED_TX:
      return 'UNSPECIFIED_TX';
    case TxType.GAS:
      return 'GAS';
    case TxType.GAS_AND_PAYLOAD:
      return 'GAS_AND_PAYLOAD';
    case TxType.FUNDS:
      return 'FUNDS';
    case TxType.FUNDS_AND_PAYLOAD:
      return 'FUNDS_AND_PAYLOAD';
    case TxType.PAYLOAD:
      return 'PAYLOAD';
    case TxType.INBOUND_REVERT:
      return 'INBOUND_REVERT';
    case TxType.UNRECOGNIZED:
    default:
      return 'UNRECOGNIZED';
  }
}

/**
 * OutboundStatus enum for outbound transaction status
 */
export enum OutboundStatus {
  OUTBOUND_STATUS_UNSPECIFIED = 0,
  PENDING = 1,
  OBSERVED = 2,
  REVERTED = 3,
  UNRECOGNIZED = -1,
}

export function outboundStatusFromJSON(object: any): OutboundStatus {
  switch (object) {
    case 0:
    case 'OUTBOUND_STATUS_UNSPECIFIED':
      return OutboundStatus.OUTBOUND_STATUS_UNSPECIFIED;
    case 1:
    case 'PENDING':
      return OutboundStatus.PENDING;
    case 2:
    case 'OBSERVED':
      return OutboundStatus.OBSERVED;
    case 3:
    case 'REVERTED':
      return OutboundStatus.REVERTED;
    case -1:
    case 'UNRECOGNIZED':
    default:
      return OutboundStatus.UNRECOGNIZED;
  }
}

export function outboundStatusToJSON(object: OutboundStatus): string {
  switch (object) {
    case OutboundStatus.OUTBOUND_STATUS_UNSPECIFIED:
      return 'OUTBOUND_STATUS_UNSPECIFIED';
    case OutboundStatus.PENDING:
      return 'PENDING';
    case OutboundStatus.OBSERVED:
      return 'OBSERVED';
    case OutboundStatus.REVERTED:
      return 'REVERTED';
    case OutboundStatus.UNRECOGNIZED:
    default:
      return 'UNRECOGNIZED';
  }
}

/**
 * OriginatingPcTx - Push Chain transaction that originated the outbound
 * Matches chain proto: field 1 = tx_hash (string), field 2 = log_index (string)
 */
export interface OriginatingPcTx {
  txHash: string;
  logIndex: string;
}

/**
 * OutboundObservation - Observation of the outbound tx on destination chain
 * Matches chain proto: field 1 = success (bool), field 2 = block_height (uint64),
 *   field 3 = tx_hash (string), field 4 = error_msg (string)
 */
export interface OutboundObservation {
  success: boolean;
  blockHeight: number;
  txHash: string;
  errorMsg: string;
  /** Field 5 — actual gas fee consumed on destination chain (proto types.proto:143). */
  gasFeeUsed: string;
}

/**
 * RevertInstructions - Instructions for reverting the transaction
 * Matches chain proto: field 1 = fund_recipient (string)
 */
export interface RevertInstructions {
  fundRecipient: string;
}

/**
 * OutboundTxV2 - Expanded outbound transaction with all 15 fields
 */
export interface OutboundTxV2 {
  destinationChain: string;
  recipient: string;
  amount: string;
  externalAssetAddr: string;
  prc20AssetAddr: string;
  sender: string;
  payload: string;
  gasLimit: string;
  txType: TxType;
  pcTx?: OriginatingPcTx | undefined;
  observedTx?: OutboundObservation | undefined;
  id: string;
  outboundStatus: OutboundStatus;
  revertInstructions?: RevertInstructions | undefined;
  pcRevertExecution?: PCTx | undefined;
  /** Field 16 — gas price on destination chain at time of outbound. */
  gasPrice: string;
  /** Field 17 — gas fee paid to relayer on destination chain. */
  gasFee: string;
  /** Field 18 — PC tx that executed the gas refund, non-nil if refund ran. */
  pcRefundExecution?: PCTx | undefined;
  /** Field 19 — non-empty if swap-refund failed and we fell back to no-swap. */
  refundSwapError: string;
  /** Field 20 — gas token PRC20 address used to pay relayer fee. */
  gasToken: string;
  /** Field 21 — Human-readable reason why the outbound was aborted. */
  abortReason: string;
}

/**
 * UniversalTxV2 - Universal transaction with id field and repeated outbound_tx
 */
export interface UniversalTxV2 {
  id: string;
  inboundTx?: Inbound | undefined;
  pcTx: PCTx[];
  outboundTx: OutboundTxV2[];
  universalStatus: UniversalTxStatus;
}

// ============================================================================
// Encoder/Decoder implementations
// ============================================================================

function createBaseOriginatingPcTx(): OriginatingPcTx {
  return {
    txHash: '',
    logIndex: '',
  };
}

export const OriginatingPcTx: MessageFns<OriginatingPcTx> = {
  encode(
    message: OriginatingPcTx,
    writer: BinaryWriter = new BinaryWriter()
  ): BinaryWriter {
    if (message.txHash !== '') writer.uint32(10).string(message.txHash);
    if (message.logIndex !== '') writer.uint32(18).string(message.logIndex);
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): OriginatingPcTx {
    const reader =
      input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseOriginatingPcTx();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.txHash = reader.string();
          break;
        case 2:
          message.logIndex = reader.string();
          break;
        default:
          if ((tag & 7) === 4 || tag === 0) return message;
          reader.skip(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): OriginatingPcTx {
    return {
      txHash: isSet(object.txHash) ? globalThis.String(object.txHash) : '',
      logIndex: isSet(object.logIndex)
        ? globalThis.String(object.logIndex)
        : '',
    };
  },

  toJSON(message: OriginatingPcTx): unknown {
    const obj: any = {};
    if (message.txHash !== '') obj.txHash = message.txHash;
    if (message.logIndex !== '') obj.logIndex = message.logIndex;
    return obj;
  },

  fromPartial(object: Partial<OriginatingPcTx>): OriginatingPcTx {
    const message = createBaseOriginatingPcTx();
    message.txHash = object.txHash ?? '';
    message.logIndex = object.logIndex ?? '';
    return message;
  },
};

function createBaseOutboundObservation(): OutboundObservation {
  return {
    success: false,
    blockHeight: 0,
    txHash: '',
    errorMsg: '',
    gasFeeUsed: '',
  };
}

export const OutboundObservation: MessageFns<OutboundObservation> = {
  encode(
    message: OutboundObservation,
    writer: BinaryWriter = new BinaryWriter()
  ): BinaryWriter {
    if (message.success !== false) writer.uint32(8).bool(message.success);
    if (message.blockHeight !== 0) writer.uint32(16).uint64(message.blockHeight);
    if (message.txHash !== '') writer.uint32(26).string(message.txHash);
    if (message.errorMsg !== '') writer.uint32(34).string(message.errorMsg);
    if (message.gasFeeUsed !== '')
      writer.uint32(42).string(message.gasFeeUsed);
    return writer;
  },

  decode(
    input: BinaryReader | Uint8Array,
    length?: number
  ): OutboundObservation {
    const reader =
      input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseOutboundObservation();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.success = reader.bool();
          break;
        case 2:
          message.blockHeight = Number(reader.uint64());
          break;
        case 3:
          message.txHash = reader.string();
          break;
        case 4:
          message.errorMsg = reader.string();
          break;
        case 5:
          message.gasFeeUsed = reader.string();
          break;
        default:
          if ((tag & 7) === 4 || tag === 0) return message;
          reader.skip(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): OutboundObservation {
    return {
      success: isSet(object.success)
        ? globalThis.Boolean(object.success)
        : false,
      blockHeight: isSet(object.blockHeight)
        ? globalThis.Number(object.blockHeight)
        : 0,
      txHash: isSet(object.txHash) ? globalThis.String(object.txHash) : '',
      errorMsg: isSet(object.errorMsg)
        ? globalThis.String(object.errorMsg)
        : '',
      gasFeeUsed: isSet(object.gasFeeUsed)
        ? globalThis.String(object.gasFeeUsed)
        : '',
    };
  },

  toJSON(message: OutboundObservation): unknown {
    const obj: any = {};
    if (message.success !== false) obj.success = message.success;
    if (message.blockHeight !== 0) obj.blockHeight = message.blockHeight;
    if (message.txHash !== '') obj.txHash = message.txHash;
    if (message.errorMsg !== '') obj.errorMsg = message.errorMsg;
    if (message.gasFeeUsed !== '') obj.gasFeeUsed = message.gasFeeUsed;
    return obj;
  },

  fromPartial(object: Partial<OutboundObservation>): OutboundObservation {
    const message = createBaseOutboundObservation();
    message.success = object.success ?? false;
    message.blockHeight = object.blockHeight ?? 0;
    message.txHash = object.txHash ?? '';
    message.errorMsg = object.errorMsg ?? '';
    message.gasFeeUsed = object.gasFeeUsed ?? '';
    return message;
  },
};

function createBaseRevertInstructions(): RevertInstructions {
  return { fundRecipient: '' };
}

export const RevertInstructions: MessageFns<RevertInstructions> = {
  encode(
    message: RevertInstructions,
    writer: BinaryWriter = new BinaryWriter()
  ): BinaryWriter {
    if (message.fundRecipient !== '')
      writer.uint32(10).string(message.fundRecipient);
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): RevertInstructions {
    const reader =
      input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseRevertInstructions();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.fundRecipient = reader.string();
          break;
        default:
          if ((tag & 7) === 4 || tag === 0) return message;
          reader.skip(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): RevertInstructions {
    return {
      fundRecipient: isSet(object.fundRecipient)
        ? globalThis.String(object.fundRecipient)
        : '',
    };
  },

  toJSON(message: RevertInstructions): unknown {
    const obj: any = {};
    if (message.fundRecipient !== '') obj.fundRecipient = message.fundRecipient;
    return obj;
  },

  fromPartial(object: Partial<RevertInstructions>): RevertInstructions {
    const message = createBaseRevertInstructions();
    message.fundRecipient = object.fundRecipient ?? '';
    return message;
  },
};

function createBaseOutboundTxV2(): OutboundTxV2 {
  return {
    destinationChain: '',
    recipient: '',
    amount: '',
    externalAssetAddr: '',
    prc20AssetAddr: '',
    sender: '',
    payload: '',
    gasLimit: '',
    txType: 0,
    pcTx: undefined,
    observedTx: undefined,
    id: '',
    outboundStatus: 0,
    revertInstructions: undefined,
    pcRevertExecution: undefined,
    gasPrice: '',
    gasFee: '',
    pcRefundExecution: undefined,
    refundSwapError: '',
    gasToken: '',
    abortReason: '',
  };
}

// Import PCTx encoder from v1
import { PCTx as PCTxCodec } from '../v1/types';

export const OutboundTxV2Codec: MessageFns<OutboundTxV2> = {
  encode(
    message: OutboundTxV2,
    writer: BinaryWriter = new BinaryWriter()
  ): BinaryWriter {
    if (message.destinationChain !== '')
      writer.uint32(10).string(message.destinationChain);
    if (message.recipient !== '') writer.uint32(18).string(message.recipient);
    if (message.amount !== '') writer.uint32(26).string(message.amount);
    if (message.externalAssetAddr !== '')
      writer.uint32(34).string(message.externalAssetAddr);
    if (message.prc20AssetAddr !== '')
      writer.uint32(42).string(message.prc20AssetAddr);
    if (message.sender !== '') writer.uint32(50).string(message.sender);
    if (message.payload !== '') writer.uint32(58).string(message.payload);
    if (message.gasLimit !== '') writer.uint32(66).string(message.gasLimit);
    if (message.txType !== 0) writer.uint32(72).int32(message.txType);
    if (message.pcTx !== undefined)
      OriginatingPcTx.encode(message.pcTx, writer.uint32(82).fork()).join();
    if (message.observedTx !== undefined)
      OutboundObservation.encode(
        message.observedTx,
        writer.uint32(90).fork()
      ).join();
    if (message.id !== '') writer.uint32(98).string(message.id);
    if (message.outboundStatus !== 0)
      writer.uint32(104).int32(message.outboundStatus);
    if (message.revertInstructions !== undefined)
      RevertInstructions.encode(
        message.revertInstructions,
        writer.uint32(114).fork()
      ).join();
    if (message.pcRevertExecution !== undefined)
      PCTxCodec.encode(
        message.pcRevertExecution,
        writer.uint32(122).fork()
      ).join();
    // Tag = (field<<3) | wire_type. wire_type=2 (length-delim) for string/msg.
    if (message.gasPrice !== '')
      writer.uint32(130).string(message.gasPrice); // field 16
    if (message.gasFee !== '') writer.uint32(138).string(message.gasFee); // field 17
    if (message.pcRefundExecution !== undefined)
      PCTxCodec.encode(
        message.pcRefundExecution,
        writer.uint32(146).fork() // field 18
      ).join();
    if (message.refundSwapError !== '')
      writer.uint32(154).string(message.refundSwapError); // field 19
    if (message.gasToken !== '')
      writer.uint32(162).string(message.gasToken); // field 20
    if (message.abortReason !== '')
      writer.uint32(170).string(message.abortReason); // field 21
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): OutboundTxV2 {
    const reader =
      input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseOutboundTxV2();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.destinationChain = reader.string();
          break;
        case 2:
          message.recipient = reader.string();
          break;
        case 3:
          message.amount = reader.string();
          break;
        case 4:
          message.externalAssetAddr = reader.string();
          break;
        case 5:
          message.prc20AssetAddr = reader.string();
          break;
        case 6:
          message.sender = reader.string();
          break;
        case 7:
          message.payload = reader.string();
          break;
        case 8:
          message.gasLimit = reader.string();
          break;
        case 9:
          message.txType = reader.int32() as any;
          break;
        case 10:
          message.pcTx = OriginatingPcTx.decode(reader, reader.uint32());
          break;
        case 11:
          message.observedTx = OutboundObservation.decode(
            reader,
            reader.uint32()
          );
          break;
        case 12:
          message.id = reader.string();
          break;
        case 13:
          message.outboundStatus = reader.int32() as any;
          break;
        case 14:
          message.revertInstructions = RevertInstructions.decode(
            reader,
            reader.uint32()
          );
          break;
        case 15:
          message.pcRevertExecution = PCTxCodec.decode(reader, reader.uint32());
          break;
        case 16:
          message.gasPrice = reader.string();
          break;
        case 17:
          message.gasFee = reader.string();
          break;
        case 18:
          message.pcRefundExecution = PCTxCodec.decode(reader, reader.uint32());
          break;
        case 19:
          message.refundSwapError = reader.string();
          break;
        case 20:
          message.gasToken = reader.string();
          break;
        case 21:
          message.abortReason = reader.string();
          break;
        default:
          if ((tag & 7) === 4 || tag === 0) return message;
          reader.skip(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): OutboundTxV2 {
    return {
      destinationChain: isSet(object.destinationChain)
        ? globalThis.String(object.destinationChain)
        : '',
      recipient: isSet(object.recipient)
        ? globalThis.String(object.recipient)
        : '',
      amount: isSet(object.amount) ? globalThis.String(object.amount) : '',
      externalAssetAddr: isSet(object.externalAssetAddr)
        ? globalThis.String(object.externalAssetAddr)
        : '',
      prc20AssetAddr: isSet(object.prc20AssetAddr)
        ? globalThis.String(object.prc20AssetAddr)
        : '',
      sender: isSet(object.sender) ? globalThis.String(object.sender) : '',
      payload: isSet(object.payload) ? globalThis.String(object.payload) : '',
      gasLimit: isSet(object.gasLimit)
        ? globalThis.String(object.gasLimit)
        : '',
      txType: isSet(object.txType) ? txTypeFromJSON(object.txType) : 0,
      pcTx: isSet(object.pcTx)
        ? OriginatingPcTx.fromJSON(object.pcTx)
        : undefined,
      observedTx: isSet(object.observedTx)
        ? OutboundObservation.fromJSON(object.observedTx)
        : undefined,
      id: isSet(object.id) ? globalThis.String(object.id) : '',
      outboundStatus: isSet(object.outboundStatus)
        ? outboundStatusFromJSON(object.outboundStatus)
        : 0,
      revertInstructions: isSet(object.revertInstructions)
        ? RevertInstructions.fromJSON(object.revertInstructions)
        : undefined,
      pcRevertExecution: isSet(object.pcRevertExecution)
        ? PCTxCodec.fromJSON(object.pcRevertExecution)
        : undefined,
      gasPrice: isSet(object.gasPrice)
        ? globalThis.String(object.gasPrice)
        : '',
      gasFee: isSet(object.gasFee) ? globalThis.String(object.gasFee) : '',
      pcRefundExecution: isSet(object.pcRefundExecution)
        ? PCTxCodec.fromJSON(object.pcRefundExecution)
        : undefined,
      refundSwapError: isSet(object.refundSwapError)
        ? globalThis.String(object.refundSwapError)
        : '',
      gasToken: isSet(object.gasToken)
        ? globalThis.String(object.gasToken)
        : '',
      abortReason: isSet(object.abortReason)
        ? globalThis.String(object.abortReason)
        : '',
    };
  },

  toJSON(message: OutboundTxV2): unknown {
    const obj: any = {};
    if (message.destinationChain !== '')
      obj.destinationChain = message.destinationChain;
    if (message.recipient !== '') obj.recipient = message.recipient;
    if (message.amount !== '') obj.amount = message.amount;
    if (message.externalAssetAddr !== '')
      obj.externalAssetAddr = message.externalAssetAddr;
    if (message.prc20AssetAddr !== '')
      obj.prc20AssetAddr = message.prc20AssetAddr;
    if (message.sender !== '') obj.sender = message.sender;
    if (message.payload !== '') obj.payload = message.payload;
    if (message.gasLimit !== '') obj.gasLimit = message.gasLimit;
    if (message.txType !== 0) obj.txType = txTypeToJSON(message.txType);
    if (message.pcTx !== undefined)
      obj.pcTx = OriginatingPcTx.toJSON(message.pcTx);
    if (message.observedTx !== undefined)
      obj.observedTx = OutboundObservation.toJSON(message.observedTx);
    if (message.id !== '') obj.id = message.id;
    if (message.outboundStatus !== 0)
      obj.outboundStatus = outboundStatusToJSON(message.outboundStatus);
    if (message.revertInstructions !== undefined)
      obj.revertInstructions = RevertInstructions.toJSON(
        message.revertInstructions
      );
    if (message.pcRevertExecution !== undefined)
      obj.pcRevertExecution = PCTxCodec.toJSON(message.pcRevertExecution);
    if (message.gasPrice !== '') obj.gasPrice = message.gasPrice;
    if (message.gasFee !== '') obj.gasFee = message.gasFee;
    if (message.pcRefundExecution !== undefined)
      obj.pcRefundExecution = PCTxCodec.toJSON(message.pcRefundExecution);
    if (message.refundSwapError !== '')
      obj.refundSwapError = message.refundSwapError;
    if (message.gasToken !== '') obj.gasToken = message.gasToken;
    if (message.abortReason !== '') obj.abortReason = message.abortReason;
    return obj;
  },

  fromPartial(object: Partial<OutboundTxV2>): OutboundTxV2 {
    const message = createBaseOutboundTxV2();
    message.destinationChain = object.destinationChain ?? '';
    message.recipient = object.recipient ?? '';
    message.amount = object.amount ?? '';
    message.externalAssetAddr = object.externalAssetAddr ?? '';
    message.prc20AssetAddr = object.prc20AssetAddr ?? '';
    message.sender = object.sender ?? '';
    message.payload = object.payload ?? '';
    message.gasLimit = object.gasLimit ?? '';
    message.txType = object.txType ?? 0;
    message.pcTx =
      object.pcTx !== undefined && object.pcTx !== null
        ? OriginatingPcTx.fromPartial(object.pcTx)
        : undefined;
    message.observedTx =
      object.observedTx !== undefined && object.observedTx !== null
        ? OutboundObservation.fromPartial(object.observedTx)
        : undefined;
    message.id = object.id ?? '';
    message.outboundStatus = object.outboundStatus ?? 0;
    message.revertInstructions =
      object.revertInstructions !== undefined &&
      object.revertInstructions !== null
        ? RevertInstructions.fromPartial(object.revertInstructions)
        : undefined;
    message.pcRevertExecution =
      object.pcRevertExecution !== undefined &&
      object.pcRevertExecution !== null
        ? PCTxCodec.fromPartial(object.pcRevertExecution)
        : undefined;
    message.gasPrice = object.gasPrice ?? '';
    message.gasFee = object.gasFee ?? '';
    message.pcRefundExecution =
      object.pcRefundExecution !== undefined &&
      object.pcRefundExecution !== null
        ? PCTxCodec.fromPartial(object.pcRefundExecution)
        : undefined;
    message.refundSwapError = object.refundSwapError ?? '';
    message.gasToken = object.gasToken ?? '';
    message.abortReason = object.abortReason ?? '';
    return message;
  },
};

// Import Inbound encoder from v1
import { Inbound as InboundCodec } from '../v1/types';

function createBaseUniversalTxV2(): UniversalTxV2 {
  return {
    id: '',
    inboundTx: undefined,
    pcTx: [],
    outboundTx: [],
    universalStatus: 0,
  };
}

export const UniversalTxV2Codec: MessageFns<UniversalTxV2> = {
  encode(
    message: UniversalTxV2,
    writer: BinaryWriter = new BinaryWriter()
  ): BinaryWriter {
    if (message.id !== '') writer.uint32(10).string(message.id);
    if (message.inboundTx !== undefined)
      InboundCodec.encode(message.inboundTx, writer.uint32(18).fork()).join();
    for (const v of message.pcTx) {
      PCTxCodec.encode(v!, writer.uint32(26).fork()).join();
    }
    for (const v of message.outboundTx) {
      OutboundTxV2Codec.encode(v!, writer.uint32(34).fork()).join();
    }
    if (message.universalStatus !== 0)
      writer.uint32(40).int32(message.universalStatus);
    return writer;
  },

  decode(input: BinaryReader | Uint8Array, length?: number): UniversalTxV2 {
    const reader =
      input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseUniversalTxV2();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.id = reader.string();
          break;
        case 2:
          message.inboundTx = InboundCodec.decode(reader, reader.uint32());
          break;
        case 3:
          message.pcTx.push(PCTxCodec.decode(reader, reader.uint32()));
          break;
        case 4:
          message.outboundTx.push(
            OutboundTxV2Codec.decode(reader, reader.uint32())
          );
          break;
        case 5:
          message.universalStatus = reader.int32() as any;
          break;
        default:
          if ((tag & 7) === 4 || tag === 0) return message;
          reader.skip(tag & 7);
          break;
      }
    }
    return message;
  },

  fromJSON(object: any): UniversalTxV2 {
    return {
      id: isSet(object.id) ? globalThis.String(object.id) : '',
      inboundTx: isSet(object.inboundTx)
        ? InboundCodec.fromJSON(object.inboundTx)
        : undefined,
      pcTx: globalThis.Array.isArray(object?.pcTx)
        ? object.pcTx.map((e: any) => PCTxCodec.fromJSON(e))
        : [],
      outboundTx: globalThis.Array.isArray(object?.outboundTx)
        ? object.outboundTx.map((e: any) => OutboundTxV2Codec.fromJSON(e))
        : [],
      universalStatus: isSet(object.universalStatus)
        ? (object.universalStatus as UniversalTxStatus)
        : 0,
    };
  },

  toJSON(message: UniversalTxV2): unknown {
    const obj: any = {};
    if (message.id !== '') obj.id = message.id;
    if (message.inboundTx !== undefined)
      obj.inboundTx = InboundCodec.toJSON(message.inboundTx);
    if (message.pcTx?.length)
      obj.pcTx = message.pcTx.map((e) => PCTxCodec.toJSON(e));
    if (message.outboundTx?.length)
      obj.outboundTx = message.outboundTx.map((e) =>
        OutboundTxV2Codec.toJSON(e)
      );
    if (message.universalStatus !== 0)
      obj.universalStatus = message.universalStatus;
    return obj;
  },

  fromPartial(object: Partial<UniversalTxV2>): UniversalTxV2 {
    const message = createBaseUniversalTxV2();
    message.id = object.id ?? '';
    message.inboundTx =
      object.inboundTx !== undefined && object.inboundTx !== null
        ? InboundCodec.fromPartial(object.inboundTx)
        : undefined;
    message.pcTx = object.pcTx?.map((e) => PCTxCodec.fromPartial(e)) || [];
    message.outboundTx =
      object.outboundTx?.map((e) => OutboundTxV2Codec.fromPartial(e)) || [];
    message.universalStatus = object.universalStatus ?? 0;
    return message;
  },
};

// Helper types
function isSet(value: any): boolean {
  return value !== null && value !== undefined;
}

export interface MessageFns<T> {
  encode(message: T, writer?: BinaryWriter): BinaryWriter;
  decode(input: BinaryReader | Uint8Array, length?: number): T;
  fromJSON(object: any): T;
  toJSON(message: T): unknown;
  fromPartial(object: Partial<T>): T;
}
