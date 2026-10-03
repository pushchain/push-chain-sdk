/**
 * AGW deployment manifest for live E2E — READ-ONLY. Loaded from the JSON file
 * named by AGW_DEPLOYMENT_MANIFEST and verified against the chain before any
 * test (or preflight funding) runs. No manifest exists today: no compatible
 * AGW generation is deployed (plan/agw assumption A07), so the agw group
 * fails this gate by design instead of reporting success.
 *
 * Manifest shape:
 * {
 *   "network": "TESTNET_DONUT",
 *   "generation": "e704d5b",
 *   "sourceCommit": "<40-hex AGW commit>",
 *   "startBlock": "<decimal>",
 *   "accountId": "push.agw.1.0.0",
 *   "addresses": { "factory", "walletImplementation", "sessionEngine",
 *                  "rulesPolicy", "sessionValidator", "gateway" },
 *   "capabilities": ["nativeRules", ...]   // optional; defaults to the generation's
 * }
 */
import { readFileSync } from 'node:fs';
import { getAddress, isAddress, type Address, type PublicClient } from 'viem';
import { PUSH_NETWORK } from '../../src/lib/constants/enums';
import { AgenticCapability } from '../../src/lib/agentic/capabilities';
import { E704D5B_CAPABILITIES } from '../../src/lib/agentic/deployments';
import { e704d5b } from '../../src/lib/agentic/contracts/e704d5b';

export const AGW_PREREQ_HINT =
  'AGW live E2E needs AGW_DEPLOYMENT_MANIFEST pointing at a verified compatible deployment (plan/agw A07). ' +
  'None exists yet; historical Donut AGW addresses implement a different ABI.';

export interface AgwManifest {
  network: PUSH_NETWORK;
  generation: 'e704d5b';
  sourceCommit: string;
  startBlock: bigint;
  accountId: string;
  addresses: {
    factory: Address;
    walletImplementation: Address;
    sessionEngine: Address;
    rulesPolicy: Address;
    sessionValidator: Address;
    gateway: Address;
  };
  capabilities: ReadonlySet<AgenticCapability>;
}

export class AgwPrerequisiteError extends Error {
  constructor(reason: string) {
    super(`AGW prerequisite not met: ${reason}. ${AGW_PREREQ_HINT}`);
    this.name = 'AgwPrerequisiteError';
  }
}

export function loadAgwManifest(path = process.env['AGW_DEPLOYMENT_MANIFEST']): AgwManifest {
  if (!path) throw new AgwPrerequisiteError('AGW_DEPLOYMENT_MANIFEST is not set');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new AgwPrerequisiteError(`cannot read manifest ${path}: ${(cause as Error).message}`);
  }
  const network = raw['network'] as PUSH_NETWORK;
  if (!Object.values(PUSH_NETWORK).includes(network)) throw new AgwPrerequisiteError(`unknown network ${String(network)}`);
  if (raw['generation'] !== e704d5b.id) {
    throw new AgwPrerequisiteError(`generation ${String(raw['generation'])} has no SDK adapter`);
  }
  if (typeof raw['sourceCommit'] !== 'string' || !/^[0-9a-f]{40}$/.test(raw['sourceCommit'])) {
    throw new AgwPrerequisiteError('sourceCommit must be a 40-hex commit');
  }
  const a = (raw['addresses'] ?? {}) as Record<string, string>;
  const keys = ['factory', 'walletImplementation', 'sessionEngine', 'rulesPolicy', 'sessionValidator', 'gateway'] as const;
  for (const k of keys) {
    if (!isAddress(a[k] ?? '', { strict: false })) throw new AgwPrerequisiteError(`addresses.${k} is missing or invalid`);
  }
  const caps = Array.isArray(raw['capabilities'])
    ? new Set((raw['capabilities'] as string[]).map((c) => {
        if (!(Object.values(AgenticCapability) as string[]).includes(c)) throw new AgwPrerequisiteError(`unknown capability ${c}`);
        return c as AgenticCapability;
      }))
    : E704D5B_CAPABILITIES;
  return {
    network,
    generation: 'e704d5b',
    sourceCommit: raw['sourceCommit'],
    startBlock: BigInt(String(raw['startBlock'] ?? '0')),
    accountId: String(raw['accountId'] ?? 'push.agw.1.0.0'),
    addresses: Object.fromEntries(keys.map((k) => [k, getAddress(a[k])])) as AgwManifest['addresses'],
    capabilities: caps,
  };
}

/** Read-only on-chain check that the manifest's wiring is what it claims. */
export async function verifyAgwManifest(client: PublicClient, m: AgwManifest): Promise<void> {
  const read = (address: Address, abi: readonly unknown[], functionName: string) =>
    client.readContract({ address, abi: abi as never, functionName: functionName as never } as never) as Promise<unknown>;
  for (const [name, addr] of Object.entries(m.addresses)) {
    if (name === 'gateway') continue; // a precompile may report no code
    const code = await client.getCode({ address: addr });
    if (!code || code === '0x') throw new AgwPrerequisiteError(`${name} ${addr} has no code`);
  }
  const impl = getAddress((await read(m.addresses.factory, e704d5b.abis.factory, 'walletImplementation')) as string);
  if (impl !== m.addresses.walletImplementation) {
    throw new AgwPrerequisiteError(`factory implementation is ${impl}, manifest says ${m.addresses.walletImplementation}`);
  }
  const wiring: [string, Address][] = [
    ['SESSION_ENGINE', m.addresses.sessionEngine],
    ['RULES_POLICY', m.addresses.rulesPolicy],
    ['SESSION_VALIDATOR', m.addresses.sessionValidator],
    ['UNIVERSAL_GATEWAY_PC', m.addresses.gateway],
  ];
  for (const [fn, expected] of wiring) {
    const got = getAddress((await read(impl, e704d5b.abis.wallet, fn)) as string);
    if (got !== expected) throw new AgwPrerequisiteError(`implementation ${fn} is ${got}, manifest says ${expected}`);
  }
  const accountId = (await read(impl, e704d5b.abis.wallet, 'accountId')) as string;
  if (accountId !== m.accountId) throw new AgwPrerequisiteError(`implementation accountId is ${accountId}`);
}
