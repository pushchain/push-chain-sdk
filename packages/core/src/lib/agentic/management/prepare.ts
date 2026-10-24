import { isPublicRule, normalizePublicRule } from '../public-rule';
import { prepareRuleInput } from './rule-inputs';
import { preparePublicSvmRule } from './svm-public';
import type { SvmTermsWire } from '../codec/svm-terms';
import { getAddress, zeroAddress, type Address } from 'viem';
import { CHAIN, VM } from '../../constants/enums';
import { CHAIN_INFO } from '../../constants/chain';
import { AGENTIC_DEFAULTS, withDefault } from '../codec/defaults';
import { isUniversalRule, isSolanaRule, prepareRules } from '../codec/rules';
import {
  validateUniversalRuleShape,
  type ResolvedUniversalRule,
} from '../codec/universal';
import {
  forbiddenTargets,
  verifyPolicyVersion,
  type AgenticGeneration,
} from '../deployments';
import { AgenticCapability, requireCapability } from '../capabilities';
import {
  AGENTIC_ERROR_CODE,
  AgenticError,
  tokenRouteUnavailable,
  ruleErrorContext,
} from '../errors';
import type { InternalRule, UniversalRule, SolanaRule } from '../agentic.types';
import type { AgenticRuntime } from '../runtime';
import { Snapshot } from '../reads/snapshot';
import { resolveRuleDestination } from './destination';

import {
  PRC20_SOURCE_ABI,
  readGasPrc20,
  readOriginToken,
} from '../contracts/prc20-metadata';

/** Resolve wallet-dependent wire inputs without signing or mutating authority. */
export async function prepareWalletRules(
  runtime: AgenticRuntime,
  gen: AgenticGeneration,
  owner: Address,
  wallet: Address,
  inputs: readonly InternalRule[],
  snap: Snapshot
) {
  const rules = await Promise.all(
    inputs.map(async (rule, ruleIndex) => {
      try {
        return isPublicRule(rule)
          ? await normalizePublicRule(
              await prepareRuleInput(rule, runtime, owner, snap),
              wallet,
              runtime
            )
          : rule;
      } catch (error) {
        throw ruleErrorContext(error, ruleIndex, rule?.chainNamespace);
      }
    })
  );
  if (rules.length) await verifyPolicyVersion(runtime.reader, gen);
  const svm = new Map<SolanaRule, SvmTermsWire>();
  const universal = new Map<UniversalRule, ResolvedUniversalRule>();
  for (const [ruleIndex, rule] of rules.entries()) {
    try {
      if (rule && isSolanaRule(rule)) {
        requireCapability(
          gen.capabilities,
          AgenticCapability.UNIVERSAL_SVM_RULES
        );
        svm.set(rule, await preparePublicSvmRule(runtime, snap, wallet, rule));
        continue;
      }
      if (!isUniversalRule(rule)) continue;
      if (rule.chainNamespace.startsWith('solana:'))
        requireCapability(
          gen.capabilities,
          AgenticCapability.UNIVERSAL_SVM_RULES
        );
      validateUniversalRuleShape(rule, runtime.nowSeconds());
      requireCapability(
        gen.capabilities,
        rule.chainNamespace.startsWith('solana:')
          ? AgenticCapability.UNIVERSAL_SVM_RULES
          : AgenticCapability.UNIVERSAL_EVM_RULES
      );
      const chain = rule.chainNamespace as CHAIN;
      if (CHAIN_INFO[chain]?.vm !== VM.EVM)
        throw new AgenticError(
          AGENTIC_ERROR_CODE.INVALID_RULE,
          `unsupported EVM rule chain ${chain}`
        );
      const cea = await resolveRuleDestination(runtime, wallet, chain);
      const assets = rule.assets.length
        ? rule.assets.map((a) => ({
            token:
              typeof a.token === 'string' && getAddress(a.token) === zeroAddress
                ? undefined
                : a.token,
            maxPerCall: a.maxPerCall,
            maxTotal: withDefault(
              a.maxTotal,
              AGENTIC_DEFAULTS.universal.assetMaxTotal
            ),
          }))
        : [{ token: undefined, maxPerCall: BigInt(0), maxTotal: BigInt(0) }];
      const resolved = [];
      for (const [assetIndex, asset] of assets.entries()) {
        let token: Address;
        if (asset.token === undefined) token = await readGasPrc20(snap, chain);
        else {
          try {
            token = runtime.resolvePrc20(asset.token, chain);
          } catch (cause) {
            throw tokenRouteUnavailable(
              cause,
              typeof asset.token === 'string'
                ? asset.token
                : asset.token.address,
              chain,
              assetIndex
            );
          }
        }
        if (token === zeroAddress)
          throw new AgenticError(
            AGENTIC_ERROR_CODE.INVALID_RULE,
            `no gas PRC20 registered for ${chain}`
          );
        const namespace = await snap.read<string>(
          token,
          PRC20_SOURCE_ABI,
          'SOURCE_CHAIN_NAMESPACE'
        );
        if (namespace !== chain)
          throw new AgenticError(
            AGENTIC_ERROR_CODE.ASSET_CHAIN_MISMATCH,
            `PRC20 ${token} belongs to ${namespace}, not ${chain}`
          );
        if (asset.token !== undefined) {
          const expected =
            typeof asset.token === 'string'
              ? getAddress(asset.token)
              : getAddress(asset.token.address);
          if (expected === zeroAddress) {
            if ((await readGasPrc20(snap, chain)) !== getAddress(token))
              throw new AgenticError(
                AGENTIC_ERROR_CODE.INVALID_RULE,
                'resolved token is not the registered native gas token'
              );
          } else {
            const source = await readOriginToken(snap, token, chain);
            if (source !== expected)
              throw new AgenticError(
                AGENTIC_ERROR_CODE.INVALID_RULE,
                `PRC20 ${token} represents ${source}, not requested token ${expected}`
              );
          }
        }
        resolved.push({
          token: getAddress(token),
          maxPerCall: asset.maxPerCall,
          maxTotal: asset.maxTotal,
        });
      }
      universal.set(rule, { expectedCEA: getAddress(cea), assets: resolved });
    } catch (error) {
      throw ruleErrorContext(error, ruleIndex, rule?.chainNamespace);
    }
  }
  return prepareRules(rules, {
    owner,
    pushChainNamespace: runtime.pushChainNamespace,
    validator: gen.addresses.sessionValidator,
    rulesPolicy: gen.addresses.rulesPolicy,
    gateway: gen.addresses.gateway,
    capabilities: gen.capabilities,
    nowSeconds: runtime.nowSeconds(),
    forbiddenTargets: forbiddenTargets(gen, wallet),
    universal,
    svm,
  });
}
