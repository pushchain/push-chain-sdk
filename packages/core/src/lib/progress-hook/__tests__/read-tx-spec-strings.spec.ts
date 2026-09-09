/**
 * Locks the READ-TX band (single read 101–199, batch 001/999) titles, levels
 * and response shapes to the read-state SDK spec (plan/read-state-sdk-spec.md,
 * "ProgressHook events"). Change this test and the spec together.
 */
import PROGRESS_HOOKS from '../progress-hook';
import { PROGRESS_HOOK } from '../progress-hook.types';

const chain = 'eip155:11155111';
const requestId = '0xf3d62fb962c84259e728d184dd2e3199c4d6c39790e20d60f2bacf0c10eca168';
const txHash = '0x8329b6134cc622fb58a015e54ec11d5bb38b604f8a3d42e62133fc31047ae732';
const addr = '0x5F7221d31a01A71662cABEeC2567c55ad03E2fb7';

type Row = [PROGRESS_HOOK, unknown[], string, ProgressLevel, object];
type ProgressLevel = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

const rows: Row[] = [
  [PROGRESS_HOOK.READ_TX_101, [chain, 'eip155', 0], 'Ethereum Sepolia Read Requested', 'INFO', { chain, namespace: 'eip155', queryType: 0 }],
  [PROGRESS_HOOK.READ_TX_102_01, [chain], 'Fetching Destination Height & Fee', 'INFO', { chain, stage: 'preflight' }],
  [PROGRESS_HOOK.READ_TX_102_02, [0n, 5n, 5n, 100n, 200n], 'Read Spec Assembled', 'SUCCESS', { protocolFee: '0', callbackBudget: '5', total: '5', blockNumber: '100', expiryPushChainHeight: '200' }],
  [PROGRESS_HOOK.READ_TX_102_03, [chain], 'Destination Height Unavailable', 'ERROR', { chain }],
  [PROGRESS_HOOK.READ_TX_102_04, [1000, 61_000], 'Preflight Stale, Refetching', 'WARNING', { fetchedAt: 1000, ageMs: 61_000 }],
  [PROGRESS_HOOK.READ_TX_102_05, [addr], 'Refund Target Is A Contract', 'WARNING', { refundTo: addr }],
  [PROGRESS_HOOK.READ_TX_103_01, [10n, 20n], 'Checking Balance Requirements', 'INFO', { required: '10', available: '20', sufficient: true, shortfall: '0' }],
  [PROGRESS_HOOK.READ_TX_103_01, [20n, 10n], 'Checking Balance Requirements', 'WARNING', { required: '20', available: '10', sufficient: false, shortfall: '10' }],
  [PROGRESS_HOOK.READ_TX_103_02, [20n, 10n], 'Insufficient Balance', 'ERROR', { required: '20', available: '10', shortfall: '10' }],
  [PROGRESS_HOOK.READ_TX_103_03, [['authorization']], 'Sensitive Header Detected', 'WARNING', { matchedHeaders: ['authorization'] }],
  [PROGRESS_HOOK.READ_TX_104_01, [], 'Broadcasting Read Request', 'INFO', { stage: 'broadcasting' }],
  [PROGRESS_HOOK.READ_TX_104_02, [txHash, requestId, 1], 'Request Confirmed, Read Detected', 'SUCCESS', { txHash, requestId, logIndex: 1 }],
  [PROGRESS_HOOK.READ_TX_105_01, [requestId], 'Awaiting Quorum', 'INFO', { requestId, status: 'PENDING' }],
  [PROGRESS_HOOK.READ_TX_105_02, [requestId], 'Voting In Progress', 'INFO', { requestId, status: 'VOTING' }],
  [PROGRESS_HOOK.READ_TX_105_03, [requestId, 1n, 3n], 'Awaiting Destination Confirmations', 'INFO', { requestId, current: '1', required: '3' }],
  [PROGRESS_HOOK.READ_TX_105_04, [requestId, 12n], 'Approaching Expiry', 'WARNING', { requestId, pushBlocksRemaining: '12' }],
  [PROGRESS_HOOK.READ_TX_106_01, [requestId, addr], 'Quorum Reached, Executing Callback', 'INFO', { requestId, callbackTarget: addr }],
  [PROGRESS_HOOK.READ_TX_106_02, [requestId], 'Callback Delivered', 'SUCCESS', { requestId }],
  [PROGRESS_HOOK.READ_TX_106_03, [requestId, '0xdead'], 'Callback Reverted', 'WARNING', { requestId, reason: '0xdead' }],
  [PROGRESS_HOOK.READ_TX_106_04, [requestId, 7n, 3n], 'Callback Gas Settled', 'INFO', { requestId, burned: '7', refunded: '3' }],
  [PROGRESS_HOOK.READ_TX_106_05, [requestId, 3n, addr], 'Refund Sent', 'INFO', { requestId, amount: '3', refundTo: addr }],
  [PROGRESS_HOOK.READ_TX_106_06, [requestId, 3n, addr], 'Refund Rejected', 'WARNING', { requestId, amount: '3', refundTo: addr }],
  [PROGRESS_HOOK.READ_TX_199_01, [requestId, 42n, '0x2a', true], 'Read Fulfilled', 'SUCCESS', { requestId, value: '42', resultData: '0x2a', callbackDelivered: true }],
  [PROGRESS_HOOK.READ_TX_199_02, [requestId, 'EXPIRED', undefined, '', 5n], 'Read Failed / Expired / Aborted', 'ERROR', { requestId, status: 'EXPIRED', errorCode: null, errorMsg: '', refunded: '5' }],
  [PROGRESS_HOOK.READ_TX_199_03, [requestId, 'VOTING', 180_000], 'Read Timeout', 'ERROR', { requestId, lastStatus: 'VOTING', elapsedMs: 180_000 }],
  [PROGRESS_HOOK.READ_TX_199_99, [requestId, txHash], 'Intermediate Read Step Completed', 'INFO', { requestId, txHash }],
  [PROGRESS_HOOK.READ_TX_001, [2, [chain, 'web2:https']], 'Batch Read Initiated', 'INFO', { count: 2, chains: [chain, 'web2:https'] }],
  [PROGRESS_HOOK.READ_TX_002_01, [1, 2, chain], 'Starting Read #1/2', 'INFO', { n: 1, total: 2, chain }],
  [PROGRESS_HOOK.READ_TX_002_99_99, [1, 2, requestId], 'Read #1/2 Complete', 'INFO', { n: 1, total: 2, requestId }],
  [PROGRESS_HOOK.READ_TX_999_01, [2], 'All Reads Fulfilled', 'SUCCESS', { count: 2 }],
  [PROGRESS_HOOK.READ_TX_999_02, [2, 3, 'boom'], 'Batch Reads Failed', 'ERROR', { failedAt: 2, total: 3, error: 'boom' }],
  [PROGRESS_HOOK.READ_TX_999_03, [2, 3], 'Batch Reads Timeout', 'ERROR', { failedAt: 2, total: 3 }],
];

