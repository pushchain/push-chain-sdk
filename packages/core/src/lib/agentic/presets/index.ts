import { getAddress, isAddress, zeroAddress } from 'viem';
import {
  AgenticError,
  AGENTIC_ERROR_CODE,
  capabilityUnavailable,
} from '../errors';
import type { RuleAsset, RuleCall } from '../agentic.types';
import type {
  AgenticPresets,
  PresetOptions,
  PresetRuleTemplate,
} from './types';
import { parseSelector } from '../codec/selectors';
import { PRESET_CATALOG, type PresetDefinition } from './catalog';

const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
const invalid = (message: string) =>
  new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, message);
function cap(value: unknown, name: string): bigint {
  if (value === undefined) return BigInt(0);
  if (typeof value !== 'bigint' || value < BigInt(0) || value > MAX_UINT256)
    throw invalid(`${name} must be a uint256 bigint`);
  return value;
}
function copyCall(call: RuleCall): RuleCall {
  return {
    ...call,
    ...(call.pins
      ? {
          pins: call.pins.map((p) => ({
            ...p,
            ...('token' in p && p.token && typeof p.token === 'object'
              ? { token: { ...p.token } }
              : {}),
          })),
        }
      : {}),
  };
}
function tokenAddress(token: RuleAsset['token']): string {
  const address = typeof token === 'string' ? token : token?.address;
  if (typeof address !== 'string' || !address.trim())
    throw invalid('preset asset requires a token address');
  return address;
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
      allowedCalls: c.allowedCalls.map(copyCall),
      approvals: c.approvals?.map((a) => ({ ...a })),
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
      if (
        options.agent !== undefined &&
        (!isAddress(options.agent, { strict: false }) ||
          getAddress(options.agent) === zeroAddress)
      )
        throw invalid('preset agent must be a nonzero Push address');
      if (
        options.validUntil !== undefined &&
        (!Number.isSafeInteger(options.validUntil) ||
          options.validUntil <= Math.floor(Date.now() / 1000) ||
          options.validUntil >= 2 ** 48)
      )
        throw invalid('preset validUntil must be a future uint48 timestamp');
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
      const assets = new Map<string, RuleAsset[]>();
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
        const address = tokenAddress(asset.token);
        if (
          chain.startsWith('eip155:') &&
          !isAddress(address, { strict: false })
        )
          throw invalid('EVM preset asset requires an EVM address');
        const group = assets.get(chain) ?? [];
        const key = chain.startsWith('eip155:')
          ? address.toLowerCase()
          : address;
        if (
          group.some(
            (a) =>
              (chain.startsWith('eip155:')
                ? tokenAddress(a.token).toLowerCase()
                : tokenAddress(a.token)) === key
          )
        )
          throw invalid('duplicate preset asset on the same chain');
        group.push({
          token:
            typeof asset.token === 'string' ? asset.token : { ...asset.token },
          maxPerCall: cap(asset.maxPerCall, 'maxPerCall'),
          maxTotal: cap(asset.maxTotal, 'maxTotal'),
        });
        assets.set(chain, group);
      }
      const rules: PresetRuleTemplate[] = chains.map((chain) => {
        const calls = chain.allowedCalls.map(copyCall);
        const approvals = new Set<string>();
        for (const asset of assets.get(chain.chainNamespace) ?? []) {
          const token = tokenAddress(asset.token);
          if (
            token === zeroAddress ||
            (typeof asset.token !== 'string' &&
              asset.token.mechanism === 'native')
          )
            continue;
          for (const approval of chain.approvals ?? []) {
            if (!chain.chainNamespace.startsWith('eip155:'))
              throw capabilityUnavailable(
                'presetApproval',
                'Solana approvals require a separately reviewed instruction template'
              );
            const spender = getAddress(approval.spender);
            const target = getAddress(token);
            const approvalKey = `${target}:${spender}`;
            if (approvals.has(approvalKey)) continue;
            approvals.add(approvalKey);
            calls.push({
              target,
              selector: 'approve(address,uint256)',
              pins: [
                { arg: 0, expected: spender },
                { arg: 1, max: asset.maxPerCall },
              ],
              app: approval.app,
              label: 'Approve token spending',
            });
          }
        }
        if (!calls.length || calls.length > 32)
          throw capabilityUnavailable(
            'presetCalls',
            'preset must contain 1..32 allowed calls including approvals'
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
          ...(options.validUntil !== undefined
            ? { validUntil: options.validUntil }
            : {}),
          ...(options.assets !== undefined
            ? { assets: assets.get(chain.chainNamespace) ?? [] }
            : {}),
          ...(chain.maxGasPerCall !== undefined
            ? { maxGasPerCall: cap(chain.maxGasPerCall, 'maxGasPerCall') }
            : {}),
        };
      });
      return { rules };
    },
  };
  // The overload narrows templates only when both required fields were supplied and validated.
  return Object.freeze(api) as AgenticPresets;
}
export const agenticPresets = buildPresetApi(PRESET_CATALOG);
