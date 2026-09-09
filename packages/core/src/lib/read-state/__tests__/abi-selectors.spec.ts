import { getAbiItem, toFunctionSelector, type AbiFunction } from 'viem';
import { UNIVERSAL_CALLBACK_EVM } from '../../constants/abi/universalCallback.evm';
import { UNIVERSAL_CORE_EVM } from '../../constants/abi/prc20.evm';
import { UNIVERSAL_CALLBACK_ADDRESSES, UNIVERSAL_CORE_ADDRESSES } from '../../constants/chain';
import { MAX_CALLBACK_GAS_LIMIT, MIN_CONFIRMATIONS_FLOOR, WEB2_DESTINATION } from '../../constants/read-state';
import { PUSH_NETWORK } from '../../constants/enums';

const sel = (abi: readonly unknown[], name: string) =>
  toFunctionSelector(getAbiItem({ abi: abi as never, name: name as never }) as unknown as AbiFunction);

/**
 * Pins the SDK to the DEPLOYED contract (feat-read-state f8d1a0c). Selectors were
 * probed against the live Donut bytecode on 2026-09-09: the 7-field
 * requestExternalReadSelf (0x72767171) is present, the 6-field draft variant
 * (0xd37c1add) is not; estimateFee is the 2-arg form.
 */
describe('ABI pins against the deployed UniversalCallback', () => {
  it('requestExternalReadSelf uses the 7-field ReadSpec (with revertRecipient)', () => {
    expect(sel(UNIVERSAL_CALLBACK_EVM, 'requestExternalReadSelf')).toBe('0x72767171');
  });
  it('estimateFee is (string,string) — protocol fee only, no callbackGasLimit arg', () => {
    expect(sel(UNIVERSAL_CALLBACK_EVM, 'estimateFee')).toBe('0xdca9f068');
  });
  it('UniversalCore read getters', () => {
    expect(sel(UNIVERSAL_CORE_EVM, 'chainHeightByChainNamespace')).toBe('0x68c70c9e');
    expect(sel(UNIVERSAL_CORE_EVM, 'readBaseFeeByChainNamespace')).toBe('0xc2d5c08c');
  });
  it('addresses are the genesis predeploys on every network', () => {
    for (const n of Object.values(PUSH_NETWORK)) {
      expect(UNIVERSAL_CORE_ADDRESSES[n].toLowerCase()).toBe('0x00000000000000000000000000000000000000c0');
      expect(UNIVERSAL_CALLBACK_ADDRESSES[n].toLowerCase()).toBe('0x00000000000000000000000000000000000000c2');
    }
  });
  it('contract constants', () => {
    expect(MAX_CALLBACK_GAS_LIMIT).toBe(1_000_000n);
    expect(MIN_CONFIRMATIONS_FLOOR).toBe(1);
    expect(WEB2_DESTINATION).toEqual({ chainNamespace: 'web2', chainId: 'https' });
  });
});
