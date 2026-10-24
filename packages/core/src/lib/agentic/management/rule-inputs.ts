import {
  getAddress,
  isAddress,
  parseUnits,
  zeroAddress,
  type Address,
} from 'viem';
import { CHAIN, PUSH_NETWORK, VM } from '../../constants/enums';
import { CHAIN_INFO } from '../../constants/chain';
import {
  MOVEABLE_TOKENS,
  isMoveableTokenSet,
  type MoveableToken,
} from '../../constants/tokens';
import { exactAgenticRoutes, resolveAgenticPrc20 } from '../token-routes';
import type {
  AuthoredRule,
  InternalRule,
  RuleAsset,
  RuleAssetInput,
  RuleCall,
} from '../agentic.types';
import type { AgenticRuntime } from '../runtime';
import type { Snapshot } from '../reads/snapshot';
import { readOriginToken } from '../contracts/prc20-metadata';
import { AgenticError, AGENTIC_ERROR_CODE } from '../errors';

/** Contract limit: assets per universal rule. */
const MAX_ASSETS = 8;
const refuse = (message: string, reason: string, field?: string) =>
  new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, message, {
    details: { reason, ...(field ? { field } : {}) },
  });

// Default limits for ALL, by the SDK registry's own symbol and decimals (never
// caller metadata). Amounts are token quantities, not USD valuations.
const DEFAULT_LIMITS: Readonly<Record<string, readonly [string, string]>> = {
  USDT: ['10', '100'],
  USDC: ['10', '100'],
  DAI: ['10', '100'],
  ETH: ['0.001', '0.01'],
  WETH: ['0.001', '0.01'],
  stETH: ['0.001', '0.01'],
  BNB: ['0.01', '0.1'],
  SOL: ['0.01', '0.1'],
};
function withDefaultLimits(
  token: MoveableToken | string,
  symbol: string,
  decimals: number,
  chain: string
): RuleAsset {
  const limits = DEFAULT_LIMITS[symbol];
  if (!limits)
    throw new AgenticError(
      AGENTIC_ERROR_CODE.CAPABILITY_UNAVAILABLE,
      `No default limit for ${symbol} on ${chain}`,
      { details: { capability: 'allTokenDefaults', dependency: symbol } }
    );
  return {
    token,
    maxPerCall: parseUnits(limits[0], decimals),
    maxTotal: parseUnits(limits[1], decimals),
  };
}

/** Every token Push can send to `chainNamespace`, each with its default limits:
 * the SDK registry plus exact node routes (Circle USDC `.old` is listed
 * separately from the routed mock USDC), deduplicated by Push PRC20. */
export function allRoutableAssets(
  chainNamespace: string,
  options: { network?: PUSH_NETWORK } = {}
): RuleAsset[] {
  const network = options.network ?? PUSH_NETWORK.TESTNET_DONUT;
  const seen = new Set<string>();
  const out: RuleAsset[] = [];
  const add = (
    token: MoveableToken | string,
    address: string,
    symbol: string,
    decimals: number
  ) => {
    let prc20: Address;
    try {
      prc20 = resolveAgenticPrc20(
        { chain: chainNamespace, address },
        network
      ).address;
    } catch {
      return; // listed in the registry but not routable from Push
    }
    if (seen.has(prc20)) return;
    seen.add(prc20);
    out.push(withDefaultLimits(token, symbol, decimals, chainNamespace));
  };
  for (const token of MOVEABLE_TOKENS[chainNamespace as CHAIN] ?? [])
    add({ ...token }, token.address, token.symbol, token.decimals);
  for (const route of exactAgenticRoutes(chainNamespace, network))
    add(getAddress(route.source), route.source, route.symbol, route.decimals);
  if (!out.length)
    throw refuse(
      `No token can be sent from Push to ${chainNamespace}`,
      'ALL_UNAVAILABLE'
    );
  if (out.length > MAX_ASSETS)
    throw refuse(
      `ALL expands to ${out.length} tokens on ${chainNamespace}; a rule holds at most eight assets`,
      'ALL_TOO_MANY'
    );
  return out;
}