describe('READ-TX spec strings', () => {
  it.each(rows)('%s', (id, args, title, level, response) => {
    const ev = PROGRESS_HOOKS[id](...args);
    expect(ev.id).toBe(id);
    expect(ev.title).toBe(title);
    expect(ev.level).toBe(level);
    expect(ev.response).toEqual(response);
    expect(ev.message.length).toBeGreaterThan(0);
    expect(typeof ev.timestamp).toBe('string');
  });

  it('every READ_TX id in the enum has a hook, and none leaks a bigint into response', () => {
    const ids = Object.values(PROGRESS_HOOK).filter((v) => v.startsWith('READ-TX-'));
    expect(ids).toHaveLength(31);
    for (const id of ids) expect(typeof PROGRESS_HOOKS[id]).toBe('function');
    for (const [id, args] of rows) {
      expect(JSON.stringify(PROGRESS_HOOKS[id](...args).response)).toBeDefined(); // throws on bigint
    }
  });

  it('199-01 with a non-delivered callback says so in the message', () => {
    const ev = PROGRESS_HOOKS[PROGRESS_HOOK.READ_TX_199_01](requestId, undefined, '0x', false);
    expect(ev.message).toMatch(/not delivered/);
    expect(ev.response).toEqual({ requestId, value: null, resultData: '0x', callbackDelivered: false });
  });
});
