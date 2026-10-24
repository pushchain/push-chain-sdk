import { parseUnits, zeroAddress } from 'viem';
import { agenticPresets } from '../presets';
import {
  defaultPresetAsset,
  PRESET_GAS_BUDGETS,
  PRESET_VALIDITY_SECONDS,
} from '../presets/default-policy';

const chainNamespace = 'eip155:84532' as const;
it('defaults to a small ETH budget, a 20 PC gas ceiling and seven days', () => {
  const before = Math.floor(Date.now() / 1000);
  const [rule] = agenticPresets.get('LENDING', { chainNamespace }).rules;
  expect(rule.assets).toEqual([defaultPresetAsset()]);
  expect(defaultPresetAsset()).toEqual({
    token: zeroAddress,
    maxPerCall: parseUnits('0.001', 18),
    maxTotal: parseUnits('0.01', 18),
  });
  expect(rule.maxGasPerCall).toBe(PRESET_GAS_BUDGETS[chainNamespace]);
  expect(PRESET_GAS_BUDGETS[chainNamespace]).toBe(parseUnits('20', 18));
  expect(rule.validUntil).toBeGreaterThanOrEqual(
    before + PRESET_VALIDITY_SECONDS
  );
});
it('preserves an explicit gas budget, including zero', () => {
  for (const maxGasPerCall of [BigInt(0), parseUnits('5', 18)])
    expect(
      agenticPresets.get('DEXES', { chainNamespace, maxGasPerCall }).rules[0]
        .maxGasPerCall
    ).toBe(maxGasPerCall);
});
it('returns fresh default assets so callers cannot change the policy', () => {
  const a = agenticPresets.get('DEXES', { chainNamespace }).rules[0];
  a.assets![0].maxTotal = BigInt(1);
  expect(
    agenticPresets.get('DEXES', { chainNamespace }).rules[0].assets![0].maxTotal
  ).toBe(parseUnits('0.01', 18));
});
