import { getAddress, type Address } from 'viem';
import { PUSH_NETWORK } from '../constants/enums';
import { AgenticCapability } from './capabilities';
import { v4, type AgwContracts } from './contracts/v4';
import type { ChainReader } from './contracts/reader';
import { AGENTIC_ERROR_CODE, AgenticError } from './errors';
import {
  DONUT_V4_ADDRESSES,
  DONUT_V4_START_BLOCK,
  V4_SOURCE_COMMIT,
} from './contracts/donut-v4';

/**
 * A verified AGW contract generation on one Push network. The registry is the
 * ONLY source of AGW addresses in the SDK: no address is hard-coded anywhere
 * else, and historical Donut deployments (generation 67929f2, grantMandate)
 * are NOT registered because they do not implement this ABI.
 */
export interface AgenticGeneration {
  /** Stable identifier, e.g. 'v4'. */
  id: string;
  /** Contract source commit the ABI was generated from. */
  sourceCommit: string;
  network: PUSH_NETWORK;
  /** false = review fixture (local harness); never advertised as a release deployment. */
  advertised: boolean;
  addresses: {
    factory: Address;
    walletImplementation: Address;
    sessionEngine: Address;
    rulesPolicy: Address;
    sessionValidator: Address;
    gateway: Address;
  };
  /** First block to scan for factory/wallet events. */
  startBlock: bigint;
  /** Expected wallet accountId(). */
  accountId: string;
  capabilities: ReadonlySet<AgenticCapability>;
  contracts: AgwContracts;
}

/** Capabilities the v4 ABI actually implements. Target-only features are absent. */
export const V4_CAPABILITIES: ReadonlySet<AgenticCapability> = new Set([
  AgenticCapability.WALLET_READS,
  AgenticCapability.ACTIVE_RULE_READS,
  AgenticCapability.OWNER_EXECUTE,
  AgenticCapability.AGENT_EXECUTE,
  AgenticCapability.NATIVE_RULES,
  AgenticCapability.ASSERT_SPENT_NATIVE,
  AgenticCapability.CHECKPOINTS,
  AgenticCapability.UNIVERSAL_EVM_OUTBOUND,
  AgenticCapability.UNIVERSAL_EVM_RULES,
  AgenticCapability.ASSERT_SPENT_UNIVERSAL_MULTI,
]);

/**
 * V4 only. Unsupported networks fail before signing; no legacy adapter fallback.
 */
const VERIFIED_DEPLOYMENTS: readonly AgenticGeneration[] = [
  {
    id: 'v4',
    sourceCommit: V4_SOURCE_COMMIT,
    network: PUSH_NETWORK.TESTNET_DONUT,
    advertised: true,
    addresses: DONUT_V4_ADDRESSES,
    startBlock: DONUT_V4_START_BLOCK,
    accountId: 'push.agw.1.0.0',
    capabilities: V4_CAPABILITIES,
    contracts: v4,
  },
];

const registry: AgenticGeneration[] = [...VERIFIED_DEPLOYMENTS];

/**
 * @internal Register a generation that is NOT a verified release deployment —
 * the local contract harness and E2E manifest loader use this. Not exported
 * from the package entry point.
 */
export function registerAgenticGeneration(
  input: Omit<AgenticGeneration, 'contracts' | 'capabilities'> & {
    capabilities?: ReadonlySet<AgenticCapability>;
  }
): AgenticGeneration {
  if (input.id !== v4.id || input.sourceCommit !== V4_SOURCE_COMMIT) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.GENERATION_UNSUPPORTED,
      `no contract adapter for generation "${input.id}"`
    );
  }
  const gen: AgenticGeneration = {
    ...input,
    addresses: {
      factory: getAddress(input.addresses.factory),
      walletImplementation: getAddress(input.addresses.walletImplementation),
      sessionEngine: getAddress(input.addresses.sessionEngine),
      rulesPolicy: getAddress(input.addresses.rulesPolicy),
      sessionValidator: getAddress(input.addresses.sessionValidator),
      gateway: getAddress(input.addresses.gateway),
    },
    capabilities: input.capabilities ?? V4_CAPABILITIES,
    contracts: v4,
  };
  const existing = registry.findIndex(
    (g) =>
      g.network === gen.network && g.addresses.factory === gen.addresses.factory
  );
  if (existing >= 0) registry.splice(existing, 1);
  registry.push(gen);
  verifiedWiring.clear();
  return gen;
}

/** @internal Test/harness cleanup. Restores the checked Donut v4 registry. */
export function resetAgenticGenerations(): void {
  registry.splice(0, registry.length, ...VERIFIED_DEPLOYMENTS);
  verifiedWiring.clear();
}

/** Grant compatibility check; the unrestricted owner door does not consult URP. */
export async function verifyPolicyVersion(
  reader: ChainReader,
  gen: AgenticGeneration
): Promise<void> {
  const version = await reader.readContract({
    address: gen.addresses.rulesPolicy,
    abi: gen.contracts.abis.policy,
    functionName: 'version',
  });
  if (version !== '3.1.0')
    throw new AgenticError(
      AGENTIC_ERROR_CODE.GENERATION_UNSUPPORTED,
      `URP version ${String(version)} is not supported by the v4 adapter`
    );
}

