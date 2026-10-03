import { getAddress, type Address, type Hex } from 'viem';
import { CHAIN } from '../../constants/enums';
import { AgenticCapability, CAPABILITY_DEPENDENCY, requireCapability } from '../capabilities';
import type { AgenticGeneration } from '../deployments';
import type { NativeConfigRead, ModeRead } from '../contracts/e704d5b';
import { configId } from '../codec/ids';
import { nativeTermsToRule } from '../codec/native';
import { chainHash } from '../codec/rules';
import { AGENTIC_ERROR_CODE, AgenticError, capabilityUnavailable } from '../errors';
import type { AgenticHex, RulesRecord } from '../agentic.types';
import { Snapshot, scanLogs } from './snapshot';

const ZERO_REF = `0x${'00'.repeat(32)}` as AgenticHex;
const MODE_UNIVERSAL = 0;
const MODE_NATIVE = 1;

export interface ActiveRule {
  rulesId: Hex;
  /** agentOf(rulesId); zero means the engine no longer resolves it. */
  agent: Address;
  actionIds: readonly Hex[];
  mode: number;
  vm: number;
  chainHash: Hex;
}

/** Enabled rule IDs with their agent and governed chain, all at one block. */
export async function readActiveRules(
  snap: Snapshot,
  gen: AgenticGeneration,
  wallet: Address
): Promise<ActiveRule[]> {
  const ids = await snap.read<readonly Hex[]>(
    gen.addresses.sessionEngine,
    gen.contracts.abis.engine,
    'getPermissionIDs',
    [wallet]
  );
  return Promise.all(ids.map((id) => readActiveRule(snap, gen, wallet, id)));
}

async function readActiveRule(
  snap: Snapshot,
  gen: AgenticGeneration,
  wallet: Address,
  rulesId: Hex
): Promise<ActiveRule> {
  const [agent, actionIds] = await Promise.all([
    snap.read<Address>(wallet, gen.contracts.abis.wallet, 'agentOf', [rulesId]),
    snap.read<readonly Hex[]>(gen.addresses.sessionEngine, gen.contracts.abis.engine, 'getEnabledActions', [
      wallet,
      rulesId,
    ]),
  ]);
  if (actionIds.length === 0) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INCONSISTENT_READ,
      `enabled rule ${rulesId} has no enabled actions`
    );
  }
  const modes = await Promise.all(
    actionIds.map((a) =>
      snap.read<ModeRead>(gen.addresses.rulesPolicy, gen.contracts.abis.policy, 'getMode', [
        configId(wallet, rulesId, a),
        wallet,
      ])
    )
  );
  const first = modes[0];
  if (!modes.every((m) => m.initialized && m.chainHash === first.chainHash && m.mode === first.mode)) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INCONSISTENT_READ,
      `rule ${rulesId} has uninitialized or mixed-chain policy configs`
    );
  }
  return {
    rulesId,
    agent: getAddress(agent),
    actionIds,
    mode: Number(first.mode),
    vm: Number(first.vm),
    chainHash: first.chainHash,
  };
}

/** Map a stored chain hash back to its CAIP-2 string from known chains. */
export function chainFromHash(hash: Hex, pushChainNamespace: string): string | undefined {
  const known = [pushChainNamespace, ...Object.values(CHAIN)];
  return known.find((c) => chainHash(c) === hash);
}

/**
 * Agent-door rule selection for one send (spec 2.a): enabled rules whose agent
 * is the signer and whose chain is the destination, read uncached at one
 * block. Expiry, caps and policy remain on-chain checks.
 */
export async function selectRuleForSend(
  snap: Snapshot,
  gen: AgenticGeneration,
  wallet: Address,
  agent: Address,
  destinationChain: string
): Promise<ActiveRule> {
  const active = await readActiveRules(snap, gen, wallet);
  const want = chainHash(destinationChain);
  const matches = active.filter(
    (r) => r.agent === getAddress(agent) && r.chainHash === want
  );
  if (matches.length === 0) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.NO_RULES_FOR_CHAIN,
      `no enabled rule on ${wallet} names ${agent} for ${destinationChain}`,
      { details: { wallet, agent, destinationChain, blockNumber: snap.blockNumber } }
    );
  }
  if (matches.length > 1) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.DUPLICATE_RULE,
      `${matches.length} enabled rules on ${wallet} name ${agent} for ${destinationChain}`,
      {
        hint: 'The SDK will not pick one arbitrarily. Ask the owner to revoke all but one (rules.revoke) and retry.',
        details: { rulesIds: matches.map((m) => m.rulesId) },
      }
    );
  }
  return matches[0];
}

