import { decodeSvmTerms, validateSvmTerms } from './codec/svm-terms';
import { svmKey } from './codec/svm-accounts';
import { getAddress, isHex, zeroAddress, type Address, type Hex } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../constants/enums';
import { MOVEABLE_TOKENS } from '../constants/tokens';
import { getPRC20Address } from '../universal/prc20-address';
import { AgenticCapability } from './capabilities';
import { V5_CAPABILITIES } from './deployments';
import {
  actionId as actionIdRaw,
  configId as configIdRaw,
  deriveWallet as deriveWalletRaw,
  rulesId as rulesIdRaw,
} from './codec/ids';
import { decodeNativeTerms, nativeTermsToRule } from './codec/native';
import { prepareRules } from './codec/rules';
import { parseSelector } from './codec/selectors';
import { decodeEnvelope, decodeSession, encodeSession } from './codec/session';
import {
  AGENTIC_ERROR_CODE,
  AgenticError,
  capabilityUnavailable,
} from './errors';
import { pushChainNamespaceFor } from './chain';
import { decodeUniversalTerms } from './codec/universal-terms';
import { universalTermsToRule } from './codec/universal';
import type {
  AgenticHex,
  Rule,
  Selector,
  DecodedSolanaRule,
} from './agentic.types';
import type { UniversalRule } from './agentic.types';
import type { ResolvedUniversalRule } from './codec/universal';

/**
 * Internal generation context. Harsh H4.1 (October 4): deployment inputs
 * are implementation details, not public helper parameters.
 */
export interface RulesEncodeContext {
  /** Connected Push network, or an explicit 'eip155:<id>' native chain. */
  network?: PUSH_NETWORK;
  pushChainNamespace?: string;
  validator: Address;
  rulesPolicy: Address;
  gateway?: Address;
  universal?: ReadonlyMap<UniversalRule, ResolvedUniversalRule>;
  /** Wallet owner, for the AGENT_IS_OWNER check. */
  owner?: Address;
  /** Defaults to the current time. */
  nowSeconds?: number;
}

function nativeNamespace(ctx: {
  network?: PUSH_NETWORK;
  pushChainNamespace?: string;
}): string {
  if (ctx.pushChainNamespace) return ctx.pushChainNamespace;
  return pushChainNamespaceFor(ctx.network ?? PUSH_NETWORK.TESTNET_DONUT);
}

