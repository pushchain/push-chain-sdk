import { CHAIN, NETWORK } from './constants/enums';
import { Orchestrator } from './orchestrator/orchestrator';
import { createUniversalSigner } from './universal/signer';
import { UniversalSigner } from './universal/universal.types';
import { Utils } from './utils';

export class CrossChain {
  /**
   * Provides access to utility methods in PushChain.
   */
  public static utils = Utils;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor(private orchestartor: Orchestrator) {}

  static initialize = async (
    universalSigner: UniversalSigner,
    options?: {
      network?: NETWORK;
      rpcUrl?: Partial<Record<CHAIN, string>>;
      printTraces?: boolean;
    }
  ) => {
    const orchestartor = new Orchestrator(
      /**
       * @dev - createUniversalSigner parses the obj to ensure signer has correct implementation
       */
      createUniversalSigner(universalSigner),
      options?.network || NETWORK.TESTNET,
      options?.rpcUrl || {},
      options?.printTraces || false
    );
    return new CrossChain(orchestartor);
  };

  execute = this.orchestartor.execute;
}
