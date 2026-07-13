import {
  PushChain,
  type SignAuthorizationParams,
  type SignedAuthorization,
} from '@pushchain/core';
import type { ITypedData, UniversalAccount } from '../types';

type SignerHandlers = {
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;
  signAndSendTransaction: (data: Uint8Array) => Promise<Uint8Array>;
  signTypedData: (data: ITypedData) => Promise<Uint8Array>;
  signAuthorization?: (
    params: SignAuthorizationParams
  ) => Promise<SignedAuthorization>;
};

export const constructPushChainSigner = (
  universalAccount: UniversalAccount,
  isSolana: boolean,
  handlers: SignerHandlers
) => {
  return PushChain.utils.signer.construct(universalAccount, {
    signMessage: handlers.signMessage,
    signAndSendTransaction: handlers.signAndSendTransaction,
    signTypedData: isSolana ? undefined : handlers.signTypedData,
    signAuthorization: isSolana ? undefined : handlers.signAuthorization,
  });
};