const sourceKey = (token: MoveableToken | string): string => {
  const address = typeof token === 'string' ? token : token.address;
  if (typeof token !== 'string' && token.mechanism === 'native')
    return zeroAddress;
  return isAddress(address, { strict: false })
    ? address.toLowerCase()
    : address;
};
function expandAll(
  rule: AuthoredRule,
  network: PUSH_NETWORK,
  transferable: boolean
): RuleAsset[] | undefined {
  const assets = rule.assets ?? [];
  const markers = assets.filter((a) => isMoveableTokenSet(a?.token));
  if (!markers.length) return undefined;
  const chain = rule.chainNamespace;
  for (const marker of markers) {
    if (
      marker.maxPerCall !== undefined ||
      (marker as RuleAssetInput).maxTotal !== undefined
    )
      throw refuse(
        'ALL uses each token’s default limits. Remove maxPerCall and maxTotal, or list the tokens individually.',
        'ALL_WITH_LIMITS',
        'assets'
      );
    if (!chain || (marker.token as { chain: string }).chain !== chain)
      throw new AgenticError(
        AGENTIC_ERROR_CODE.ASSET_CHAIN_MISMATCH,
        `ALL for ${
          (marker.token as { chain: string }).chain
        } does not match the rule's chain ${chain ?? 'Push Chain'}`,
        { details: { field: 'assets' } }
      );
  }
  // Without apps the rule can only transfer ERC20s, so ALL leaves native out.
  const expanded = allRoutableAssets(chain as string, { network }).filter(
    (a) => !transferable || sourceKey(a.token) !== zeroAddress
  );
  // An explicitly listed token replaces its default entry.
  for (const asset of assets) {
    if (isMoveableTokenSet(asset.token)) continue;
    const explicit = asset as RuleAsset;
    const key = sourceKey(explicit.token);
    const i = expanded.findIndex((a) => sourceKey(a.token) === key);
    if (i >= 0) expanded[i] = explicit;
    else expanded.push(explicit);
  }
  if (expanded.length > MAX_ASSETS)
    throw refuse(
      `ALL plus the listed tokens make ${expanded.length} assets; a rule holds at most eight`,
      'ALL_TOO_MANY',
      'assets'
    );
  return expanded;
}

/** The owner's own EVM address: the Push EOA, or the EVM origin of its UEA. */
function ownerEvmAddress(
  runtime: AgenticRuntime,
  owner: Address
): Address | undefined {
  if (getAddress(runtime.signerPushAccount()) !== getAddress(owner))
    throw new AgenticError(
      AGENTIC_ERROR_CODE.NOT_WALLET_OWNER,
      'tokens-only rules pin transfers to the connected owner'
    );
  if (runtime.signerIsPushNative()) return getAddress(owner);
  const origin = runtime.signerOrigin();
  return CHAIN_INFO[origin.chain]?.vm === VM.EVM &&
    isAddress(origin.address, { strict: false })
    ? getAddress(origin.address)
    : undefined;
}

