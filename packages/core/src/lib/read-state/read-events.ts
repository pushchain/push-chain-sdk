import { decodeEventLog, getAbiItem, toEventSelector, type AbiEvent, type Address, type Hex } from 'viem';
import { UNIVERSAL_CALLBACK_EVM } from '../constants/abi/universalCallback.evm';
import type { FulfilOutcome, ParsedReadRequest, ReceiptLike } from './read-state.types';

type UcEventName = Extract<(typeof UNIVERSAL_CALLBACK_EVM)[number], { type: 'event' }>['name'];

function eventItem(name: UcEventName): AbiEvent {
  return getAbiItem({ abi: UNIVERSAL_CALLBACK_EVM, name }) as unknown as AbiEvent;
}

export const READ_REQUESTED_EVENT = eventItem('ReadRequested');
export const READ_REQUESTED_TOPIC0: Hex = toEventSelector(READ_REQUESTED_EVENT);
export const READ_FULFILLED_TOPIC0: Hex = toEventSelector(eventItem('ReadFulfilled'));
export const CALLBACK_FAILED_TOPIC0: Hex = toEventSelector(eventItem('CallbackFailed'));
export const CALLBACK_GAS_REPORTED_TOPIC0: Hex = toEventSelector(eventItem('CallbackGasReported'));
export const REFUND_SENT_TOPIC0: Hex = toEventSelector(eventItem('RefundSent'));
export const REFUND_FAILED_TOPIC0: Hex = toEventSelector(eventItem('RefundFailed'));
export const REQUEST_EXPIRED_TOPIC0: Hex = toEventSelector(eventItem('RequestExpired'));

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function toLogIndex(v: number | string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  return typeof v === 'number' ? v : Number(BigInt(v));
}

function isTopics(t: readonly string[]): t is [Hex, ...Hex[]] {
  return t.length > 0;
}

/**
 * Every read a transaction requested, in log order.
 *
 * Filters on BOTH the contract address and topic0. The address filter is a security
 * control (the node applies the same one in `ingest.go`): without it any contract
 * can forge a matching log.
 */
export function parseReadRequestsFromReceipt(receipt: ReceiptLike, universalCallback: Address): ParsedReadRequest[] {
  const out: ParsedReadRequest[] = [];
  receipt.logs.forEach((log, i) => {
    if (!sameAddress(log.address, universalCallback)) return;
    if (!isTopics(log.topics) || log.topics[0].toLowerCase() !== READ_REQUESTED_TOPIC0) return;
    const { args } = decodeEventLog({
      abi: UNIVERSAL_CALLBACK_EVM,
      eventName: 'ReadRequested',
      data: log.data as Hex,
      topics: log.topics as [Hex, ...Hex[]],
    });
    const spec = args.readSpec;
    out.push({
      requestId: log.topics[1].toLowerCase() as Hex,
      requestIdUint: args.requestId,
      callbackTarget: args.callbackTarget,
      originalFunder: args.originalFunder,
      spec: {
        account: { chainNamespace: spec.account.chainNamespace, chainId: spec.account.chainId, owner: spec.account.owner },
        query: spec.query,
        minConfirmations: spec.minConfirmations,
        blockNumber: spec.blockNumber,
        expiryPushChainHeight: spec.expiryPushChainHeight,
        maxFee: spec.maxFee,
        revertRecipient: spec.revertRecipient,
      },
      callbackGasLimit: args.callbackGasLimit,
      totalPaid: args.totalPaid,
      protocolFee: args.protocolFee,
      callbackBudget: args.callbackBudget,
      logIndex: toLogIndex(log.logIndex, i),
    });
  });
  return out;
}

/**
 * Read the fulfil / settle / expiry logs for ONE request out of a receipt.
 *
 * `FULFILLED` on the node does not mean the app callback ran: the contract swallows
 * a reverting callback into `CallbackFailed`. This is where `callbackDelivered`
 * comes from. Note: EndBlocker-driven expiry transactions are NOT EVM-indexed —
 * `RequestExpired` will never be seen through a receipt; use the node record.
 */
export function parseFulfilOutcome(receipt: ReceiptLike, universalCallback: Address, requestId: Hex): FulfilOutcome {
  const out: FulfilOutcome = {};
  const wanted = requestId.toLowerCase();
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, universalCallback) || !isTopics(log.topics)) continue;
    if ((log.topics[1] ?? '').toLowerCase() !== wanted) continue;
    const topic0 = log.topics[0].toLowerCase();
    const common = { abi: UNIVERSAL_CALLBACK_EVM, data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]] } as const;
    switch (topic0) {
      case READ_FULFILLED_TOPIC0:
        out.delivered = true;
        break;
      case CALLBACK_FAILED_TOPIC0: {
        const { args } = decodeEventLog({ ...common, eventName: 'CallbackFailed' });
        out.delivered = false;
        out.failReason = args.reason;
        break;
      }
      case CALLBACK_GAS_REPORTED_TOPIC0: {
        const { args } = decodeEventLog({ ...common, eventName: 'CallbackGasReported' });
        out.gasReported = args.gasReported;
        out.burned = args.burned;
        out.refunded = args.refunded;
        break;
      }
      case REFUND_SENT_TOPIC0: {
        const { args } = decodeEventLog({ ...common, eventName: 'RefundSent' });
        out.refunded = args.amount;
        out.refundTo = args.recipient;
        out.refundFailed = false;
        break;
      }
      case REFUND_FAILED_TOPIC0: {
        const { args } = decodeEventLog({ ...common, eventName: 'RefundFailed' });
        out.refundTo = args.recipient;
        out.refundFailed = true;
        break;
      }
      case REQUEST_EXPIRED_TOPIC0: {
        const { args } = decodeEventLog({ ...common, eventName: 'RequestExpired' });
        out.expired = true;
        out.refunded = args.refunded;
        out.refundTo = args.revertRecipient;
        break;
      }
      default:
        break;
    }
  }
  return out;
}