export function generationsFor(
  network: PUSH_NETWORK
): readonly AgenticGeneration[] {
  return registry.filter((g) => g.network === network);
}

/** The generation new wallets are created on for this network. */
export function currentGeneration(network: PUSH_NETWORK): AgenticGeneration {
  const gens = generationsFor(network);
  const gen = gens[gens.length - 1];
  if (!gen) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.GENERATION_UNSUPPORTED,
      `no verified AGW deployment is registered for ${network}`,
      {
        hint: 'AGW v4 is configured on Donut only; this Push network has no registered v4 deployment.',
        details: { network, assumption: 'A07' },
      }
    );
  }
  return gen;
}

/** Generation infrastructure a native rule may not target (the wallet itself is added per call). */
export function forbiddenTargets(
  gen: AgenticGeneration,
  wallet?: Address
): Address[] {
  const a = gen.addresses;
  return [
    a.factory,
    a.sessionEngine,
    a.rulesPolicy,
    a.sessionValidator,
    a.gateway,
    ...(wallet ? [wallet] : []),
  ];
}

const verifiedWiring = new Map<string, Promise<void>>();

/** Confirms the factory still points at the registered implementation (cached per generation). */
export function verifyFactoryWiring(
  reader: ChainReader,
  gen: AgenticGeneration
): Promise<void> {
  const key = `${gen.network}:${gen.addresses.factory}:${gen.addresses.walletImplementation}`;
  let p = verifiedWiring.get(key);
  if (!p) {
    p = (async () => {
      const impl = (await reader.readContract({
        address: gen.addresses.factory,
        abi: gen.contracts.abis.factory,
        functionName: 'walletImplementation',
      })) as Address;
      if (getAddress(impl) !== gen.addresses.walletImplementation) {
        throw new AgenticError(
          AGENTIC_ERROR_CODE.GENERATION_UNSUPPORTED,
          `factory ${gen.addresses.factory} points at implementation ${impl}, not the registered ${gen.addresses.walletImplementation}`
        );
      }
    })();
    p.catch(() => verifiedWiring.delete(key));
    verifiedWiring.set(key, p);
  }
  return p;
}

/**
 * Resolve and verify the generation of a deployed wallet:
 * code present → factory() is a registered factory → factory.isWallet(wallet)
 * → immutable wiring and accountId match the registered generation.
 */
export async function resolveWalletGeneration(
  reader: ChainReader,
  network: PUSH_NETWORK,
  wallet: Address
): Promise<AgenticGeneration> {
  const gens = generationsFor(network);
  if (gens.length === 0) currentGeneration(network); // throws GENERATION_UNSUPPORTED (A07)

  const code = await reader.getCode({ address: wallet });
  if (!code || code === '0x') {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.WALLET_NOT_DEPLOYED,
      `no contract is deployed at ${wallet}`,
      {
        hint: 'Deploy it with client.agentic.create, or check the address and network.',
      }
    );
  }
  let factory: Address;
  try {
    factory = getAddress(
      (await reader.readContract({
        address: wallet,
        abi: v4.abis.wallet,
        functionName: 'factory',
      })) as Address
    );
  } catch (cause) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.NOT_AGENTIC_WALLET,
      `${wallet} does not expose an AGW factory()`,
      { cause }
    );
  }
  const gen = gens.find((g) => g.addresses.factory === factory);
  if (!gen) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.GENERATION_UNSUPPORTED,
      `${wallet} was created by factory ${factory}, which is not a verified AGW generation on ${network}`,
      { details: { factory, assumption: 'A07' } }
    );
  }
  const isWallet = (await reader.readContract({
    address: gen.addresses.factory,
    abi: gen.contracts.abis.factory,
    functionName: 'isWallet',
    args: [wallet],
  })) as boolean;
  if (!isWallet) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.NOT_AGENTIC_WALLET,
      `${wallet} is not a wallet of factory ${factory}`
    );
  }
  const [engine, policy, validator, gateway, accountId] = await Promise.all(
    (
      [
        'SESSION_ENGINE',
        'RULES_POLICY',
        'SESSION_VALIDATOR',
        'UNIVERSAL_GATEWAY_PC',
        'accountId',
      ] as const
    ).map((functionName) =>
      reader.readContract({
        address: wallet,
        abi: gen.contracts.abis.wallet,
        functionName,
      })
    )
  );
  const mismatch =
    getAddress(engine as Address) !== gen.addresses.sessionEngine ||
    getAddress(policy as Address) !== gen.addresses.rulesPolicy ||
    getAddress(validator as Address) !== gen.addresses.sessionValidator ||
    getAddress(gateway as Address) !== gen.addresses.gateway ||
    accountId !== gen.accountId;
  if (mismatch) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.GENERATION_UNSUPPORTED,
      `${wallet} wiring does not match registered generation ${gen.id}`,
      { details: { engine, policy, validator, gateway, accountId } }
    );
  }
  await verifyFactoryWiring(reader, gen);
  return gen;
}
