/** Internal lossless SVM state shared by public reads and execution. */
import type { Address, Hex } from 'viem';
import type { AgenticGeneration } from '../deployments';
import type { SvmConfigRead } from '../contracts/v5';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import { actionId, configId } from '../codec/ids';
import { SEND_OUTBOUND_SELECTOR } from '../contracts/v5';
import { validateSvmTerms } from '../codec/svm-terms';
import { chainFromHash, readActiveRules, type ActiveRule } from './rules';
import type { Snapshot } from './snapshot';

export interface SvmRuleSnapshot {
  wallet: Address;
  rulesId: Hex;
  agent: Address;
  chainNamespace: `solana:${string}`;
  configId: Hex;
  config: SvmConfigRead;
  blockNumber: bigint;
}

export async function readSvmRule(
  snap: Snapshot,
  gen: AgenticGeneration,
  wallet: Address,
  rulesId: Hex,
  pushChainNamespace: string
): Promise<SvmRuleSnapshot> {
  const active = (await readActiveRules(snap, gen, wallet)).find(
    (r) => r.rulesId.toLowerCase() === rulesId.toLowerCase()
  );
  if (!active)
    throw new AgenticError(
      AGENTIC_ERROR_CODE.RULE_NOT_FOUND,
      `no enabled SVM rule ${rulesId} on ${wallet}`
    );
  return readSvmConfig(snap, gen, wallet, active, pushChainNamespace);
}

export async function readSvmConfig(
  snap: Snapshot,
  gen: AgenticGeneration,
  wallet: Address,
  active: ActiveRule,
  pushChainNamespace: string
): Promise<SvmRuleSnapshot> {
  const chain = chainFromHash(active.chainHash, pushChainNamespace);
  const expectedAction = actionId(
    gen.addresses.gateway,
    SEND_OUTBOUND_SELECTOR
  );
  if (
    active.mode !== 0 ||
    active.vm !== 1 ||
    !chain?.startsWith('solana:') ||
    active.actionIds.length !== 1 ||
    active.actionIds[0].toLowerCase() !== expectedAction.toLowerCase()
  )
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INCONSISTENT_READ,
      'rule is not a single gateway SVM action'
    );
  const id = configId(wallet, active.rulesId, active.actionIds[0]);
  const cfg = await snap.read<SvmConfigRead>(
    gen.addresses.rulesPolicy,
    gen.contracts.abis.policy,
    'getSvmConfig',
    [id, wallet]
  );
  try {
    if (!cfg.initialized) throw new Error('uninitialized SVM config');
    // Stored expired rules remain readable. Grant-time validation still checks expiry.
    validateSvmTerms(cfg, -1);
    for (const cap of cfg.assets) {
      if (
        typeof cap.spent !== 'bigint' ||
        cap.spent < BigInt(0) ||
        cap.spent > cap.maxTotal
      )
        throw new Error('invalid stored asset counter');
    }
  } catch (cause) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INCONSISTENT_READ,
      'malformed stored SVM config',
      { cause }
    );
  }
  return {
    wallet,
    rulesId: active.rulesId,
    agent: active.agent,
    chainNamespace: chain as `solana:${string}`,
    configId: id,
    config: cfg,
    blockNumber: snap.blockNumber,
  };
}
