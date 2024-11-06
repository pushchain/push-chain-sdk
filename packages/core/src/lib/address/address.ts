import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import { getAddress } from 'viem';
import { bech32m } from 'bech32';
import { ENV } from '../constants';
import { PUSH_NETWORK } from './address.types';

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
   * @param prefix Push prefix (default: 'push')
   * @returns Push address
   */
  static evmToPush = (address: `0x${string}`, prefix = PUSH_PREFIX): string => {
    try {
      const words = bech32m.toWords(hexToBytes(getAddress(address).slice(2)));
      return bech32m.encode(prefix, words);
    } catch (e) {
      throw new Error('Invalid EVM address');
    }
  };

  /**
   * Converts a Push (bech32m) address to an EVM address
   * @param address Push address
   * @returns EVM address in checksum format
   */
  static pushToEvm = (address: string): string => {
    try {
      const decoded = bech32m.decode(address);
      const bytes = new Uint8Array(bech32m.fromWords(decoded.words));
      return getAddress(`0x${bytesToHex(bytes)}`);
    } catch (e) {
      throw new Error('Invalid Push address');
    }
  };

  /**
   * Converts an EVM address in Push CAIP format
   * @param address
   * @param env
   */
  static toPushCAIP = (
    address: `0x${string}` | `push${string}`,
    env: ENV = ENV.STAGING
  ) => {
    let network: PUSH_NETWORK;
    switch (env) {
      case ENV.LOCAL:
      case ENV.DEV: {
        network = PUSH_NETWORK.DEVNET;
        break;
      }
      case ENV.STAGING: {
        network = PUSH_NETWORK.TESTNET;
        break;
      }
      case ENV.PROD: {
        network = PUSH_NETWORK.MAINNET;
        break;
      }
      default: {
        throw Error('Invalid ENV');
      }
    }
    const pushAddress = address.startsWith(PUSH_PREFIX)
      ? address
      : Address.evmToPush(address as `0x${string}`);
    return `push:${network}:${pushAddress}`;
  };

  /**
   * Converts an address to CAIP10 format
   * @param address
   * @param network - Chain ID for EIP155 address, 'mainnet' | 'testnet' | 'devnet' for Solana & Push address
   * @dev - This method does not verify the address
   * @dev - Address not starting with 'push' & '0x' will be treated as SOL address
   */
  static toCAIP = (
    address: string,
    network: number | `${PUSH_NETWORK}`
  ): string => {
    const namespace = address.startsWith(PUSH_PREFIX)
      ? 'push'
      : address.startsWith('0x')
      ? 'eip155'
      : 'solana';

    // Validate network
    if (namespace === 'eip155' && typeof network !== 'number') {
      throw new Error('Invalid network for EIP155 address');
    }
    if (
      (namespace === 'push' || namespace === 'solana') &&
      typeof network === 'number'
    ) {
      throw new Error(`Invalid network for ${namespace} address`);
    }

    // Modify network for sol
    // Reference: https://namespaces.chainagnostic.org/solana/caip10
    const networkToSolChainId = {
      mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z',
    };
    const solChainId = networkToSolChainId[network as `${PUSH_NETWORK}`];

    // Return CAIP10 address
    if (namespace === 'solana') {
      return `${namespace}:${solChainId}:${address}`;
    }
    return `${namespace}:${network}:${address}`;
  };
}
