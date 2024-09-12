import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import { getAddress } from 'viem';
import { bech32m } from 'bech32';

const PUSH_PREFIX = 'push';

export class Address {
  /**
   ** NOTE
   * - bech32m prefix is always in lowercase
   * - bech32m address is always in lowercase
   */

  /**
   * Converts an EVM address to a Push (bech32m) address
   * @param address EVM address
   * @returns Push address
   */
  static evmToPush = (address: `0x${string}`): string => {
    try {
      const words = bech32m.toWords(hexToBytes(getAddress(address).slice(2)));
      return bech32m.encode(PUSH_PREFIX, words);
    } catch (e) {
      throw new Error('Invalid EVM address');
    }
  };

  /**
   * Converts a Push (bech32m) address to an EVM address
   * @param address Push address
   * @returns EVM address in checksum format
   */
  static pushToEvm = (address: `push${string}`): string => {
    try {
      const decoded = bech32m.decode(address);
      const bytes = new Uint8Array(bech32m.fromWords(decoded.words));
      return getAddress(`0x${bytesToHex(bytes)}`);
    } catch (e) {
      throw new Error('Invalid Push address');
    }
  };
}
