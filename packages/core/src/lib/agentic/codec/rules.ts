import { getAddress, isAddress, keccak256, toBytes, type Address, type Hex } from 'viem';
import { AgenticCapability, requireCapability } from '../capabilities';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import type { NativeRule, Rule, UniversalRule } from '../agentic.types';
import { encodeNativeTerms, nativeRuleToTerms, type NativeTermsWire } from './native';
import { buildSession, encodeEnvelope, type SessionWire } from './session';
import { encodeUniversalRule } from './universal';

export function isUniversalRule(rule: Rule): rule is UniversalRule {
  return (rule as UniversalRule).chainNamespace !== undefined;
}

/** CAIP-2 chain a rule governs: omitted = the connected Push chain. */
export function ruleChain(rule: Rule, pushChainNamespace: string): string {
  return isUniversalRule(rule) ? rule.chainNamespace : pushChainNamespace;
}

export function chainHash(chainNamespace: string): Hex {
  return keccak256(toBytes(chainNamespace));
}

export interface RuleEncodeContext {
  /** 'eip155:<pushChainId>' of the connected network. */
  pushChainNamespace: string;
  validator: Address;
  rulesPolicy: Address;
  capabilities: ReadonlySet<AgenticCapability>;
  nowSeconds: number;
  /**
   * Addresses a native rule may never target (AGW _requireGrantableTarget /
   * URP NativeTargetIsGateway): wallet, engine, policy, validator, factory,
   * gateway. 0x0 and 0x1 are always refused.
   */
  forbiddenTargets?: readonly Address[];
}

export interface PreparedRule {
  rule: Rule;
  agent: Address;
  chainNamespace: string;
  session: SessionWire;
  /** Native terms when the rule is native (used for previews and assertions). */
  nativeTerms?: NativeTermsWire;
}

/**
 * Validate and encode rules before any signature (spec 1.b checks plus
 * codec validation). `owner` is the wallet owner's Push address and
 * `existing` the currently enabled (agent, chain) pairs that are NOT being
 * replaced — both feed the AGENT_IS_OWNER / DUPLICATE_RULE checks.
 */
export function prepareRules(
  rules: readonly Rule[],
  ctx: RuleEncodeContext & {
    /** Wallet owner; when given, an agent equal to it is AGENT_IS_OWNER. */
    owner?: Address;
    existing?: readonly { agent: Address; chainNamespace: string; rulesId: Hex }[];
  }
): PreparedRule[] {
  if (!Array.isArray(rules)) {
    throw new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, 'rules must be an array');
  }
  const seen = new Map<string, string>();
  for (const e of ctx.existing ?? []) {
    seen.set(pairKey(e.agent, e.chainNamespace), `existing rule ${e.rulesId}`);
  }
  return rules.map((rule, i) => {
    if (!rule || typeof rule !== 'object') {
      throw new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, `rules[${i}] is not an object`);
    }
    if (!isAddress(rule.agent, { strict: false }) || /^0x0{40}$/i.test(rule.agent)) {
      throw new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, `rules[${i}].agent must be a non-zero Push address`);
    }
    const agent = getAddress(rule.agent);
    if (ctx.owner && agent === getAddress(ctx.owner)) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.AGENT_IS_OWNER,
        `rules[${i}].agent is the wallet owner; the owner uses the owner door`
      );
    }
    const chainNamespace = ruleChain(rule, ctx.pushChainNamespace);
    if (isUniversalRule(rule) && rule.chainNamespace === ctx.pushChainNamespace) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.INVALID_RULE,
        `rules[${i}] names the connected Push chain; omit chainNamespace for a native rule`
      );
    }
    const key = pairKey(agent, chainNamespace);
    const clash = seen.get(key);
    if (clash) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.DUPLICATE_RULE,
        `rules[${i}] repeats agent ${agent} on ${chainNamespace} (${clash})`,
        { hint: 'One rule per agent per chain. Use rules.update to replace an existing rule.' }
      );
    }
    seen.set(key, `rules[${i}]`);
    if (rule.ref !== undefined) {
      requireCapability(ctx.capabilities, AgenticCapability.GRANT_REF);
    }

    if (isUniversalRule(rule)) {
      return encodeUniversalRule(rule, ctx);
    }
    requireCapability(ctx.capabilities, AgenticCapability.NATIVE_RULES);
    const { terms } = nativeRuleToTerms(rule as NativeRule, ctx);
    const forbidden = [
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000001',
      ...(ctx.forbiddenTargets ?? []),
    ].map((a) => a.toLowerCase());
    if (forbidden.includes(terms.target.toLowerCase())) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.INVALID_RULE,
        `rules[${i}].target ${terms.target} is a wallet-infrastructure address the contracts refuse as a native target`
      );
    }
    const session = buildSession({
      validator: ctx.validator,
      agent,
      rulesPolicy: ctx.rulesPolicy,
      actions: [
        {
          target: terms.target,
          selector: terms.selector,
          initData: encodeEnvelope(chainNamespace, encodeNativeTerms(terms)),
        },
      ],
    });
    return { rule, agent, chainNamespace, session, nativeTerms: terms };
  });
}

function pairKey(agent: Address, chainNamespace: string): string {
  return `${agent.toLowerCase()}|${chainNamespace}`;
}
