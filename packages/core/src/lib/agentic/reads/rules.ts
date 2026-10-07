import { readSvmConfig } from './svm';
import { PRC20_SOURCE_ABI, readGasPrc20 } from '../contracts/prc20-metadata';
import { svmKey } from '../codec/svm-accounts';
import {
  getAddress,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { CHAIN } from '../../constants/enums';
import {
  AgenticCapability,
  requireCapability,
} from '../capabilities';
import type { AgenticGeneration } from '../deployments';
import type {
  NativeConfigRead,
  ModeRead,
  UniversalConfigRead,
} from '../contracts/v4';
import { configId } from '../codec/ids';
import { nativeTermsToRule } from '../codec/native';
import { universalTermsToRule } from '../codec/universal';
import { readOriginToken } from '../contracts/prc20-metadata';
import { chainHash } from '../codec/rules';
import {
  AGENTIC_ERROR_CODE,
  AgenticError,
} from '../errors';
import type { AgenticHex, RulesRecord } from '../agentic.types';
import { Snapshot } from './snapshot';

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
    snap.read<readonly Hex[]>(
      gen.addresses.sessionEngine,
      gen.contracts.abis.engine,
      'getEnabledActions',
      [wallet, rulesId]
    ),
  ]);
  if (actionIds.length === 0) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INCONSISTENT_READ,
      `enabled rule ${rulesId} has no enabled actions`
    );
  }
  const modes = await Promise.all(
    actionIds.map((a) =>
      snap.read<ModeRead>(
        gen.addresses.rulesPolicy,
        gen.contracts.abis.policy,
        'getMode',
        [configId(wallet, rulesId, a), wallet]
      )
    )
  );
  const first = modes[0];
  if (
    !modes.every(
      (m) =>
        m.initialized &&
        m.chainHash === first.chainHash &&
        m.mode === first.mode
    )
  ) {
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
export function chainFromHash(
  hash: Hex,
  pushChainNamespace: string
): string | undefined {
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
      {
        details: {
          wallet,
          agent,
          destinationChain,
          blockNumber: snap.blockNumber,
        },
      }
    );
  }
  if (matches.length > 1) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.AMBIGUOUS_RULE,
      `${matches.length} enabled rules on ${wallet} name ${agent} for ${destinationChain}`,
      {
        hint: 'Multiple enabled rules match this agent and chain. Inspect details.rulesIds and ask the owner to resolve the overlap; no transaction was submitted.',
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
    if (rule.vm === 1) {
      requireCapability(
        gen.capabilities,
        AgenticCapability.UNIVERSAL_SVM_RULES
      );
      const stored = await readSvmConfig(
        snap,
        gen,
        wallet,
        rule,
        pushChainNamespace
      );
      const cfg = stored.config;
      const gas = await readGasPrc20(snap, stored.chainNamespace);
      const assets = await Promise.all(
        cfg.assets.map(async (a) => ({
          token:
            getAddress(a.token) === gas
              ? zeroAddress
              : svmKey(
                  await snap.read<string>(
                    a.token,
                    PRC20_SOURCE_ABI,
                    'SOURCE_TOKEN_ADDRESS'
                  )
                ),
          maxPerCall: a.maxPerCall,
          maxTotal: a.maxTotal,
        }))
      );
      return {
        rulesId: rule.rulesId,
        enabled: true,
        agent: rule.agent,
        chainNamespace: stored.chainNamespace,
        validUntil: Number(cfg.validUntil),
        rule: {
          format: 'decoded',
          agent: rule.agent,
          chainNamespace: stored.chainNamespace,
          validUntil: Number(cfg.validUntil),
          expectedCEA: cfg.expectedCEA,
          gatewayProgram: cfg.gatewayProgram,
          maxGasPerCall: cfg.maxGasPerCall,
          assets,
          ceaAccounts: cfg.ceaAccounts,
          programs: cfg.programs,
          pins: cfg.pins,
          dataPins: cfg.dataPins,
        },
      };
    }
    if (rule.vm !== 0)
      throw new AgenticError(
        AGENTIC_ERROR_CODE.RULE_READ_FAILED,
        'unknown universal VM'
      );
    requireCapability(gen.capabilities, AgenticCapability.UNIVERSAL_EVM_RULES);
    const chain = chainFromHash(rule.chainHash, pushChainNamespace);
    if (!chain || !chain.startsWith('eip155:'))
      throw new AgenticError(
        AGENTIC_ERROR_CODE.RULE_READ_FAILED,
        'unknown EVM rule chain'
      );
    const cfg = await snap.read<UniversalConfigRead>(
      gen.addresses.rulesPolicy,
      gen.contracts.abis.policy,
      'getConfig',
      [configId(wallet, rule.rulesId, rule.actionIds[0]), wallet]
    );
    if (!cfg.initialized)
      throw new AgenticError(
        AGENTIC_ERROR_CODE.INCONSISTENT_READ,
        'uninitialized universal rule'
      );
    if (
      !cfg.assets.length ||
      cfg.assets.length > 8 ||
      !cfg.allowedCalls.length ||
      cfg.allowedCalls.length > 32 ||
      cfg.expectedCEA === zeroAddress
    )
      throw new AgenticError(
        AGENTIC_ERROR_CODE.INCONSISTENT_READ,
        'invalid stored universal rule shape'
      );
    const tokens = await Promise.all(
      cfg.assets.map((a) => readOriginToken(snap, a.token, chain))
    );
    return {
      rulesId: rule.rulesId,
      enabled: true,
      chainNamespace: chain,
      agent: rule.agent,
      validUntil: Number(cfg.validUntil),
      rule: universalTermsToRule(
        cfg,
        rule.agent,
        chain as `eip155:${string}`,
        tokens
      ),
    };
  }
  if (rule.mode !== MODE_NATIVE) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.RULE_READ_FAILED,
      `rule ${rule.rulesId} has unknown mode ${rule.mode}`
    );
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
    rule: nativeTermsToRule(cfg, rule.agent),
  };
}

