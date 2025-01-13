import {
  ArbitrumMonotone,
  BnbMonotone,
  EthereumMonotone,
  OptimismMonotone,
  PolygonMonotone,
  PushMonotone,
  SolanaMonotone,
} from './common';

/**
 * SUPPORTED ENVIRONEMENTS
 */
export enum ENV {
  PROD = 'prod',
  STAGING = 'staging',
  DEV = 'dev',
  LOCAL = 'local',
}

export const CONSTANTS = {
  ENV: ENV,
};

export const CHAIN_LOGO: Record<string, React.FC | React.ComponentType> = {
  1: EthereumMonotone,
  11155111: EthereumMonotone,
  137: PolygonMonotone,
  80002: PolygonMonotone,
  97: BnbMonotone,
  56: BnbMonotone,
  42161: ArbitrumMonotone,
  421614: ArbitrumMonotone,
  11155420: OptimismMonotone,
  10: OptimismMonotone,
  2442: PolygonMonotone,
  1101: PolygonMonotone,
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': SolanaMonotone,
  devnet: PushMonotone,
};
