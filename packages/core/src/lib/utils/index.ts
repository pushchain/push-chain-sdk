import { Address } from 'core';
import { Chain } from '../constants';
import { UniversalAccount } from '../signer/signer.types';

export const getRandomElement = <T>(array: T[]): T => {
  if (array.length === 0) {
    throw new Error('Array cannot be empty');
  }
  const randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex];
};

export class Utils {
  /**
   * @param chainAgnosticAddress in CAIP10 - example: eip155:1:0xabc...
   */
  static toUniversal(chainAgnosticAddress: string): UniversalAccount {
    const [chain, chainId, address] = chainAgnosticAddress.split(':');

    let chainFormatted = '';
    if (chain === 'eip155') chainFormatted = Chain.Evm;
    else if (chain === 'solana') chainFormatted = Chain.Solana;
    else if (chain === 'push') chainFormatted = Chain.Push;
    else throw new Error('Invalid Chain');

    return {
      chain: chainFormatted,
      chainId,
      account: address,
    };
  }

  static toChainAgnostic(universalAccount: UniversalAccount): string {
    let chain = '';
    let address = universalAccount.account;

    if (universalAccount.chain === Chain.Evm) {
      chain = 'eip155';
    } else if (universalAccount.chain === Chain.Solana) chain = 'solana';
    else if (universalAccount.chain === Chain.Push) {
      address = universalAccount.account.startsWith('push')
        ? universalAccount.account
        : Address.evmToPush(universalAccount.account as `0x${string}`);
      chain = 'push';
    } else throw new Error('Invalid chain');

    return `${chain}:${universalAccount.chainId}:${address}`;
  }
}
