import { Address } from 'core';
import { Chain, EvmChainId, PushChainId, SolanaChainId } from '../constants';
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

    switch (chain) {
      case 'eip155':
        if (!Object.values(EvmChainId).includes(chainId as EvmChainId)) {
          throw new Error(`Invalid chainId "${chainId}" for EVM chain`);
        }
        return {
          chain: Chain.Evm,
          chainId: chainId as EvmChainId,
          account: address,
        };

      case 'solana':
        if (!Object.values(SolanaChainId).includes(chainId as SolanaChainId)) {
          throw new Error(`Invalid chainId "${chainId}" for Solana chain`);
        }
        return {
          chain: Chain.Solana,
          chainId: chainId as SolanaChainId,
          account: address,
        };

      case 'push':
        if (!Object.values(PushChainId).includes(chainId as PushChainId)) {
          throw new Error(`Invalid chainId "${chainId}" for Push chain`);
        }
        return {
          chain: Chain.Push,
          chainId: chainId as PushChainId,
          account: address,
        };

      default:
        throw new Error('Invalid Chain');
    }
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
