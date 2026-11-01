import { getAddress, isAddress, type Address } from 'viem';
import { PUSH_NETWORK } from '../constants/enums';
import { getPRC20Address } from '../universal/prc20-address';

export interface AgenticTokenRoute {
  /** Exact destination-chain token address. */
  source: Address;
  /** Push PRC20 the node registry maps that token to. */
  prc20: Address;
  symbol: string;
  decimals: number;
}

/** Exact routes enabled in the node's uregistry that the shared symbol-keyed
 * registry cannot hold (a second USDC on one chain). Snapshot: Donut uregistry
 * height 24,457,377; SOURCE_* metadata, decimals and outbound quotes checked at
 * block 24,457,398. Grant preparation still verifies the source on chain.
 */
const DONUT_EXACT_ROUTES: Readonly<
  Record<string, readonly AgenticTokenRoute[]>
> = {
  'eip155:11155111': [
    {
      source: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      prc20: '0x387b9C8Db60E74999aAAC5A2b7825b400F12d68E',
      symbol: 'USDC',
      decimals: 6,
    },
  ],
  'eip155:84532': [
    {
      source: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      prc20: '0x84B62e44F667F692F7739Ca6040cD17DA02068A8',
      symbol: 'USDC',
      decimals: 6,
    },
  ],
  'eip155:421614': [
    {
      source: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      prc20: '0xa261A10e94aE4bA88EE8c5845CbE7266bD679DD6',
      symbol: 'USDC',
      decimals: 6,
    },
  ],
};

const EXACT_ROUTES: Partial<
  Record<PUSH_NETWORK, Readonly<Record<string, readonly AgenticTokenRoute[]>>>
> = {
  [PUSH_NETWORK.TESTNET_DONUT]: DONUT_EXACT_ROUTES,
  [PUSH_NETWORK.TESTNET]: DONUT_EXACT_ROUTES,
};

export function exactAgenticRoutes(
  chain: string,
  network: PUSH_NETWORK
): readonly AgenticTokenRoute[] {
  return EXACT_ROUTES[network]?.[chain] ?? [];
}

/** Match by chain AND exact address; never by symbol. */
export function exactAgenticRoute(
  chain: string,
  source: string,
  network: PUSH_NETWORK
): AgenticTokenRoute | undefined {
  if (!isAddress(source, { strict: false })) return undefined;
  const wanted = getAddress(source);
  return exactAgenticRoutes(chain, network).find(
    (route) => getAddress(route.source) === wanted
  );
}

/** AGW source-token resolution: exact node routes first, then the shared registry. */
export function resolveAgenticPrc20(
  token: { chain: string; address: string },
  network: PUSH_NETWORK
): { address: Address; symbol: string; decimals: number } {
  const exact = exactAgenticRoute(token.chain, token.address, network);
  if (exact)
    return {
      address: getAddress(exact.prc20),
      symbol: exact.symbol,
      decimals: exact.decimals,
    };
  const mapped = getPRC20Address(token, { network });
  return {
    address: getAddress(mapped.address),
    symbol: mapped.symbol,
    decimals: mapped.decimals,
  };
}
