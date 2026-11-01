import { getAddress, isAddress, zeroAddress } from 'viem';
import {
  AgenticError,
  AGENTIC_ERROR_CODE,
  capabilityUnavailable,
  ruleConstraintLimit,
} from '../errors';
import type { RuleAsset, RuleCall, Pin } from '../agentic.types';
import type {
  AgenticPresets,
  PresetOptions,
  PresetRuleTemplate,
} from './types';
import { parseSelector } from '../codec/selectors';
import { PRESET_CATALOG, type PresetDefinition } from './catalog';
import { applyOperationLimits, nativeAsset } from './operation-limits';
import {
  defaultPresetAsset,
  PRESET_GAS_BUDGETS,
  PRESET_VALIDITY_SECONDS,
} from './default-policy';

const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
const invalid = (message: string) =>
  new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, message);
function cap(value: unknown, name: string): bigint {
  if (typeof value !== 'bigint' || value < BigInt(0) || value > MAX_UINT256)
    throw invalid(`${name} must be a uint256 bigint`);
  return value;
}
function copyCall(call: RuleCall): RuleCall {
  return {
    ...call,
    ...(call.pins
      ? {
          pins: call.pins.map((pin): Pin => {
            if (pin.account !== undefined)
              return {
                ...pin,
                ...(pin.token && typeof pin.token === 'object'
                  ? { token: { ...pin.token } }
                  : {}),
              };
            return {
              ...pin,
              arg: typeof pin.arg === 'number' ? pin.arg : [...pin.arg],
            };
          }),
        }
      : {}),
  };
}
/** Not a public registration API. Tests inject fixtures; production uses the bundled catalog. */
export function buildPresetApi(
  catalog: readonly PresetDefinition[]
): AgenticPresets {
  // Detach from the input so neither a returned template nor an input mutation changes the catalog.
  const entries = catalog.map((p) => ({
    ...p,
    chains: p.chains.map((c) => ({
      ...c,
      allowedCalls: c.allowedCalls.map((call) => ({
        ...copyCall(call),
        ...(call.budget
          ? {
              budget:
                call.budget.kind === 'native-amount' &&
                typeof call.budget.amountArg !== 'number'
                  ? { ...call.budget, amountArg: [...call.budget.amountArg] }
                  : { ...call.budget },
            }
          : {}),
      })),
    })),
  }));
  if (
    new Set(entries.map((e) => e.constant)).size !== entries.length ||
    entries.some(
      (e) =>
        new Set(e.chains.map((c) => c.chainNamespace)).size !== e.chains.length
    )
  )
    throw invalid('duplicate preset or chain in catalog');
  const api = {
    list(options?: { type?: 'CATEGORY' }) {
      if (options?.type !== undefined && options.type !== 'CATEGORY')
        throw invalid('only CATEGORY presets are supported');
      return {
        presets: entries.map((p) => ({
          type: 'CATEGORY' as const,
          constant: p.constant,
          name: p.name,
          chains: p.chains.map((c) => c.chainNamespace),
        })),
      };
    },
    get(preset: string, options: PresetOptions = {}) {
      const entry = entries.find((p) => p.constant === preset);
      if (!entry) throw invalid(`unknown preset ${String(preset)}`);
      if (!options || typeof options !== 'object' || Array.isArray(options))
        throw invalid('preset options must be an object');
      const now = Math.floor(Date.now() / 1000);
      if ('funding' in options)
        throw invalid(
          'The preset funding option is no longer supported. Remove it; preset assets and limits are always preserved.'
        );
      if (
        options.agent !== undefined &&
        (!isAddress(options.agent, { strict: false }) ||
          getAddress(options.agent) === zeroAddress)
      )
        throw invalid('preset agent must be a nonzero Push address');
      if (
        options.validUntil !== undefined &&
        (!Number.isSafeInteger(options.validUntil) ||
          options.validUntil <= now ||
          options.validUntil >= 2 ** 48)
      )
        throw invalid('preset validUntil must be a future uint48 timestamp');
      const validUntil = options.validUntil ?? now + PRESET_VALIDITY_SECONDS;
      if (options.maxGasPerCall !== undefined)
        cap(options.maxGasPerCall, 'maxGasPerCall');
      if (options.assets !== undefined && !Array.isArray(options.assets))
        throw invalid('preset assets must be an array');
      const chains =
        options.chainNamespace === undefined
          ? entry.chains
          : entry.chains.filter(
              (c) => c.chainNamespace === options.chainNamespace
            );
      if (options.chainNamespace !== undefined && !chains.length)
        throw capabilityUnavailable(
          'presetChain',
          `preset ${preset} has no approved entry for ${options.chainNamespace}`
        );
      if (!chains.length && options.assets?.length)
        throw capabilityUnavailable(
          'presetCatalog',
          `preset ${preset} has no approved app entries`
        );
      // Presets move native ETH from Push only; the app tokens are wrapped or
      // swapped on the destination chain.
      const assets = new Map<string, RuleAsset>();
      for (const asset of options.assets ?? []) {
        if (!asset || typeof asset !== 'object')
          throw invalid('preset asset must be an object');
        const chain = asset.chainNamespace ?? options.chainNamespace;
        if (!chain)
          throw invalid(
            'each asset needs chainNamespace when no chain filter is supplied'
          );
        if (!chains.some((c) => c.chainNamespace === chain))
          throw invalid(`asset chain ${chain} is outside the selected preset`);
        if (
          !asset.token ||
          !nativeAsset({ token: asset.token, maxPerCall: BigInt(0) })
        )
          throw invalid(
            "Presets send only ETH from Push. Use the zero address or the chain's ETH moveable token."
          );
        if (assets.has(chain))
          throw invalid('duplicate preset asset on the same chain');
        const maxPerCall = cap(asset.maxPerCall, 'maxPerCall');
        const maxTotal = cap(asset.maxTotal, 'maxTotal');
        if (maxPerCall === BigInt(0) || maxTotal === BigInt(0))
          throw invalid(
            'Set a positive maxPerCall and maxTotal for ETH. A missing or zero limit lets the agent spend nothing.'
          );
        assets.set(chain, {
          token:
            typeof asset.token === 'string' ? asset.token : { ...asset.token },
          maxPerCall,
          maxTotal,
        });
      }
      if (options.assets !== undefined)
        for (const chain of chains)
          if (!assets.has(chain.chainNamespace))
            throw invalid(
              `Add an ETH asset for ${chain.chainNamespace}, or pass chainNamespace to configure one chain.`
            );
      const rules: PresetRuleTemplate[] = chains.map((chain) => {
        const asset = assets.get(chain.chainNamespace) ?? defaultPresetAsset();
        const maxGasPerCall =
          options.maxGasPerCall ??
          chain.maxGasPerCall ??
          PRESET_GAS_BUDGETS[chain.chainNamespace];
        const calls = applyOperationLimits(
          chain.allowedCalls.map((c) => ({
            ...copyCall(c),
            ...(c.budget ? { budget: c.budget } : {}),
          })),
          asset.maxPerCall
        );
        if (!calls.length || calls.length > 32)
          throw capabilityUnavailable(
            'presetCalls',
            'preset must contain 1..32 allowed calls'
          );
        const conditionCount = calls.reduce(
          (n, c) => n + (c.pins?.length ?? 0),
          0
        );
        if (conditionCount > 32)
          throw ruleConstraintLimit(
            conditionCount,
            calls.length,
            chain.chainNamespace
          );
        const pairs = new Map<string, boolean>();
        for (const call of calls) {
          if (!/^[A-Za-z_$][\w$]*\(.*\)$/.test(call.selector))
            throw invalid('preset selectors must be full signatures');
          const selector = chain.chainNamespace.startsWith('eip155:')
            ? parseSelector(call.selector).selector
            : call.selector;
          const pair = `${
            chain.chainNamespace.startsWith('eip155:')
              ? call.target.toLowerCase()
              : call.target
          }:${selector}`;
          if (pairs.has(pair) && !chain.chainNamespace.startsWith('eip155:'))
            throw capabilityUnavailable(
              'presetCalls',
              'Solana does not support alternative entries for one program/instruction'
            );
          if (pairs.has(pair) && (!call.pins?.length || !pairs.get(pair)))
            throw capabilityUnavailable(
              'presetCalls',
              'an unpinned alternative would bypass restrictions for this target/function'
            );
          pairs.set(pair, !!call.pins?.length);
        }
        return {
          chainNamespace: chain.chainNamespace,
          allowedCalls: calls,
          ...(options.agent !== undefined
            ? { agent: getAddress(options.agent) }
            : {}),
          validUntil,
          assets: [asset],
          ...(maxGasPerCall !== undefined
            ? { maxGasPerCall: cap(maxGasPerCall, 'maxGasPerCall') }
            : {}),
        };
      });
      return { rules };
    },
  };
  // Expiry is generated; the overload narrows templates when the agent is supplied.
  return Object.freeze(api) as AgenticPresets;
}
export const agenticPresets = buildPresetApi(PRESET_CATALOG);
