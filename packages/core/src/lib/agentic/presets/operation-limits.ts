import { getAddress, zeroAddress } from 'viem';
import type { RuleAsset, RuleCall } from '../agentic.types';
import type { PresetCallDefinition } from './catalog';
import type { PresetCallIssue } from './types';

export const assetAddress = (asset: RuleAsset): string =>
  typeof asset.token === 'string' ? asset.token : asset.token.address;
export const nativeAsset = (asset: RuleAsset): boolean =>
  assetAddress(asset) === zeroAddress ||
  (typeof asset.token !== 'string' && asset.token.mechanism === 'native');

/** Compile reviewed protocol argument positions. No exchange-rate or share guesses. */
export function applyOperationLimits(
  definitions: readonly PresetCallDefinition[],
  assets: RuleAsset[]
) {
  const matches = (definition: PresetCallDefinition): RuleAsset[] => {
    const b = definition.budget;
    if (!b) return [];
    if (b.kind === 'native-value') return assets.filter(nativeAsset);
    if (b.kind === 'fixed-token')
      return assets.filter(
        (a) =>
          !nativeAsset(a) && getAddress(assetAddress(a)) === getAddress(b.token)
      );
    if (b.kind === 'token-argument')
      return assets.filter(
        (a) =>
          !nativeAsset(a) &&
          (!b.tokens ||
            b.tokens.some((t) => getAddress(t) === getAddress(assetAddress(a))))
      );
    return [];
  };
  const previewAll = !definitions.some((d) => matches(d).length > 0);
  const calls: RuleCall[] = [];
  const disabledCalls: PresetCallIssue[] = [],
    excludedCalls: PresetCallIssue[] = [];
  const knownTokens = new Set<string>();
  let enabled = false;
  for (const definition of definitions) {
    const { budget, ...call } = definition;
    if (!budget || budget.kind === 'setup') {
      calls.push(call);
      if (!budget) enabled = true; // Non-budgeted internal fixture entries only.
      continue;
    }
    const info = {
      target: call.target,
      selector: call.selector,
      ...(call.app ? { app: call.app } : {}),
    };
    if (budget.kind === 'unsupported') {
      excludedCalls.push({
        ...info,
        reason: budget.reason,
        ...(budget.alternative ? { alternative: budget.alternative } : {}),
      });
      continue;
    }
    if (budget.kind === 'fixed-token')
      knownTokens.add(getAddress(budget.token));
    if (budget.kind === 'native-value') knownTokens.add(zeroAddress);
    if (budget.kind === 'token-argument')
      budget.tokens?.forEach((t) => knownTokens.add(getAddress(t)));
    const selected = matches(definition);
    if (!selected.length && !previewAll) {
      excludedCalls.push({
        ...info,
        reason: 'UNSELECTED_TOKEN',
        ...(budget.kind === 'fixed-token'
          ? { token: getAddress(budget.token) }
          : {}),
      });
      continue;
    }
    for (const asset of selected.length ? selected : [undefined]) {
      const maximum = asset?.maxPerCall ?? BigInt(0);
      const pins = [...(call.pins ?? [])];
      if (budget.kind === 'token-argument' && asset)
        pins.push({
          arg: budget.tokenArg,
          expected: getAddress(assetAddress(asset)),
        });
      if (budget.kind !== 'native-value')
        pins.push({ arg: budget.amountArg, max: maximum });
      calls.push({
        ...call,
        ...(pins.length ? { pins } : {}),
        ...(budget.kind === 'native-value' ? { maxValue: maximum } : {}),
      });
      if (maximum > BigInt(0)) enabled = true;
      else
        disabledCalls.push({
          ...info,
          reason: asset
            ? 'ZERO_CAP'
            : assets.length
            ? 'UNSELECTED_TOKEN'
            : 'TOKEN_REQUIRED',
          ...(asset
            ? { token: assetAddress(asset) }
            : budget.kind === 'fixed-token'
            ? { token: getAddress(budget.token) }
            : {}),
        });
    }
  }
  return {
    calls,
    enabled,
    disabledCalls,
    excludedCalls,
    knownTokens: [...knownTokens],
  };
}