/** Internal codecs and identities — not exported from the package entry point. */
export const internalAgenticUtils = {
  /** The ID a grant with this grantNonce produces. Chain is not part of the hash. */
  rulesId(
    agent: Address,
    grantNonce: bigint | number,
    ctx: { validator: Address }
  ): AgenticHex {
    return rulesIdRaw({
      validator: getAddress(ctx.validator),
      agent: getAddress(agent),
      grantNonce: BigInt(grantNonce),
    }) as AgenticHex;
  },

  /** Hash of one allowed call: keccak256(target ‖ selector). */
  actionId(target: Address, selector: Selector | 'value-only'): AgenticHex {
    return actionIdRaw(
      getAddress(target),
      parseSelector(selector).selector
    ) as AgenticHex;
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
   * EVM universal rules require wallet/token resolution in the internal context.
   */
  encodeRules(rules: readonly Rule[], ctx: RulesEncodeContext): AgenticHex[] {
    return prepareRules(rules, {
      owner: ctx.owner ? getAddress(ctx.owner) : undefined,
      pushChainNamespace: nativeNamespace(ctx),
      validator: getAddress(ctx.validator),
      rulesPolicy: getAddress(ctx.rulesPolicy),
      gateway: ctx.gateway,
      universal: ctx.universal,
      capabilities: V5_CAPABILITIES,
      nowSeconds: ctx.nowSeconds ?? Math.floor(Date.now() / 1000),
    }).map((p) => encodeSession(p.session) as AgenticHex);
  },

  /** Inverse of encodeRules for one Session encoding. */
  decodeRules(
    bytes: Hex,
    ctx: { network?: PUSH_NETWORK; pushChainNamespace?: string } = {}
  ): Rule | DecodedSolanaRule {
    if (!isHex(bytes))
      throw new AgenticError(
        AGENTIC_ERROR_CODE.INVALID_RULE,
        'decodeRules expects hex bytes'
      );
    const session = decodeSession(bytes);
    if (
      session.actions.length !== 1 ||
      session.actions[0].actionPolicies.length !== 1
    ) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.RULE_READ_FAILED,
        'only single-action rules (one URP policy) are representable as a public Rule'
      );
    }
    const agent = getAddress(
      `0x${session.sessionValidatorInitData.slice(26, 66)}`
    );
    const { chainNamespace, body } = decodeEnvelope(
      session.actions[0].actionPolicies[0].initData
    );
    if (chainNamespace !== nativeNamespace(ctx)) {
      if (chainNamespace.startsWith('solana:')) {
        const terms = decodeSvmTerms(body);
        validateSvmTerms(terms, -1);
        const assets = terms.assets.map((a) => {
          const chain = chainNamespace as CHAIN;
          const token = (MOVEABLE_TOKENS[chain] ?? []).find((candidate) => {
            try {
              return (
                getAddress(
                  getPRC20Address(
                    { chain, address: candidate.address },
                    { network: ctx.network ?? PUSH_NETWORK.TESTNET_DONUT }
                  ).address
                ) === getAddress(a.token)
              );
            } catch {
              return false;
            }
          });
          if (!token)
            throw new AgenticError(
              AGENTIC_ERROR_CODE.RULE_READ_FAILED,
              'SVM source token is absent from the static registry; use wallet.rules.get()'
            );
          return {
            token:
              token.mechanism === 'native'
                ? zeroAddress
                : svmKey(token.address),
            maxPerCall: a.maxPerCall,
            maxTotal: a.maxTotal,
          };
        });
        return {
          ...terms,
          format: 'decoded',
          agent,
          chainNamespace: chainNamespace as `solana:${string}`,
          assets,
        };
      }
      if (!chainNamespace.startsWith('eip155:'))
        throw capabilityUnavailable(
          AgenticCapability.UNIVERSAL_SVM_RULES,
          'unsupported universal chain namespace'
        );
      let terms;
      try {
        terms = decodeUniversalTerms(body);
      } catch (cause) {
        throw new AgenticError(
          AGENTIC_ERROR_CODE.RULE_READ_FAILED,
          'malformed universal terms',
          { cause }
        );
      }
      const chain = chainNamespace as CHAIN;
      const network = ctx.network ?? PUSH_NETWORK.TESTNET_DONUT;
      const tokens = terms.assets.map((asset) => {
        const token = (MOVEABLE_TOKENS[chain] ?? []).find((candidate) => {
          try {
            return (
              getAddress(
                getPRC20Address(
                  { chain, address: candidate.address },
                  { network }
                ).address
              ) === getAddress(asset.token)
            );
          } catch {
            return false;
          }
        });
        if (!token)
          throw new AgenticError(
            AGENTIC_ERROR_CODE.RULE_READ_FAILED,
            `PRC20 ${asset.token} is not in the static ${chain} token registry`,
            {
              hint: 'Use wallet.rules.get() for on-chain source-token resolution.',
            }
          );
        return token.mechanism === 'native'
          ? zeroAddress
          : getAddress(token.address);
      });
      return universalTermsToRule(
        terms,
        agent,
        chainNamespace as `eip155:${string}`,
        tokens
      );
    }
    return nativeTermsToRule(decodeNativeTerms(body), agent);
  },
};

/** Public helpers requiring no contract deployment context. */
export const agenticUtils = {
  actionId: internalAgenticUtils.actionId,
  configId: internalAgenticUtils.configId,
  decodeRules: internalAgenticUtils.decodeRules,
};
