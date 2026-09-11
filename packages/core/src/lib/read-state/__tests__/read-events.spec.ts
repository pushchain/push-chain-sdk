import { toEventSelector } from 'viem';
import requestSuccess from './fixtures/receipts/request.success-evm.json';
import requestUea from './fixtures/receipts/request.uea-originated.json';
import fulfilSuccess from './fixtures/receipts/fulfil.success-evm.json';
import fulfilReverted from './fixtures/receipts/fulfil.callback-reverted.json';
import settleSuccess from './fixtures/receipts/settle.success-evm.json';
import {
  CALLBACK_FAILED_TOPIC0,
  READ_FULFILLED_TOPIC0,
  READ_REQUESTED_TOPIC0,
  REQUEST_EXPIRED_TOPIC0,
  parseFulfilOutcome,
  parseReadRequestsFromReceipt,
} from '../read-events';
import type { ReceiptLike } from '../read-state.types';

const UC = '0x00000000000000000000000000000000000000c2' as const;
const REQ_SUCCESS = '0xf3d62fb962c84259e728d184dd2e3199c4d6c39790e20d60f2bacf0c10eca168' as const;
const REQ_REVERTED = '0x9f0466e2a3f7c20e3af1f104df7cdb254e3ff00ba50b646ccb622d648462aabe' as const;

describe('ReadRequested topic0 is pinned to the node decoder', () => {
  it('matches the hash derived independently with cast from read_event.go', () => {
    expect(READ_REQUESTED_TOPIC0).toBe('0x4eff8080da7bb648f5eed3bfbb21041b583987e36c6808f5483bd6cf9e160160');
    // callbackGasLimit sits FIFTH; a reorder changes this hash and the SDK finds zero logs
    expect(
      toEventSelector(
        'ReadRequested(uint256,((string,string,bytes),bytes,uint16,uint64,uint64,uint256,address),address,address,uint64,uint256,uint256,uint256)',
      ),
    ).toBe(READ_REQUESTED_TOPIC0);
    expect(READ_FULFILLED_TOPIC0).toBe('0xd6a6c23b749728f0fce8f6f7a34e8d7eb9e376a5d66bf118ec42a4072cef2f04');
    expect(CALLBACK_FAILED_TOPIC0).toBe('0x3fd354b63e80a8f37a7fe5f2fbe6bd357a9c5fe4396581e75456e59740834873');
    expect(REQUEST_EXPIRED_TOPIC0).toBe('0xcaf80ef6ca16ef1764d539cd743c3c61fdd7cf992673263af2f51ba97c4bdf97');
  });
});

describe('parseReadRequestsFromReceipt', () => {
  it('parses the real EOA request receipt (read 0xf3d62fb9…)', () => {
    const [r, ...rest] = parseReadRequestsFromReceipt(requestSuccess as ReceiptLike, UC);
    expect(rest).toHaveLength(0);
    expect(r.requestId).toBe(REQ_SUCCESS);
    expect(r.requestIdUint).toBe(BigInt(REQ_SUCCESS));
    expect(r.callbackTarget.toLowerCase()).toBe('0x5f7221d31a01a71662cabeec2567c55ad03e2fb7');
    expect(r.spec.account).toMatchObject({ chainNamespace: 'eip155', chainId: '11155111' });
    expect(r.spec.blockNumber).toBe(11667326n);
    expect(r.spec.minConfirmations).toBe(1);
    expect(r.callbackGasLimit).toBe(200000n);
    expect(r.protocolFee).toBe(0n);
    expect(r.callbackBudget).toBe(50000000000000000n);
    expect(r.totalPaid).toBe(50000000000000000n);
    expect(r.spec.revertRecipient.toLowerCase()).toBe('0x0a16cba65ffcaa4c2282b27b027ab4a2fe46e0bf');
  });

  it('parses the UEA-originated receipt (read 0xdc0a66ba…) — two logs, one from the UEA, one from the contract', () => {
    expect((requestUea as ReceiptLike).logs).toHaveLength(2);
    const reads = parseReadRequestsFromReceipt(requestUea as ReceiptLike, UC);
    expect(reads).toHaveLength(1);
    expect(reads[0].requestId).toBe('0xdc0a66ba9d265c84f06ac97f49a20135a65df308c19cc9ab7b6f716e383e73cb');
    expect(reads[0].spec.revertRecipient.toLowerCase()).toBe('0x5c70c864cf1adfb04a0e107ffa248ba3600eab8d'); // the UEA
  });

  it('ignores a matching topic0 emitted by a DIFFERENT address (address filter is a security control)', () => {
    const forged: ReceiptLike = {
      logs: (requestSuccess as ReceiptLike).logs.map((l) => ({ ...l, address: '0x1111111111111111111111111111111111111111' })),
    };
    expect(parseReadRequestsFromReceipt(forged, UC)).toHaveLength(0);
  });

  it('returns two ids in log order when one tx requests two reads', () => {
    const one = (requestSuccess as ReceiptLike).logs[0];
    const other = { ...one, topics: [one.topics[0], REQ_REVERTED, ...one.topics.slice(2)], logIndex: 9 };
    const reads = parseReadRequestsFromReceipt({ logs: [one, other] }, UC);
    expect(reads.map((r) => r.requestId)).toEqual([REQ_SUCCESS, REQ_REVERTED]);
    expect(reads.map((r) => r.logIndex)).toEqual([Number(BigInt(one.logIndex as string)), 9]);
  });
});

describe('parseFulfilOutcome', () => {
  it('delivered: the real fulfil receipt carries ReadFulfilled', () => {
    const o = parseFulfilOutcome(fulfilSuccess as ReceiptLike, UC, REQ_SUCCESS);
    expect(o.delivered).toBe(true);
    expect(o.failReason).toBeUndefined();
  });

  it('NOT delivered: the reverting-callback fulfil receipt carries CallbackFailed with the reason', () => {
    const o = parseFulfilOutcome(fulfilReverted as ReceiptLike, UC, REQ_REVERTED);
    expect(o.delivered).toBe(false);
    expect(o.failReason).toMatch(/^0x08c379a0/); // Error(string) "app callback reverted on purpose"
  });

  it('settlement: burned + refunded from CallbackGasReported, refundTo from RefundSent', () => {
    const o = parseFulfilOutcome(settleSuccess as ReceiptLike, UC, REQ_SUCCESS);
    // read 2's fulfil used 118,289 gas at 1 gwei → burned 118,289 × 1e9; the rest of the 0.05 PC budget refunded
    expect(o.burned).toBe(118289000000000n);
    expect(o.refunded).toBe(49881711000000000n);
    expect(o.burned! + o.refunded!).toBe(50000000000000000n); // sums to the budget to the wei
    expect(o.refundFailed).toBe(false);
    expect(o.refundTo?.toLowerCase()).toBe('0x0a16cba65ffcaa4c2282b27b027ab4a2fe46e0bf');
  });

  it('is scoped to the requested id — another request in the same receipt is ignored', () => {
    const o = parseFulfilOutcome(fulfilSuccess as ReceiptLike, UC, REQ_REVERTED);
    expect(o).toEqual({});
  });
});
