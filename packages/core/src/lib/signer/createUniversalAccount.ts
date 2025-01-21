import { CONSTANTS } from 'core';
import { UniversalAccount } from './signer.types';

export function createUniversalAccount({
  chain = CONSTANTS.CHAIN.ETHEREUM,
  chainId = CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA,
  address,
}: Partial<UniversalAccount> & { address: string }): UniversalAccount {
  return {
    chain,
    chainId,
    address,
  };
}
