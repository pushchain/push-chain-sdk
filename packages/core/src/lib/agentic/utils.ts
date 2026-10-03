import { getAddress, isHex, type Address, type Hex } from 'viem';
import { PUSH_NETWORK } from '../constants/enums';
import { AgenticCapability, CAPABILITY_DEPENDENCY } from './capabilities';
import { E704D5B_CAPABILITIES } from './deployments';
import { actionId as actionIdRaw, configId as configIdRaw, deriveWallet as deriveWalletRaw, rulesId as rulesIdRaw } from './codec/ids';
import { decodeNativeTerms, nativeTermsToRule } from './codec/native';
import { prepareRules } from './codec/rules';
import { parseSelector } from './codec/selectors';
import { decodeEnvelope, decodeSession, encodeSession } from './codec/session';
import { AGENTIC_ERROR_CODE, AgenticError, capabilityUnavailable } from './errors';
import { pushChainNamespaceFor } from './chain';
import type { AgenticHex, Rule, Selector } from './agentic.types';

/**
 * Generation context for the pure helpers. PROVISIONAL public shape (A04,
 * Harsh H4.1): the spec's helper signatures omit the validator / factory /
 * implementation inputs the results depend on, so they are explicit here.
 */
export interface RulesEncodeContext {
  /** Connected Push network, or an explicit 'eip155:<id>' native chain. */
  network?: PUSH_NETWORK;
  pushChainNamespace?: string;
  validator: Address;
  rulesPolicy: Address;
  /** Wallet owner, for the AGENT_IS_OWNER check. */
  owner?: Address;
  /** Defaults to the current time. */
  nowSeconds?: number;
}

function nativeNamespace(ctx: { network?: PUSH_NETWORK; pushChainNamespace?: string }): string {
  if (ctx.pushChainNamespace) return ctx.pushChainNamespace;
  return pushChainNamespaceFor(ctx.network ?? PUSH_NETWORK.TESTNET_DONUT);
}

/** PushChain.utils.agentic — pure; no RPC. */
export const agenticUtils = {
  /** The ID a grant with this grantNonce produces. Chain is not part of the hash. */
  rulesId(agent: Address, grantNonce: bigint | number, ctx: { validator: Address }): AgenticHex {
    return rulesIdRaw({
      validator: getAddress(ctx.validator),
      agent: getAddress(agent),
      grantNonce: BigInt(grantNonce),
    }) as AgenticHex;
  },

  /** Hash of one allowed call: keccak256(target ‖ selector). */
  actionId(target: Address, selector: Selector | 'value-only'): AgenticHex {
    return actionIdRaw(getAddress(target), parseSelector(selector).selector) as AgenticHex;
  },

  /** Key of one allowed call's stored config under one rule on one wallet. */
  configId(wallet: Address, rulesId: Hex, actionId: Hex): AgenticHex {
    return configIdRaw(getAddress(wallet), rulesId, actionId) as AgenticHex;
  },

  /** Any-owner wallet address. */
  deriveWallet(
    owner: Address,
    index: bigint | number,
    ctx: { factory: Address; walletImplementation: Address }
  ): Address {
    return deriveWalletRaw({
      factory: getAddress(ctx.factory),
      walletImplementation: getAddress(ctx.walletImplementation),
      owner: getAddress(owner),
      index,
    });
  },

  /**
   * Encode rules into the grant `Session` bytes, one per rule, in order.
   * Native rules only today; universal rules fail with CAPABILITY_UNAVAILABLE (A05).
   */
  encodeRules(rules: readonly Rule[], ctx: RulesEncodeContext): AgenticHex[] {
    return prepareRules(rules, {
      owner: ctx.owner ? getAddress(ctx.owner) : undefined,
      pushChainNamespace: nativeNamespace(ctx),
      validator: getAddress(ctx.validator),
      rulesPolicy: getAddress(ctx.rulesPolicy),
      capabilities: E704D5B_CAPABILITIES,
      nowSeconds: ctx.nowSeconds ?? Math.floor(Date.now() / 1000),
    }).map((p) => encodeSession(p.session) as AgenticHex);
  },

  /** Inverse of encodeRules for one Session encoding. */
  decodeRules(bytes: Hex, ctx: { network?: PUSH_NETWORK; pushChainNamespace?: string } = {}): Rule {
    if (!isHex(bytes)) throw new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, 'decodeRules expects hex bytes');
    const session = decodeSession(bytes);
    if (session.actions.length !== 1 || session.actions[0].actionPolicies.length !== 1) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.RULE_READ_FAILED,
        'only single-action rules (one URP policy) are representable as a public Rule'
      );
    }
    const agent = getAddress(`0x${session.sessionValidatorInitData.slice(26, 66)}`);
    const { chainNamespace, body } = decodeEnvelope(session.actions[0].actionPolicies[0].initData);
    if (chainNamespace !== nativeNamespace(ctx)) {
      throw capabilityUnavailable(
        AgenticCapability.UNIVERSAL_EVM_RULES,
        `${chainNamespace} is a universal rule; ${CAPABILITY_DEPENDENCY[AgenticCapability.UNIVERSAL_EVM_RULES]}`
      );
    }
    return nativeTermsToRule(decodeNativeTerms(body), agent, `0x${'00'.repeat(32)}`);
  },

  /** Canonical card compiler — not available until the shared schema exists (A08). */
  compileCard(_card: unknown, _userInput: unknown, _ctx: unknown): never {
    throw capabilityUnavailable(
      AgenticCapability.COMPILE_CARD,
      CAPABILITY_DEPENDENCY[AgenticCapability.COMPILE_CARD]
    );
  },
};
