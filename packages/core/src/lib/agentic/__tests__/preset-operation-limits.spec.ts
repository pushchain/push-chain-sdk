import { getAddress, zeroAddress } from 'viem';
import { applyOperationLimits, nativeAsset } from '../presets/operation-limits';
import type { PresetCallDefinition } from '../presets/catalog';
import { MOVEABLE_TOKEN_CONSTANTS } from '../../constants/tokens';

const target = getAddress('0x0000000000000000000000000000000000001234');
it('maps the native cap onto maxValue and amount pins and leaves fixed calls unchanged', () => {
  const definitions: PresetCallDefinition[] = [
    { target, selector: 'deposit()', budget: { kind: 'native-value' } },
    {
      target,
      selector: 'approve(address,uint256)',
      pins: [{ arg: 0, expected: target }],
      budget: { kind: 'native-amount', amountArg: 1 },
    },
    {
      target,
      selector: 'swap((address,uint256))',
      budget: { kind: 'native-amount', amountArg: [0, 1] },
    },
    {
      target,
      selector: 'fixed(uint256)',
      pins: [{ arg: 0, max: BigInt(9) }],
    },
  ];
  const calls = applyOperationLimits(definitions, BigInt(7));
  expect(calls).toEqual([
    { target, selector: 'deposit()', maxValue: BigInt(7) },
    {
      target,
      selector: 'approve(address,uint256)',
      pins: [
        { arg: 0, expected: target },
        { arg: 1, max: BigInt(7) },
      ],
    },
    {
      target,
      selector: 'swap((address,uint256))',
      pins: [{ arg: [0, 1], max: BigInt(7) }],
    },
    { target, selector: 'fixed(uint256)', pins: [{ arg: 0, max: BigInt(9) }] },
  ]);
  expect(calls.some((c) => 'budget' in c)).toBe(false);
  expect(definitions[1].pins).toHaveLength(1);
});
it('recognizes the zero address and native moveable tokens as ETH', () => {
  const max = BigInt(1);
  expect(nativeAsset({ token: zeroAddress, maxPerCall: max })).toBe(true);
  expect(
    nativeAsset({
      token: MOVEABLE_TOKEN_CONSTANTS.ARBITRUM_SEPOLIA.ETH,
      maxPerCall: max,
    })
  ).toBe(true);
  expect(nativeAsset({ token: target, maxPerCall: max })).toBe(false);
});
