/**
 * AGW deployment manifest for live E2E — READ-ONLY. Loaded from the JSON file
 * optionally named by AGW_DEPLOYMENT_MANIFEST, otherwise the built-in Donut v5
 * manifest. Code/wiring/version are verified before tests or preflight funding.
 *
 * Manifest shape:
 * {
 *   "network": "TESTNET_DONUT",
 *   "generation": "v5",
 *   "sourceCommit": "<40-hex AGW commit>",
 *   "startBlock": "<decimal>",
 *   "accountId": "push.agw.1.0.0",
 *   "addresses": { "factory", "walletImplementation", "sessionEngine",
 *                  "rulesPolicy", "sessionValidator", "gateway" },
 *   "capabilities": ["nativeRules", ...]   // optional; defaults to the generation's
 * }
 */
import { readFileSync } from 'node:fs';
import {
  getAddress,
  isAddress,
  type Address,
  type PublicClient,
  toFunctionSelector,
} from 'viem';
import { PUSH_NETWORK } from '../../src/lib/constants/enums';
import { AgenticCapability } from '../../src/lib/agentic/capabilities';
import { V5_CAPABILITIES } from '../../src/lib/agentic/deployments';
import { v5 } from '../../src/lib/agentic/contracts/v5';
import {
  DONUT_V5_ADDRESSES,
  DONUT_V5_START_BLOCK,
  V5_SOURCE_COMMIT,
} from '../../src/lib/agentic/contracts/donut-v5';

export const AGW_PREREQ_HINT =
  'AGW live E2E needs checked v5 wiring, signer keys and testnet funding. ' +
  'The default is the checked Donut v5 manifest; custom manifests must match the v5 source.';

export interface AgwManifest {
  network: PUSH_NETWORK;
  generation: 'v5';
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

export function loadAgwManifest(
  path = process.env['AGW_DEPLOYMENT_MANIFEST']
): AgwManifest {
  if (!path)
    return {
      network: PUSH_NETWORK.TESTNET_DONUT,
      generation: 'v5',
      sourceCommit: V5_SOURCE_COMMIT,
      startBlock: DONUT_V5_START_BLOCK,
      accountId: 'push.agw.1.0.0',
      addresses: DONUT_V5_ADDRESSES,
      capabilities: V5_CAPABILITIES,
    };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new AgwPrerequisiteError(
      `cannot read manifest ${path}: ${(cause as Error).message}`
    );
  }
  const network = raw['network'] as PUSH_NETWORK;
  if (!Object.values(PUSH_NETWORK).includes(network))
    throw new AgwPrerequisiteError(`unknown network ${String(network)}`);
  if (raw['generation'] !== v5.id) {
    throw new AgwPrerequisiteError(
      `generation ${String(raw['generation'])} has no SDK adapter`
    );
  }
  if (raw['sourceCommit'] !== V5_SOURCE_COMMIT) {
    throw new AgwPrerequisiteError(
      'sourceCommit must match the supported v5 source pin'
    );
  }
  const a = (raw['addresses'] ?? {}) as Record<string, string>;
  const keys = [
    'factory',
    'walletImplementation',
    'sessionEngine',
    'rulesPolicy',
    'sessionValidator',
    'gateway',
  ] as const;
  for (const k of keys) {
    if (!isAddress(a[k] ?? '', { strict: false }))
      throw new AgwPrerequisiteError(`addresses.${k} is missing or invalid`);
  }
  const caps = Array.isArray(raw['capabilities'])
    ? new Set(
        (raw['capabilities'] as string[]).map((c) => {
          if (!V5_CAPABILITIES.has(c as AgenticCapability))
            throw new AgwPrerequisiteError(`unknown capability ${c}`);
          return c as AgenticCapability;
        })
      )
    : V5_CAPABILITIES;
  return {
    network,
    generation: 'v5',
    sourceCommit: raw['sourceCommit'],
    startBlock: BigInt(String(raw['startBlock'] ?? '0')),
    accountId: String(raw['accountId'] ?? 'push.agw.1.0.0'),
    addresses: Object.fromEntries(
      keys.map((k) => [k, getAddress(a[k])])
    ) as AgwManifest['addresses'],
    capabilities: caps,
  };
}

/** Read-only on-chain check that the manifest's wiring is what it claims. */
export async function verifyAgwManifest(
  client: PublicClient,
  m: AgwManifest
): Promise<void> {
  const read = (
    address: Address,
    abi: readonly unknown[],
    functionName: string
  ) =>
    client.readContract({
      address,
      abi: abi as never,
      functionName: functionName as never,
    } as never) as Promise<unknown>;
  for (const [name, addr] of Object.entries(m.addresses)) {
    if (name === 'gateway') continue; // a precompile may report no code
    const code = await client.getCode({ address: addr });
    if (!code || code === '0x')
      throw new AgwPrerequisiteError(`${name} ${addr} has no code`);
  }
  const impl = getAddress(
    (await read(
      m.addresses.factory,
      v5.abis.factory,
      'walletImplementation'
    )) as string
  );
  if (impl !== m.addresses.walletImplementation) {
    throw new AgwPrerequisiteError(
      `factory implementation is ${impl}, manifest says ${m.addresses.walletImplementation}`
    );
  }
  const implementationCode = await client.getCode({ address: impl });
  for (const signature of [
    'label()',
    'setLabel(string)',
    'initializeAccount(string)',
  ]) {
    if (!implementationCode?.includes(toFunctionSelector(signature).slice(2))) {
      throw new AgwPrerequisiteError(
        `implementation is missing the v5 ${signature} selector`
      );
    }
  }
  const wiring: [string, Address][] = [
    ['SESSION_ENGINE', m.addresses.sessionEngine],
    ['RULES_POLICY', m.addresses.rulesPolicy],
    ['SESSION_VALIDATOR', m.addresses.sessionValidator],
    ['UNIVERSAL_GATEWAY_PC', m.addresses.gateway],
  ];
  for (const [fn, expected] of wiring) {
    const got = getAddress((await read(impl, v5.abis.wallet, fn)) as string);
    if (got !== expected)
      throw new AgwPrerequisiteError(
        `implementation ${fn} is ${got}, manifest says ${expected}`
      );
  }
  const policyVersion = await read(
    m.addresses.rulesPolicy,
    v5.abis.policy,
    'version'
  );
  if (policyVersion !== '3.1.0')
    throw new AgwPrerequisiteError(
      `unsupported URP version ${String(policyVersion)}`
    );
  const accountId = (await read(impl, v5.abis.wallet, 'accountId')) as string;
  if (accountId !== m.accountId)
    throw new AgwPrerequisiteError(`implementation accountId is ${accountId}`);
}
