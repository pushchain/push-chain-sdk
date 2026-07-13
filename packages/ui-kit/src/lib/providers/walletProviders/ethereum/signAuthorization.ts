import type {
  SignAuthorizationParams,
  SignedAuthorization,
} from '@pushchain/core';

export const EIP_7702_UNSUPPORTED_ERROR =
  'Wallet does not support EIP-7702 authorization';

type AuthorizationResult = {
  chainId?: bigint | number;
  nonce?: bigint | number;
  r?: string;
  s?: string;
  yParity?: bigint | number;
  signature?: {
    r: string;
    s: string;
    yParity: bigint | number;
  };
};

type AuthorizationSigner = {
  authorize?: (authorization: {
    address: string;
    chainId?: number;
    nonce?: number;
  }) => Promise<AuthorizationResult>;
};

export const normalizeSignedAuthorization = (
  authorization: AuthorizationResult,
  { contractAddress, chainId, nonce }: SignAuthorizationParams
): SignedAuthorization => {
  const signature = authorization.signature ?? authorization;
  const resolvedChainId = authorization.chainId ?? chainId;
  const resolvedNonce = authorization.nonce ?? nonce;

  if (
    resolvedChainId === undefined ||
    resolvedNonce === undefined ||
    !signature.r ||
    !signature.s ||
    signature.yParity === undefined
  ) {
    throw new Error('Wallet returned an invalid EIP-7702 authorization');
  }

  return {
    address: contractAddress,
    chainId: Number(resolvedChainId),
    nonce: Number(resolvedNonce),
    r: signature.r as `0x${string}`,
    s: signature.s as `0x${string}`,
    yParity: Number(signature.yParity),
  };
};

export const signAuthorizationWithEthersSigner = async (
  signer: AuthorizationSigner,
  params: SignAuthorizationParams
): Promise<SignedAuthorization> => {
  if (typeof signer.authorize !== 'function') {
    throw new Error(EIP_7702_UNSUPPORTED_ERROR);
  }

  try {
    const authorization = await signer.authorize({
      address: params.contractAddress,
      chainId: params.chainId,
      nonce: params.nonce,
    });

    return normalizeSignedAuthorization(authorization, params);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const message = error instanceof Error ? error.message : String(error);

    if (
      code === 'UNSUPPORTED_OPERATION' ||
      /authorization (?:is )?not (?:implemented|supported)/i.test(message)
    ) {
      throw new Error(EIP_7702_UNSUPPORTED_ERROR);
    }

    throw error;
  }
};
