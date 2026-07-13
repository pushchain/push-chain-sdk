import type {
  SignAuthorizationParams,
  SignedAuthorization,
} from '@pushchain/core';
import type { IWalletProvider, WalletInfo } from '../types';
import { EIP_7702_UNSUPPORTED_ERROR } from '../providers/walletProviders/ethereum/signAuthorization';

type WalletRegistry = {
  getProvider(name: string): IWalletProvider | undefined;
};

export const signAuthorizationForWalletConnection = async (
  externalWallet: WalletInfo | null,
  params: SignAuthorizationParams,
  registry: WalletRegistry,
  socialSignAuthorization: (
    params: SignAuthorizationParams
  ) => Promise<SignedAuthorization>
): Promise<SignedAuthorization> => {
  if (!externalWallet) {
    return socialSignAuthorization(params);
  }

  const provider = registry.getProvider(externalWallet.providerName);

  if (!provider) {
    throw new Error('Provider not found');
  }
  if (typeof provider.signAuthorization !== 'function') {
    throw new Error(EIP_7702_UNSUPPORTED_ERROR);
  }

  return provider.signAuthorization(params);
};
