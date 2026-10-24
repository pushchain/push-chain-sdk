import { parseUnits, zeroAddress } from 'viem';
import type { RuleAsset } from '../agentic.types';

/** Preset-only permission policy. Ordinary rule authoring retains zero defaults.
 * Amounts are ETH quantities sent from Push, not USD valuations or destination
 * lifetime caps.
 */
export const PRESET_VALIDITY_SECONDS = 7 * 24 * 60 * 60;

// Explicit profiles keep future chains from inheriting an unreviewed budget.
// 20 PC is a ceiling, not the amount charged: execution obtains a fresh quote.
export const PRESET_GAS_BUDGETS: Readonly<Record<string, bigint>> =
  Object.fromEntries(
    ['eip155:11155111', 'eip155:84532', 'eip155:421614'].map((chain) => [
      chain,
      parseUnits('20', 18),
    ])
  );

export function defaultPresetAsset(): RuleAsset {
  return {
    token: zeroAddress,
    maxPerCall: parseUnits('0.001', 18),
    maxTotal: parseUnits('0.01', 18),
  };
}
