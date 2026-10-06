/** Internal resolved context; no public Rule schema or cluster assumptions. */
import {
  getAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import { PRC20_SOURCE_ABI, readGasPrc20 } from '../contracts/prc20-metadata';
import {
  svmKey,
  resolveAgwSvmRuleContext,
  type SvmTokenAccountInput,
  type ResolvedSvmAsset,
} from '../codec/svm-accounts';
import type { AssetCapWire } from '../codec/universal-terms';
import type { Snapshot } from '../reads/snapshot';

export interface SvmMetadataProvider {
  /** Must identify the requested full CAIP-2 cluster; no global gateway default. */
  gateway(
    chainNamespace: `solana:${string}`
  ): Promise<{ chainNamespace: string; program: string }>;
  /** RPC-backed mint owner (legacy SPL or Token-2022), not an assumed default. */
  mint(
    chainNamespace: `solana:${string}`,
    address: Hex
  ): Promise<{ mint: string; tokenProgram: string }>;
}

const NATIVE_SOURCE = parseAbi([
  'function SOURCE_TOKEN_ADDRESS() view returns (address)',
]);
const ZERO_KEY = `0x${'00'.repeat(32)}` as Hex;

export async function resolveSvmAssets(
  snap: Snapshot,
  chain: `solana:${string}`,
  caps: readonly AssetCapWire[],
  metadata: SvmMetadataProvider
): Promise<ResolvedSvmAsset[]> {
  const gas = await readGasPrc20(snap, chain);
  const out: ResolvedSvmAsset[] = [];
  for (const cap of caps) {
    const token = getAddress(cap.token);
    const namespace = await snap.read<string>(
      token,
      PRC20_SOURCE_ABI,
      'SOURCE_CHAIN_NAMESPACE'
    );
    if (namespace !== chain)
      throw new AgenticError(
        AGENTIC_ERROR_CODE.ASSET_CHAIN_MISMATCH,
        `PRC20 ${token} belongs to ${namespace}, not ${chain}`
      );
    let source: string;
    try {
      source = await snap.read<string>(
        token,
        PRC20_SOURCE_ABI,
        'SOURCE_TOKEN_ADDRESS'
      );
    } catch (cause) {
      if (token !== gas) throw cause;
      const native = await snap.read<Address>(
        token,
        NATIVE_SOURCE,
        'SOURCE_TOKEN_ADDRESS'
      );
      if (getAddress(native) !== zeroAddress) throw cause;
      source = '';
    }
    const native =
      source === '' ||
      source.toLowerCase() === zeroAddress ||
      source.toLowerCase() === ZERO_KEY;
    if (native) {
      if (token !== gas)
        throw new AgenticError(
          AGENTIC_ERROR_CODE.INVALID_RULE,
          'native marker is not the registered gas PRC20'
        );
      out.push({ kind: 'native', cap: { ...cap, token } });
    } else {
      const key = svmKey(source);
      const mint = await metadata.mint(chain, key);
      if (svmKey(mint.mint) !== key)
        throw new AgenticError(
          AGENTIC_ERROR_CODE.INVALID_RULE,
          'mint resolver returned a different mint'
        );
      out.push({ kind: 'spl', cap: { ...cap, token }, ...mint });
    }
  }
  return out;
}

export async function resolveSvmContext(
  snap: Snapshot,
  wallet: Address,
  chain: `solana:${string}`,
  caps: readonly AssetCapWire[],
  metadata: SvmMetadataProvider,
  outputs: readonly SvmTokenAccountInput[] = []
) {
  const gateway = await metadata.gateway(chain);
  if (gateway.chainNamespace !== chain)
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      'gateway registry cluster mismatch'
    );
  const assets = await resolveSvmAssets(snap, chain, caps, metadata);
  const resolvedOutputs = [];
  for (const output of outputs) {
    const key = svmKey(output.mint);
    const resolved = await metadata.mint(chain, key);
    if (
      svmKey(resolved.mint) !== key ||
      (output.tokenProgram &&
        svmKey(output.tokenProgram) !== svmKey(resolved.tokenProgram))
    )
      throw new AgenticError(
        AGENTIC_ERROR_CODE.INVALID_RULE,
        'output mint/token-program mismatch'
      );
    resolvedOutputs.push(resolved);
  }
  // Derivation validates token programs and covers every mint/output.
  return resolveAgwSvmRuleContext(
    wallet,
    gateway.program,
    assets,
    resolvedOutputs
  );
}
