import { getAddress, isAddress, zeroAddress } from 'viem';
import {
  AgenticError,
  AGENTIC_ERROR_CODE,
  capabilityUnavailable,
} from '../errors';
import type { RuleAsset, RuleCall, Pin } from '../agentic.types';
import type {
  AgenticPresets,
  PresetOptions,
  PresetRuleTemplate,
  PresetChainReadiness,
  PresetConfigurationIssue,
} from './types';
import { parseSelector } from '../codec/selectors';
import { PRESET_CATALOG, type PresetDefinition } from './catalog';
import { applyOperationLimits, assetAddress } from './operation-limits';

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
      allowedCalls: c.allowedCalls.map((call) => ({
        ...copyCall(call),
        ...(call.budget
          ? {
              budget: {
                ...call.budget,
                ...(call.budget.kind === 'token-argument' && call.budget.tokens
                  ? { tokens: [...call.budget.tokens] }
                  : {}),
              },
            }
          : {}),
      })),
      approvals: c.approvals?.map((a) => ({
        ...a,
        ...(a.tokens ? { tokens: [...a.tokens] } : {}),
      })),
      swapRouters: c.swapRouters?.map((r) => ({ ...r })),
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
      const readiness: PresetChainReadiness[] = [];
      const rules: PresetRuleTemplate[] = chains.map((chain) => {
        const selectedAssets = assets.get(chain.chainNamespace) ?? [];
        const limits = applyOperationLimits(
          chain.allowedCalls.map((c) => ({
            ...copyCall(c),
            ...(c.budget ? { budget: c.budget } : {}),
          })),
          selectedAssets
        );
        const calls = limits.calls;
        if (chain.swapRouters?.length) {
          const tokens = assets.get(chain.chainNamespace) ?? [];
          if (
            tokens.some(
              (a) =>
                tokenAddress(a.token) === zeroAddress ||
                (typeof a.token !== 'string' && a.token.mechanism === 'native')
            )
          )
            throw invalid(
              'DEX token pins require explicit ERC20 addresses; use wrapped-native tokens instead of the native marker'
            );
          // Keep discovery useful before a swap pair is selected. These review
          // calls cannot spend input tokens: the amount maximum is explicitly zero.
          // Re-run get with both tokens to generate the executable pair pins.
          if (tokens.length < 2)
            for (const router of chain.swapRouters)
              for (const exactInput of [true, false])
                calls.push({
                  target: router.address,
                  selector: `${
                    exactInput ? 'exactInputSingle' : 'exactOutputSingle'
                  }((address,address,uint24,address,uint256,uint256,uint160))`,
                  pins: [
                    ...(tokens.length
                      ? [
                          {
                            arg: [0, 0],
                            expected: getAddress(tokenAddress(tokens[0].token)),
                          },
                        ]
                      : []),
                    { arg: [0, 3], expected: 'agentic:wallet' },
                    { arg: [0, exactInput ? 4 : 5], max: BigInt(0) },
                  ],
                  app: router.app,
                  label: `${
                    exactInput ? 'Swap exact input' : 'Swap exact output'
                  } (select two tokens to enable)`,
                });
          for (const router of chain.swapRouters)
            for (const input of tokens)
              for (const output of tokens) {
                if (
                  tokenAddress(input.token).toLowerCase() ===
                  tokenAddress(output.token).toLowerCase()
                )
                  continue;
                for (const exactInput of [true, false])
                  calls.push({
                    target: router.address,
                    selector: `${
                      exactInput ? 'exactInputSingle' : 'exactOutputSingle'
                    }((address,address,uint24,address,uint256,uint256,uint160))`,
                    pins: [
                      {
                        arg: [0, 0],
                        expected: getAddress(tokenAddress(input.token)),
                      },
                      {
                        arg: [0, 1],
                        expected: getAddress(tokenAddress(output.token)),
                      },
                      { arg: [0, 3], expected: 'agentic:wallet' },
                      { arg: [0, exactInput ? 4 : 5], max: input.maxPerCall },
                    ],
                    app: router.app,
                    label: exactInput
                      ? 'Swap exact input'
                      : 'Swap exact output',
                  });
              }
        }
        if (chain.swapRouters?.length) {
          const swaps = calls.filter((c) => c.selector.startsWith('exact'));
          for (const c of swaps) {
            const positive = c.pins?.some(
              (p) => 'max' in p && p.max !== undefined && p.max > BigInt(0)
            );
            if (positive) limits.enabled = true;
            else
              limits.disabledCalls.push({
                target: c.target,
                selector: c.selector,
                app: c.app,
                reason:
                  selectedAssets.length < 2 ? 'TOKEN_REQUIRED' : 'ZERO_CAP',
              });
          }
        }
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
            if (
              approval.token &&
              getAddress(token) !== getAddress(approval.token)
            )
              continue;
            if (
              approval.tokens &&
              !approval.tokens.some((t) => getAddress(t) === getAddress(token))
            )
              continue;
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
        if (calls.reduce((n, c) => n + (c.pins?.length ?? 0), 0) > 32)
          throw capabilityUnavailable(
            'presetPins',
            'preset expansion exceeds 32 pins; reduce the token list or split rules across wallets'
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
        const issues: PresetConfigurationIssue[] = [];
        if (!options.agent)
          issues.push({
            code: 'AGENT_REQUIRED',
            message: 'Choose the agent Push address.',
          });
        if (!options.validUntil)
          issues.push({
            code: 'EXPIRY_REQUIRED',
            message: 'Choose an expiry.',
          });
        if (
          (options.maxGasPerCall ?? chain.maxGasPerCall ?? BigInt(0)) ===
          BigInt(0)
        )
          issues.push({
            code: 'GAS_BUDGET_REQUIRED',
            message: 'Set a positive PC gas budget per outbound.',
          });
        if (!selectedAssets.length)
          issues.push({
            code: 'ASSETS_REQUIRED',
            message:
              'Choose tokens and their limits, then regenerate this preset.',
          });
        if (chain.swapRouters?.length && selectedAssets.length < 2)
          issues.push({
            code: 'TOKEN_PAIR_REQUIRED',
            message: 'Choose both swap tokens, then regenerate this preset.',
          });
        if (!limits.enabled)
          issues.push({
            code: 'NO_ENABLED_OPERATION',
            message: 'No asset operation has a positive per-call limit.',
          });
        readiness.push({
          chainNamespace: chain.chainNamespace,
          ready: issues.length === 0,
          issues,
          disabledCalls: limits.disabledCalls,
          excludedCalls: limits.excludedCalls,
          knownTokens: limits.knownTokens,
          zeroBridgeLimits: selectedAssets
            .filter(
              (a) => a.maxPerCall === BigInt(0) || a.maxTotal === BigInt(0)
            )
            .map(assetAddress),
        });
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
          ...((options.maxGasPerCall ?? chain.maxGasPerCall) !== undefined
            ? {
                maxGasPerCall: cap(
                  options.maxGasPerCall ?? chain.maxGasPerCall,
                  'maxGasPerCall'
                ),
              }
            : {}),
        };
      });
      return {
        rules,
        readiness: {
          ready: readiness.length > 0 && readiness.every((c) => c.ready),
          chains: readiness,
        },
      };
    },
  };
  // The overload narrows templates only when both required fields were supplied and validated.
  return Object.freeze(api) as AgenticPresets;
}
export const agenticPresets = buildPresetApi(PRESET_CATALOG);
