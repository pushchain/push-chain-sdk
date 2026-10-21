import { PublicKey } from '@solana/web3.js';
import { getAddress, hexToBytes, zeroAddress } from 'viem';
import type { Address, Hex } from 'viem';
import { CHAIN, VM } from '../../constants/enums';
import { CHAIN_INFO } from '../../constants/chain';
import type { SolanaRule, DecodedSolanaRule } from '../agentic.types';
import type { AgenticRuntime } from '../runtime';
import type { Snapshot } from '../reads/snapshot';
import { readGasPrc20 } from '../contracts/prc20-metadata';
import { resolveSvmContext } from './svm-context';
import { createSvmMetadataProvider } from './svm-metadata';
import { deriveAgwSvmAta, svmKey } from '../codec/svm-accounts';
import { compileSvmIdlRule } from '../codec/svm-idl';
import { svmInvalid } from '../codec/svm-terms';
import { validateSvmTerms } from '../codec/svm-terms';
import { tokenRouteUnavailable } from '../errors';

export function svmMetadata(runtime: AgenticRuntime) {
  return (
    runtime.svmMetadata ??
    createSvmMetadataProvider({
      [CHAIN.SOLANA_DEVNET]: {
        gatewayProgram: CHAIN_INFO[CHAIN.SOLANA_DEVNET].lockerContract ?? '',
        rpcUrls: CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC,
      },
    })
  );
}
export async function preparePublicSvmRule(
  runtime: AgenticRuntime,
  snap: Snapshot,
  wallet: Address,
  rule: SolanaRule | DecodedSolanaRule
) {
  const chain = rule.chainNamespace as CHAIN;
  if (CHAIN_INFO[chain]?.vm !== VM.SVM)
    throw svmInvalid('unknown Solana chain');
  if (!Array.isArray(rule.assets) || rule.assets.length > 8)
    throw svmInvalid('assets must contain at most eight entries');
  // URP compares the attached PC to this ceiling, so zero refuses every send.
  if (rule.maxGasPerCall === BigInt(0))
    throw svmInvalid('maxGasPerCall must be positive');
  const raw = 'format' in rule && rule.format === 'decoded';
  const outputTokens = 'outputTokens' in rule ? rule.outputTokens : undefined;
  if (outputTokens !== undefined && !Array.isArray(outputTokens))
    throw svmInvalid('outputTokens must be an array of mint addresses');
  const metadata = svmMetadata(runtime);
  const requested = rule.assets.length
    ? rule.assets
    : [{ token: zeroAddress, maxPerCall: BigInt(0), maxTotal: BigInt(0) }];
  const caps: { token: Address; maxPerCall: bigint; maxTotal: bigint }[] = [];
  const tokenAccounts = new Map<Hex, Hex>(),
    mints = new Set<Hex>();
  const sources: { key?: Hex; token: Address }[] = [];
  for (const [assetIndex, asset] of requested.entries()) {
    const source =
      typeof asset.token === 'string' ? asset.token : asset.token?.address;
    if (typeof source !== 'string')
      throw svmInvalid('asset token requires an address');
    if (
      typeof asset.token !== 'string' &&
      'chain' in asset.token &&
      asset.token.chain !== chain
    )
      throw svmInvalid('asset token belongs to another chain');
    const native =
      source === zeroAddress ||
      /^0x0{64}$/.test(source) ||
      source === '11111111111111111111111111111111';
    const key = native ? undefined : svmKey(source);
    const sourceToken =
      typeof asset.token === 'string' && key
        ? new PublicKey(hexToBytes(key)).toBase58()
        : asset.token;
    let token: Address;
    if (native) token = await readGasPrc20(snap, chain);
    else {
      try {
        token = runtime.resolvePrc20(sourceToken, chain);
      } catch (cause) {
        throw tokenRouteUnavailable(cause, source, chain, assetIndex);
      }
    }
    if (caps.some((c) => c.token === getAddress(token)))
      throw svmInvalid('duplicate SVM asset');
    caps.push({
      token: getAddress(token),
      maxPerCall: asset.maxPerCall,
      maxTotal: asset.maxTotal ?? BigInt(0),
    });
    sources.push({ key, token });
    if (key) mints.add(key);
  }
  const outputs = (outputTokens ?? []).map((mint) => ({ mint }));
  outputs.forEach((o) => mints.add(svmKey(o.mint)));
  const ctx = await resolveSvmContext(
    snap,
    wallet,
    rule.chainNamespace,
    caps,
    metadata,
    outputs,
    runtime.network
  );
  // Validate the PRC20 actually represents the requested source mint, not merely its chain.
  const { resolveSvmAssets } = await import('./svm-context');
  const resolved = await resolveSvmAssets(
    snap,
    rule.chainNamespace,
    caps,
    metadata,
    runtime.network
  );
  resolved.forEach((a, i) => {
    if (
      sources[i].key
        ? a.kind !== 'spl' || svmKey(a.mint) !== sources[i].key
        : a.kind !== 'native'
    )
      throw svmInvalid('PRC20 source does not match requested asset');
  });
  for (const mint of mints) {
    const token = await metadata.mint(rule.chainNamespace, mint);
    if (svmKey(token.mint) !== mint)
      throw svmInvalid('mint resolver returned another mint');
    tokenAccounts.set(mint, deriveAgwSvmAta(ctx.expectedCEA, token));
  }
  if (raw) {
    const stored = rule as DecodedSolanaRule;
    if (
      svmKey(stored.expectedCEA) !== ctx.expectedCEA ||
      svmKey(stored.gatewayProgram) !== ctx.gatewayProgram
    )
      throw svmInvalid('decoded rule belongs to another wallet or gateway');
    if (
      ctx.ceaAccounts.some(
        (a) => !stored.ceaAccounts.some((s) => svmKey(s) === a)
      )
    )
      throw svmInvalid('decoded rule omits a required wallet value account');
    const terms = { ...stored, assets: caps };
    validateSvmTerms(terms, runtime.nowSeconds());
    return terms;
  }
  return compileSvmIdlRule(
    rule as SolanaRule,
    { ...ctx, tokenAccounts },
    runtime.nowSeconds()
  );
}