async function transferCalls(
  rule: AuthoredRule,
  assets: RuleAsset[],
  runtime: AgenticRuntime,
  owner: Address,
  snap: Snapshot
): Promise<RuleCall[]> {
  const chain = rule.chainNamespace as string;
  if (assets.some((a) => sourceKey(a.token) === zeroAddress))
    throw refuse(
      'Native ETH and BNB cannot be transferred by a rule. Remove them, or add an app.',
      'TOKENS_ONLY_NATIVE',
      'assets'
    );
  const recipients: { address: Address; owner: boolean }[] = [];
  const ownerAddress = ownerEvmAddress(runtime, owner);
  if (ownerAddress) recipients.push({ address: ownerAddress, owner: true });
  for (const [i, to] of (rule.transferTo ?? []).entries()) {
    if (!isAddress(to, { strict: false }) || getAddress(to) === zeroAddress)
      throw refuse(
        'Enter a valid recipient address.',
        'TRANSFER_RECIPIENT_INVALID',
        `transferTo[${i}]`
      );
    if (!recipients.some((r) => r.address === getAddress(to)))
      recipients.push({ address: getAddress(to), owner: false });
  }
  if (!recipients.length)
    throw refuse(
      'Name at least one recipient in transferTo: an owner from Solana has no address on this network.',
      'TRANSFER_RECIPIENT_REQUIRED',
      'transferTo'
    );
  const calls: RuleCall[] = [];
  for (const asset of assets) {
    // The ERC20 lives on the destination chain; a Push token names its source.
    const target =
      typeof asset.token === 'object' && 'prc20Address' in asset.token
        ? await readOriginToken(
            snap,
            getAddress(
              (asset.token as MoveableToken & { prc20Address: string })
                .prc20Address
            ),
            chain
          )
        : getAddress(
            typeof asset.token === 'string' ? asset.token : asset.token.address
          );
    for (const recipient of recipients)
      calls.push({
        target,
        selector: 'transfer(address,uint256)',
        pins: [
          { arg: 0, expected: recipient.address },
          { arg: 1, max: asset.maxPerCall },
        ],
        app: 'Token transfer',
        label: recipient.owner
          ? 'Transfer to owner'
          : 'Transfer to named recipient',
      });
  }
  return calls;
}

/** Authoring conveniences resolved before normalization, once the owner and
 * network are known: MOVEABLE ALL markers, and tokens-only EVM rules, which
 * become ERC20 transfers to the owner plus any `transferTo` recipients. */
export async function prepareRuleInput(
  input: InternalRule,
  runtime: AgenticRuntime,
  owner: Address,
  snap: Snapshot
): Promise<InternalRule> {
  const rule = input as unknown as AuthoredRule;
  if ('format' in rule) return input;
  const noCalls = !rule.allowedCalls?.length;
  const chain = rule.chainNamespace;
  const expanded = expandAll(
    rule,
    runtime.network,
    noCalls && !!chain?.startsWith('eip155:')
  );
  const assets = (expanded ?? rule.assets ?? []) as RuleAsset[];
  if (rule.transferTo !== undefined) {
    if (!Array.isArray(rule.transferTo))
      throw refuse('transferTo must be an array', 'TRANSFER_RECIPIENT_INVALID');
    if (!noCalls)
      throw refuse(
        'transferTo applies only to rules without allowed functions. Add the transfer as an allowed function instead.',
        'TRANSFER_TO_WITH_CALLS',
        'transferTo'
      );
    if (!chain?.startsWith('eip155:'))
      throw refuse(
        'transferTo is only available on EVM networks.',
        'TOKENS_ONLY_UNSUPPORTED',
        'transferTo'
      );
  }
  let allowedCalls = rule.allowedCalls;
  if (noCalls && assets.length && chain?.startsWith('solana:'))
    throw refuse(
      'A Solana rule needs an app: tokens alone cannot be transferred there.',
      'TOKENS_ONLY_UNSUPPORTED',
      'allowedCalls'
    );
  if (noCalls && assets.length && chain?.startsWith('eip155:'))
    allowedCalls = await transferCalls(rule, assets, runtime, owner, snap);
  if (
    !expanded &&
    allowedCalls === rule.allowedCalls &&
    !('transferTo' in rule)
  )
    return input;
  // Spread keeps the public-input marker symbol.
  const out = { ...rule, ...(expanded ? { assets: expanded } : {}) };
  delete out.transferTo;
  if (allowedCalls !== undefined) out.allowedCalls = allowedCalls;
  return out as unknown as InternalRule;
}
