import { PublicKey } from '@solana/web3.js';
import { getAddress, hexToBytes, zeroAddress } from 'viem';
import type { Address, Hex } from 'viem';
import { CHAIN, VM } from '../../constants/enums';
import { CHAIN_INFO } from '../../constants/chain';
import type { SolanaRule } from '../agentic.types';
import type { AgenticRuntime } from '../runtime';
import type { Snapshot } from '../reads/snapshot';
import { readGasPrc20 } from '../contracts/prc20-metadata';
import { resolveSvmContext } from './svm-context';
import { createSvmMetadataProvider } from './svm-metadata';
import { deriveAgwSvmAta, svmKey } from '../codec/svm-accounts';
import { compileSvmIdlRule } from '../codec/svm-idl';
import { svmInvalid } from '../codec/svm-terms';
import { UINT256_MAX } from '../codec/defaults';

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
  rule: SolanaRule
) {
  const chain = rule.chainNamespace as CHAIN;
  if (CHAIN_INFO[chain]?.vm !== VM.SVM)
    throw svmInvalid('unknown Solana chain');
  if (!Array.isArray(rule.assets) || rule.assets.length > 8)
    throw svmInvalid('assets must contain at most eight entries');
  if (rule.outputTokens !== undefined && !Array.isArray(rule.outputTokens))
    throw svmInvalid('outputTokens must be an array of mint addresses');
  const metadata = svmMetadata(runtime);
  const requested = rule.assets.length
    ? rule.assets
    : [{ token: zeroAddress, maxPerCall: BigInt(0), maxTotal: BigInt(0) }];
  const caps: { token: Address; maxPerCall: bigint; maxTotal: bigint }[] = [];
  const tokenAccounts = new Map<Hex, Hex>(),
    mints = new Set<Hex>();
  const sources: { key?: Hex; token: Address }[] = [];
  for (const asset of requested) {
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
    const token = native
      ? await readGasPrc20(snap, chain)
      : runtime.resolvePrc20(sourceToken, chain);
    if (caps.some((c) => c.token === getAddress(token)))
      throw svmInvalid('duplicate SVM asset');
    caps.push({
      token: getAddress(token),
      maxPerCall: asset.maxPerCall,
      maxTotal: asset.maxTotal ?? UINT256_MAX,
    });
    sources.push({ key, token });
    if (key) mints.add(key);
  }
  const outputs = (rule.outputTokens ?? []).map((mint) => ({ mint }));
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
  return compileSvmIdlRule(
    rule,
    { ...ctx, tokenAccounts },
    runtime.nowSeconds()
  );
}
