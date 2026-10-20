import {
  getAddress,
  isAddress,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from 'viem';
import { AgenticCapability, requireCapability } from '../capabilities';
import { AGENTIC_ERROR_CODE, AgenticError, ruleErrorContext } from '../errors';
import type {
  NativeRule,
  InternalRule,
  UniversalRule,
  SolanaRule,
} from '../agentic.types';
import {
  encodeNativeTerms,
  nativeRuleToActionTerms,
  type NativeTermsWire,
} from './native';
import { buildSession, encodeEnvelope, type SessionWire } from './session';
import { encodeUniversalRule, type ResolvedUniversalRule } from './universal';
import { encodeSvmTerms, type SvmTermsWire } from './svm-terms';
import { SEND_OUTBOUND_SELECTOR } from '../contracts/v6';
import type { UniversalTermsWire } from './universal-terms';

export function isSolanaRule(rule: InternalRule): rule is SolanaRule {
  return (
    typeof (rule as SolanaRule).chainNamespace === 'string' &&
    (rule as SolanaRule).chainNamespace.startsWith('solana:')
  );
}

export function isUniversalRule(rule: InternalRule): rule is UniversalRule {
  return (
    (rule as UniversalRule).chainNamespace !== undefined && !isSolanaRule(rule)
  );
}

/** CAIP-2 chain a rule governs: omitted = the connected Push chain. */
export function ruleChain(
  rule: InternalRule,
  pushChainNamespace: string
): string {
  return (
    (rule as UniversalRule | SolanaRule).chainNamespace ?? pushChainNamespace
  );
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
  gateway?: Address;
  universal?: ReadonlyMap<UniversalRule, ResolvedUniversalRule>;
  svm?: ReadonlyMap<SolanaRule, SvmTermsWire>;
  /**
   * Addresses a native rule may never target (AGW _requireGrantableTarget /
   * URP NativeTargetIsGateway): wallet, engine, policy, validator, factory,
   * gateway. 0x0 and 0x1 are always refused.
   */
  forbiddenTargets?: readonly Address[];
}

export interface PreparedRule {
  rule: InternalRule;
  agent: Address;
  chainNamespace: string;
  session: SessionWire;
  /** Native terms, one per action in input order, when the rule is native. */
  nativeTerms?: NativeTermsWire[];
  universalTerms?: UniversalTermsWire;
  svmTerms?: SvmTermsWire;
}

/** Validate before signing. V6 permits several grants for the same agent/chain. */
export function prepareRules(
  rules: readonly InternalRule[],
  ctx: RuleEncodeContext & {
    /** Wallet owner; when given, an agent equal to it is AGENT_IS_OWNER. */
    owner?: Address;
  }
): PreparedRule[] {
  if (!Array.isArray(rules)) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      'rules must be an array'
    );
  }
  return rules.map((rule, i) => {
    try {
      if (!rule || typeof rule !== 'object') {
        throw new AgenticError(
          AGENTIC_ERROR_CODE.INVALID_RULE,
          `rules[${i}] is not an object`
        );
      }
      if (
        !isAddress(rule.agent, { strict: false }) ||
        /^0x0{40}$/i.test(rule.agent)
      ) {
        throw new AgenticError(
          AGENTIC_ERROR_CODE.INVALID_RULE,
          `rules[${i}].agent must be a non-zero Push address`
        );
      }
      const agent = getAddress(rule.agent);
      if (ctx.owner && agent === getAddress(ctx.owner)) {
        throw new AgenticError(
          AGENTIC_ERROR_CODE.AGENT_IS_OWNER,
          `rules[${i}].agent is the wallet owner; the owner uses the owner door`
        );
      }
      const chainNamespace = ruleChain(rule, ctx.pushChainNamespace);
      if (
        isUniversalRule(rule) &&
        rule.chainNamespace === ctx.pushChainNamespace
      ) {
        throw new AgenticError(
          AGENTIC_ERROR_CODE.INVALID_RULE,
          `rules[${i}] names the connected Push chain; omit chainNamespace for a native rule`
        );
      }
      if ('ref' in rule) {
        throw new AgenticError(
          AGENTIC_ERROR_CODE.INVALID_RULE,
          'InternalRule ref is not supported; remove it from the input'
        );
      }

      if (isSolanaRule(rule)) {
        requireCapability(
          ctx.capabilities,
          AgenticCapability.UNIVERSAL_SVM_RULES
        );
        const terms = ctx.svm?.get(rule);
        if (!terms || !ctx.gateway)
          throw new AgenticError(
            AGENTIC_ERROR_CODE.INVALID_RULE,
            'SVM rules require resolved wallet context and validated instruction layouts'
          );
        return {
          rule,
          agent,
          chainNamespace,
          svmTerms: terms,
          session: buildSession({
            validator: ctx.validator,
            rulesPolicy: ctx.rulesPolicy,
            agent,
            actions: [
              {
                target: ctx.gateway,
                selector: SEND_OUTBOUND_SELECTOR,
                initData: encodeEnvelope(
                  chainNamespace,
                  encodeSvmTerms(terms, ctx.nowSeconds)
                ),
              },
            ],
          }),
        };
      }
      if (isUniversalRule(rule)) {
        return encodeUniversalRule(rule, ctx);
      }
      requireCapability(ctx.capabilities, AgenticCapability.NATIVE_RULES);
      const actions = nativeRuleToActionTerms(rule as NativeRule, ctx).map(
        (a) => a.terms
      );
      const forbidden = [
        '0x0000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000001',
        ...(ctx.forbiddenTargets ?? []),
      ].map((a) => a.toLowerCase());
      actions.forEach((terms, j) => {
        if (forbidden.includes(terms.target.toLowerCase())) {
          const where =
            actions.length > 1 ? `rules[${i}].actions[${j}]` : `rules[${i}]`;
          throw new AgenticError(
            AGENTIC_ERROR_CODE.INVALID_RULE,
            `${where}.target ${terms.target} is a wallet-infrastructure address the contracts refuse as a native target`
          );
        }
      });
      // One rule, one rule ID: every action is a separate (target, selector)
      // entry of the same session, each with its own stored terms.
      const session = buildSession({
        validator: ctx.validator,
        agent,
        rulesPolicy: ctx.rulesPolicy,
        actions: actions.map((terms) => ({
          target: terms.target,
          selector: terms.selector,
          initData: encodeEnvelope(chainNamespace, encodeNativeTerms(terms)),
        })),
      });
      return { rule, agent, chainNamespace, session, nativeTerms: actions };
    } catch (error) {
      throw ruleErrorContext(error, i, rule?.chainNamespace);
    }
  });
}
