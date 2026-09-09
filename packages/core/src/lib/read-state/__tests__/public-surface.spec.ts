/** The read-state surface a consumer sees from `@pushchain/core`. */
import * as core from '../../index';
import { PushChain } from '../../index';

describe('read-state public surface', () => {
  it('exports the pure helpers, errors and enums', () => {
    for (const fn of [
      'resolveDestination', 'encodeReadQuery', 'decodeReadResult', 'parseReadRequestsFromReceipt', 'parseFulfilOutcome',
      'buildReadSpecFromPreflight', 'validateReadSpec', 'toCallData', 'sizeCallbackBudget', 'inferResultShape', 'toRequestIdHex', 'toReadQuery',
      'ReadStateError', 'InvalidReadQueryError', 'InvalidReadSpecError', 'ReadHeightUnavailableError', 'UnsupportedReadDestinationError',
      'ReadDecodeError', 'ReadTimeoutError', 'ReadNotFoundError', 'ReadRegistryUnavailableError',
    ]) {
      expect(typeof (core as Record<string, unknown>)[fn]).toBe('function');
    }
    expect(core.READ_CHAIN_WEB2).toBe('web2:https');
    expect(core.UNIVERSAL_READ_STATUS.FULFILLED).toBe(3);
    expect(core.READ_STATUS.ERROR).toBe(2);
    expect(core.READ_ERROR_CODE.INVALID_QUERY).toBe(1);
    expect(core.TERMINAL_READ_STATUSES.has(core.UNIVERSAL_READ_STATUS.EXPIRED)).toBe(true);
    expect(Array.isArray(core.UNIVERSAL_CALLBACK_EVM)).toBe(true);
  });

  it('PushChain.CONSTANTS.READ pins the contract-derived values', () => {
    const R = PushChain.CONSTANTS.READ;
    expect(R.WEB2).toBe('web2:https');
    expect(R.MAX_CALLBACK_GAS_LIMIT).toBe(1_000_000n);
    expect(R.MIN_CONFIRMATIONS_FLOOR).toBe(1);
    expect(R.DEFAULT_EXPIRY_BLOCKS).toBe(300n);
    expect(R.CALLBACK_BUDGET_BUFFER).toBe(3);
    expect(R.WEB2_MAX_EXTRACT_ENTRIES).toBe(16);
    expect(R.WEB2_DEFAULT_TIMEOUT_MS).toBe(5_000);
    expect(R.NAMESPACE).toEqual({ EVM: 'eip155', SVM: 'solana', WEB2: 'web2' });
    expect(R.UNIVERSAL_CORE_ADDRESSES.TESTNET_DONUT).toBe('0x00000000000000000000000000000000000000C0');
    expect(R.UNIVERSAL_CALLBACK_ADDRESSES.TESTNET_DONUT).toBe('0x00000000000000000000000000000000000000c2');
    expect(R.STATUS.FULFILLED).toBe(3);
    expect(R.RESULT_STATUS.SUCCESS).toBe(1);
    expect(R.ERROR_CODE.REVERTED).toBe(3);
  });
});
