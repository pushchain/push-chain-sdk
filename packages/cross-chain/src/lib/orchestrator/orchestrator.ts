import { CHAIN, ENV } from '../constants/enums';
import { UniversalSigner } from '../universal/universal.types';

export class Orchestrator {
  constructor(
    private readonly universalSigner: UniversalSigner,
    private readonly pushNetwork: ENV,
    private readonly rpcUrl: Partial<Record<CHAIN, string>>,
    private readonly printTraces: boolean
  ) {}

  async execute({
    target,
    value,
    data,
  }: {
    target: string;
    value?: bigint;
    data?: `0x${string}`;
  }): Promise<`0x${string}`> {
    // TODO: Implement this

    // 1 Find the NMSC address for the given signer

    // 2 Find gasFeeEstimate for the user interaction

    // 3 Check if NMSC has funds >= Fee ( Found in step 2 )

    // 4 If not lock the require funds on fee-locker

    // 5 If NMSC has funds then send a custom cosmos tx to PC ( Gasless )

    return '0x';
  }

  private async deriveNMSCAddress() {
    //
  }
}
