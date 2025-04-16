import { ENV } from './constants/enums';
import { createUniversalSigner } from './universal/universal';
import { UniversalSigner } from './universal/universal.types';
import { Utils } from './utils';

export class CrossChain {
  /**
   * Provides access to utility methods in PushChain.
   */
  public static utils = Utils;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  static initialize = async (
    universalSigner: UniversalSigner | null = null,
    options: {
      network: ENV;
      rpcUrl?: string;
      printTraces?: boolean;
    } = {
      network: ENV.TESTNET,
      rpcUrl: '',
      printTraces: false,
    }
  ) => {
    /**
     * @dev - createUniversalSigner in future can perform some parsing to ensure signer has correct implementation
     */
    const verifiedUniversalSigner = universalSigner
      ? createUniversalSigner(universalSigner)
      : null;
    return new CrossChain();
  };
}
