import type { PUSH_NETWORK } from '../constants/enums';

/**
 * PushChain.CONSTANTS.AGENTIC[network] (spec 3.d). Populated only from
 * verified release deployments — currently none (A07), so the map is empty.
 * ENVELOPE_VERSION is omitted until a generation with a versioned envelope is
 * delivered; no value is guessed.
 */
export interface AgenticNetworkConstants {
  FACTORY: `0x${string}`;
  RULES_POLICY: `0x${string}`;
  MAX_PINS: number;
  MAX_ALLOWED_CALLS: number;
  ENVELOPE_VERSION?: number;
}

export const AGENTIC: Readonly<Partial<Record<PUSH_NETWORK, AgenticNetworkConstants>>> = Object.freeze({});