/** Native spend counters for the update assertion. */
export async function readNativeSpend(
  snap: Snapshot,
  gen: AgenticGeneration,
  wallet: Address,
  rule: ActiveRule,
  action: Hex = rule.actionIds[0]
): Promise<{
  configId: Hex;
  valueSpent: bigint;
  amountSpent: bigint;
  callsUsed: number;
}> {
  const id = configId(wallet, rule.rulesId, action);
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

export async function readUniversalSpend(
  snap: Snapshot,
  gen: AgenticGeneration,
  wallet: Address,
  rule: ActiveRule
): Promise<{ configId: Hex; expectedSpent: bigint[] }> {
  const id = configId(wallet, rule.rulesId, rule.actionIds[0]);
  const fn = rule.vm === 1 ? 'getSvmConfig' : 'getConfig';
  const cfg = await snap.read<{
    initialized: boolean;
    assets: readonly { spent: bigint }[];
  }>(gen.addresses.rulesPolicy, gen.contracts.abis.policy, fn, [id, wallet]);
  if (!cfg.initialized)
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INCONSISTENT_READ,
      'uninitialized universal spend config'
    );
  return { configId: id, expectedSpent: cfg.assets.map((a) => a.spent) };
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
  for (const r of active)
    records.push(
      await decodeActiveRule(snap, gen, wallet, r, pushChainNamespace)
    );
  return records;
}

/**
 * rules.get returns enabled records only. Unknown/revoked IDs are deliberately
 * indistinguishable without historical reconstruction, which is outside v1.
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
  throw new AgenticError(
    AGENTIC_ERROR_CODE.RULE_NOT_FOUND,
    `rule ${rulesId} is not enabled on ${wallet} (unknown or revoked; v1 has no rule history)`
  );
}
