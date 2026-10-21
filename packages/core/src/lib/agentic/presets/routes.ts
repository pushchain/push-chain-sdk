import { PUSH_NETWORK, type CHAIN } from '../../constants/enums';
import { SUPPORTED_GATEWAY_CHAINS } from '../../orchestrator/internals/helpers';
import { resolveAgenticPrc20 } from '../token-routes';
import { generationsFor } from '../deployments';
import type { RuleAsset } from '../agentic.types';
import type { PresetChainReadiness, PresetConfigurationIssue } from './types';
import { assetAddress } from './operation-limits';

/** Offline registry checks only. Grant preparation still verifies source metadata
 * and wiring against chain state before any signature or transaction. */
export function presetRoutes(
  chain: string,
  assets: RuleAsset[],
  network: PUSH_NETWORK
): {
  bridgeAssets: PresetChainReadiness['bridgeAssets'];
  issues: PresetConfigurationIssue[];
} {
  const issues: PresetConfigurationIssue[] = [];
  network =
    network === PUSH_NETWORK.TESTNET ? PUSH_NETWORK.TESTNET_DONUT : network;
  if (!generationsFor(network).some((g) => g.advertised))
    issues.push({
      code: 'AGW_NETWORK_UNAVAILABLE',
      message: `No verified AGW deployment is registered for ${network}.`,
    });
  const supported = SUPPORTED_GATEWAY_CHAINS.includes(chain as CHAIN);
  if (!supported)
    issues.push({
      code: 'DESTINATION_UNAVAILABLE',
      message: `The SDK has no supported gateway route to ${chain}; this is a catalog template.`,
    });
  const bridgeAssets = assets.map((asset) => {
    const token = assetAddress(asset);
    try {
      if (!supported) throw new Error(`No supported gateway route to ${chain}`);
      const prc20 = resolveAgenticPrc20({ chain, address: token }, network);
      return {
        token,
        prc20: prc20.address,
        status: 'registered' as const,
      };
    } catch {
      issues.push({
        code: 'BRIDGE_ASSET_UNAVAILABLE',
        token,
        message: `No SDK PRC20 mapping for ${chain}:${token} on ${network}. This preset cannot be created with this token until its Push route is verified. Choose a routed token only if the selected app supports that exact token address.`,
      });
      return { token, status: 'unavailable' as const };
    }
  });
  return { bridgeAssets, issues };
}
