import { CHAIN } from '../constants/enums';
import { CHAIN_INFO, VM_NAMESPACE } from '../constants/chain';
import { UniversalAccount } from '../types/signer.types';

export function toChainAgnostic(account: UniversalAccount): string {
  const { chain, address } = account;
  const { chainId, vm } = CHAIN_INFO[chain];
  const namespace = VM_NAMESPACE[vm] ?? 'unknown';

  return `${namespace}:${chainId}:${address}`;
}

export function toUniversal(caip: string): UniversalAccount {
  const [namespace, chainId, address] = caip.split(':');

  const chain = (Object.entries(CHAIN_INFO).find(
    ([, info]) =>
      info.chainId === chainId && VM_NAMESPACE[info.vm] === namespace
  )?.[0] ?? null) as CHAIN | null;

  if (!chain) {
    throw new Error(`Unsupported or unknown CAIP address: ${caip}`);
  }

  return { chain, address };
}
