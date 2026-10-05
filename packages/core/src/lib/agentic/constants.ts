import { PUSH_NETWORK } from '../constants/enums';
import { DONUT_V4_ADDRESSES } from './contracts/donut-v4';

/** Checked Donut v4 proxies. Unsupported networks are absent. */
export interface AgenticNetworkConstants {
  FACTORY: `0x${string}`;
  RULES_POLICY: `0x${string}`;
  MAX_PINS: number;
  MAX_ALLOWED_CALLS: number;
  ENVELOPE_VERSION: number;
}

export const AGENTIC: Readonly<
  Partial<Record<PUSH_NETWORK, AgenticNetworkConstants>>
> = Object.freeze({
  [PUSH_NETWORK.TESTNET_DONUT]: Object.freeze({
    FACTORY: DONUT_V4_ADDRESSES.factory,
    RULES_POLICY: DONUT_V4_ADDRESSES.rulesPolicy,
    MAX_PINS: 8,
    MAX_ALLOWED_CALLS: 32,
    ENVELOPE_VERSION: 1,
  }),
});
