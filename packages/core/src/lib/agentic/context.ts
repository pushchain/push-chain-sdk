import { getAddress, type Address } from 'viem';
import { CHAIN } from '../constants/enums';
import { AgenticCapability, requireCapability } from './capabilities';
import { resolveWalletGeneration, type AgenticGeneration } from './deployments';
import { AGENTIC_ERROR_CODE, AgenticError } from './errors';
import { readActiveRules } from './reads/rules';
import { Snapshot } from './reads/snapshot';
import type { AgenticRuntime } from './runtime';
import type { AgenticDoor } from './agentic.types';

/**
 * Identity of an agentic client. Three values stay separate:
 *  - signerOrigin:        the key that signs (universal.origin)
 *  - signerPushAccount:   its Push identity — EOA or UEA for its origin chain;
 *                         pays Push gas and is the identity ownership checks use
 *  - wallet:              the AGW, the execution account (universal.account)
 */
export interface AgenticExecutionContext {
  wallet: Address;
  door: AgenticDoor;
  signerPushAccount: Address;
  signerOrigin: { chain: CHAIN; address: string };
  generation: AgenticGeneration;
}

/**
 * Initialization-time resolution for `initialize(signer, { agenticWallet })`.
 * Owner → owner door. Otherwise at least one ENABLED rule must name the
 * signer's Push identity (expired-but-enabled still qualifies; expiry is an
 * on-chain send check). Nothing here is cached for later sends.
 */
export async function resolveAgenticContext(
  runtime: AgenticRuntime,
  walletInput: string
): Promise<AgenticExecutionContext> {
  let wallet: Address;
  try {
    wallet = getAddress(walletInput);
  } catch (cause) {
    throw new AgenticError(AGENTIC_ERROR_CODE.NOT_AGENTIC_WALLET, `"${walletInput}" is not an address`, {
      cause,
    });
  }
  const generation = await resolveWalletGeneration(runtime.reader, runtime.network, wallet);
  const signerPushAccount = runtime.signerPushAccount();
  const snap = await Snapshot.at(runtime.reader);
  const owner = getAddress(
    await snap.read<Address>(wallet, generation.contracts.abis.wallet, 'owner')
  );
  let door: AgenticDoor;
  if (owner === signerPushAccount) {
    requireCapability(generation.capabilities, AgenticCapability.OWNER_EXECUTE);
    door = 'owner';
  } else {
    requireCapability(generation.capabilities, AgenticCapability.AGENT_EXECUTE);
    const active = await readActiveRules(snap, generation, wallet);
    if (!active.some((r) => r.agent === signerPushAccount)) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.NOT_OWNER_OR_AGENT,
        `${signerPushAccount} is neither the owner of ${wallet} nor the agent of an enabled rule`,
        {
          hint: runtime.signerIsPushNative()
            ? 'Grant a rule to this Push address, or initialize with the owner signer.'
            : 'An external key acts through its UEA for the chain it was initialized on; grant the rule to that UEA (PushChain.utils.account.deriveExecutorAccount).',
          details: { wallet, signerPushAccount, owner },
        }
      );
    }
    door = 'agent';
  }
  return {
    wallet,
    door,
    signerPushAccount,
    signerOrigin: runtime.signerOrigin(),
    generation,
  };
}
