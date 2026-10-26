import { getAddress, type Address } from 'viem';
import type { CHAIN } from '../../constants/enums';
import type { AgenticRuntime } from '../runtime';
import { AgenticError, AGENTIC_ERROR_CODE } from '../errors';

/** Preserve read failures as read failures; never report them as bad token routes. */
export async function resolveRuleDestination(
  runtime: AgenticRuntime,
  wallet: Address,
  chain: CHAIN
): Promise<Address> {
  try {
    return getAddress((await runtime.resolveCEA(wallet, chain)).cea);
  } catch (cause) {
    if (cause instanceof AgenticError) throw cause;
    const unavailable =
      cause instanceof Error &&
      cause.message.includes('CEAFactory not available on chain');
    const message = unavailable
      ? 'Agentic wallets are not available on this destination network yet. Choose a supported network.'
      : 'The wallet’s destination account could not be loaded. Try again shortly.';
    throw new AgenticError(
      unavailable
        ? AGENTIC_ERROR_CODE.CAPABILITY_UNAVAILABLE
        : AGENTIC_ERROR_CODE.RULE_READ_FAILED,
      message,
      {
        userMessage: message,
        cause,
        details: {
          chainNamespace: chain,
          field: 'chainNamespace',
          stage: 'destinationAccount',
        },
      }
    );
  }
}
