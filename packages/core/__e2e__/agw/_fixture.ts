/**
 * Shared AGW E2E fixture. Everything here is setup: the behaviour under test
 * is always exercised through public SDK methods in the specs.
 *
 * Accounts (never logged):
 *   PUSH_PRIVATE_KEY   Push-native owner (the Push master); pays owner gas,
 *                      wallet PC and the bounded per-run agent funding.
 *   EVM_PRIVATE_KEY    external EVM agent, acting through its Sepolia-origin UEA.
 *   SOLANA_PRIVATE_KEY Solana-origin agent through its UEA (Push-destination only).
 * A fresh Push-native agent key is generated per run and funded with at most
 * AGW_E2E_AGENT_PC (default 0.5 PC). Wallets are fresh per run; nothing shared
 * is revoked or drained.
 */
import '@e2e/shared/setup';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, http, parseEther, type Address, type Hex, type PublicClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { PushChain } from '../../src';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { registerAgenticGeneration, resetAgenticGenerations } from '../../src/lib/agentic/deployments';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { AgwPrerequisiteError, loadAgwManifest, verifyAgwManifest, type AgwManifest } from './_manifest';

export const AGW_E2E_ENABLED = process.env['AGW_E2E'] === '1';

export interface AgwFixture {
  manifest: AgwManifest;
  push: PublicClient;
  owner: PushChain;
  ownerAddress: Address;
  agentKey: Hex;
  agentAddress: Address;
  agent(wallet: Address, progressHook?: (e: unknown) => void): Promise<PushChain>;
  fundPC(to: Address, amount: bigint): Promise<void>;
  evidence(name: string, data: Record<string, unknown>): void;
  teardown(): void;
}

const pushChainFor = (network: PUSH_NETWORK) =>
  network === PUSH_NETWORK.MAINNET ? CHAIN.PUSH_MAINNET : network === PUSH_NETWORK.LOCALNET ? CHAIN.PUSH_LOCALNET : CHAIN.PUSH_TESTNET_DONUT;

/**
 * Strict prerequisite gate: throws (failing beforeAll, hence every test) when
 * the manifest, keys or wiring are missing. A selected agw run can never pass
 * without exercising a verified deployment.
 */
export async function setupAgw(): Promise<AgwFixture> {
  const manifest = loadAgwManifest();
  const pushKey = process.env['PUSH_PRIVATE_KEY'] as Hex | undefined;
  if (!pushKey) throw new AgwPrerequisiteError('PUSH_PRIVATE_KEY is not set');
  const chain = pushChainFor(manifest.network);
  const info = CHAIN_INFO[chain];
  const push = createPublicClient({
    chain: defineChain({
      id: Number(info.chainId),
      name: 'push',
      nativeCurrency: { name: 'PC', symbol: 'PC', decimals: 18 },
      rpcUrls: { default: { http: info.defaultRPC } },
    }),
    transport: http(info.defaultRPC[0]),
  }) as PublicClient;
  await verifyAgwManifest(push, manifest);
  resetAgenticGenerations();
  registerAgenticGeneration({
    id: manifest.generation,
    sourceCommit: manifest.sourceCommit,
    network: manifest.network,
    advertised: false,
    addresses: manifest.addresses,
    startBlock: manifest.startBlock,
    accountId: manifest.accountId,
    capabilities: manifest.capabilities,
  });

  const { pushClient: owner, account } = await createEvmPushClient({ chain, privateKey: pushKey, network: manifest.network });
  const agentKey = generatePrivateKey();
  const agentAddress = privateKeyToAccount(agentKey).address;
  const fundPC = async (to: Address, amount: bigint) => {
    const tx = await owner.universal.sendTransaction({ to, value: amount });
    const r = await tx.wait();
    if (r.status !== 1) throw new Error(`funding ${to} failed`);
  };
  await fundPC(agentAddress, parseEther(process.env['AGW_E2E_AGENT_PC'] ?? '0.5'));

  const logDir = join(__dirname, '..', '..', 'e2e-logs');
  mkdirSync(logDir, { recursive: true });
  const evidence = (name: string, data: Record<string, unknown>) =>
    appendFileSync(
      join(logDir, 'agw-evidence.jsonl'),
      JSON.stringify(
        { name, at: new Date().toISOString(), network: manifest.network, sourceCommit: manifest.sourceCommit, ...data },
        (_k, v) => (typeof v === 'bigint' ? v.toString() : v)
      ) + '\n'
    );

  return {
    manifest,
    push,
    owner,
    ownerAddress: account.address,
    agentKey,
    agentAddress,
    agent: (wallet, progressHook) => evmClient(agentKey, chain, manifest.network, wallet, progressHook),
    fundPC,
    evidence,
    teardown: () => resetAgenticGenerations(),
  };
}

export const inSeconds = (s: number) => Math.floor(Date.now() / 1000) + s;

/** A client for an EVM key on `origin` (Push-native or external), optionally acting as an AGW. */
export async function evmClient(
  key: Hex,
  origin: CHAIN,
  network: PUSH_NETWORK,
  agenticWallet?: Address,
  progressHook?: (e: unknown) => void
): Promise<PushChain> {
  const walletClient = createWalletClient({
    account: privateKeyToAccount(key),
    transport: http(CHAIN_INFO[origin].defaultRPC[0]),
  });
  const signer = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
    chain: origin,
    library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
  });
  return PushChain.initialize(signer, {
    network,
    ...(agenticWallet ? { agenticWallet } : {}),
    ...(progressHook ? { progressHook: progressHook as never } : {}),
  });
}