/** Decode one active rule into the public record. */
export async function decodeActiveRule(
  snap: Snapshot,
  gen: AgenticGeneration,
  wallet: Address,
  rule: ActiveRule,
  pushChainNamespace: string
): Promise<RulesRecord> {
  if (rule.mode === MODE_UNIVERSAL) {
    throw capabilityUnavailable(
      AgenticCapability.UNIVERSAL_EVM_RULES,
      `rule ${rule.rulesId} is a universal rule; ${CAPABILITY_DEPENDENCY[AgenticCapability.UNIVERSAL_EVM_RULES]}`
    );
  }
  if (rule.mode !== MODE_NATIVE) {
    throw new AgenticError(AGENTIC_ERROR_CODE.RULE_READ_FAILED, `rule ${rule.rulesId} has unknown mode ${rule.mode}`);
  }
  if (rule.actionIds.length !== 1) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.RULE_READ_FAILED,
      `rule ${rule.rulesId} has ${rule.actionIds.length} native actions; the public NativeRule is single-action (A02)`
    );
  }
  const cfg = await snap.read<NativeConfigRead>(
    gen.addresses.rulesPolicy,
    gen.contracts.abis.policy,
    'getNativeConfig',
    [configId(wallet, rule.rulesId, rule.actionIds[0]), wallet]
  );
  if (!cfg.initialized) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INCONSISTENT_READ,
      `native config for ${rule.rulesId} is not initialized`
    );
  }
  if (rule.agent === getAddress(`0x${'00'.repeat(20)}`)) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INCONSISTENT_READ,
      `enabled rule ${rule.rulesId} does not resolve to an agent`
    );
  }
  return {
    rulesId: rule.rulesId as AgenticHex,
    enabled: true,
    chainNamespace: pushChainNamespace,
    agent: rule.agent,
    validUntil: Number(cfg.validUntil),
    ref: ZERO_REF,
    rule: nativeTermsToRule(cfg, rule.agent, ZERO_REF),
    spent: {
      kind: 'native',
      valueSpent: cfg.valueSpent,
      amountSpent: cfg.amountSpent,
      callsUsed: Number(cfg.callsUsed),
    },
  };
}

/** Native spend counters for the update assertion. */
export async function readNativeSpend(
  snap: Snapshot,
  gen: AgenticGeneration,
  wallet: Address,
  rule: ActiveRule
): Promise<{ configId: Hex; valueSpent: bigint; amountSpent: bigint; callsUsed: number }> {
  const id = configId(wallet, rule.rulesId, rule.actionIds[0]);
  const cfg = await snap.read<NativeConfigRead>(
    gen.addresses.rulesPolicy,
    gen.contracts.abis.policy,
    'getNativeConfig',
    [id, wallet]
  );
  return {
    configId: id,
    valueSpent: cfg.valueSpent,
    amountSpent: cfg.amountSpent,
    callsUsed: Number(cfg.callsUsed),
  };
}

export async function listRules(
  snap: Snapshot,
  gen: AgenticGeneration,
  wallet: Address,
  pushChainNamespace: string
): Promise<RulesRecord[]> {
  requireCapability(gen.capabilities, AgenticCapability.ACTIVE_RULE_READS);
  const active = await readActiveRules(snap, gen, wallet);
  const records: RulesRecord[] = [];
  for (const r of active) records.push(await decodeActiveRule(snap, gen, wallet, r, pushChainNamespace));
  return records;
}

/**
 * rules.get: an enabled rule decodes; a revoked rule needs the history
 * capability (A06); an ID that was never granted is RULE_NOT_FOUND.
 */
export async function getRule(
  snap: Snapshot,
  gen: AgenticGeneration,
  wallet: Address,
  rulesId: Hex,
  pushChainNamespace: string
): Promise<RulesRecord> {
  requireCapability(gen.capabilities, AgenticCapability.ACTIVE_RULE_READS);
  const enabled = await snap.read<boolean>(
    gen.addresses.sessionEngine,
    gen.contracts.abis.engine,
    'isPermissionEnabled',
    [rulesId, wallet]
  );
  if (enabled) {
    const active = await readActiveRule(snap, gen, wallet, rulesId);
    return decodeActiveRule(snap, gen, wallet, active, pushChainNamespace);
  }
  const revoked = await scanLogs(
    snap.reader,
    { address: wallet, event: gen.contracts.events.rulesRevoked, args: { rulesId } },
    gen.startBlock,
    snap.blockNumber
  );
  if (gen.contracts.parseRulesRevoked(revoked, wallet).length > 0) {
    // No generation implements history reconstruction yet; a revoked rule is
    // reported as such rather than as an empty or missing record.
    const err = capabilityUnavailable(
      AgenticCapability.RULE_HISTORY,
      `rule ${rulesId} was revoked; ${CAPABILITY_DEPENDENCY[AgenticCapability.RULE_HISTORY]}`
    );
    throw new AgenticError(err.code, err.message, { details: { rulesId, revoked: true } });
  }
  throw new AgenticError(AGENTIC_ERROR_CODE.RULE_NOT_FOUND, `rule ${rulesId} was never granted on ${wallet}`);
}
