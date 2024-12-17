import { UniversalSigner, ValidatedUniversalSigner } from './signer.types';

export class Signer {
  static create(universalSigner: UniversalSigner): ValidatedUniversalSigner {
    const { chain, chainId, account, signMessage } = universalSigner;
    return {
      chain,
      chainId,
      account,
      signMessage,
    };
  }
}
