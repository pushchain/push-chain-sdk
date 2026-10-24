import { zeroAddress } from 'viem';
import type { RuleAsset, RuleCall } from '../agentic.types';
import type { PresetCallDefinition } from './catalog';

export const assetAddress = (asset: RuleAsset): string =>
  typeof asset.token === 'string' ? asset.token : asset.token.address;
export const nativeAsset = (asset: RuleAsset): boolean =>
  assetAddress(asset) === zeroAddress ||
  (typeof asset.token !== 'string' && asset.token.mechanism === 'native');

/** Fill the reviewed native-ETH caps: maxValue on the wrap, amount maxima on
 * every call that spends the wrapped ETH. */
export function applyOperationLimits(
  definitions: readonly PresetCallDefinition[],
  maxPerCall: bigint
): RuleCall[] {
  return definitions.map(({ budget, ...call }) => {
    if (budget?.kind === 'native-value')
      return { ...call, maxValue: maxPerCall };
    if (budget?.kind === 'native-amount')
      return {
        ...call,
        pins: [
          ...(call.pins ?? []),
          { arg: budget.amountArg, max: maxPerCall },
        ],
      };
    return call;
  });
}
