/**
 * Local AGW contract harness — REVIEW ONLY.
 *
 * Starts anvil as a stand-in Push LOCALNET (chainId 9000, the SDK's
 * CHAIN_INFO[PUSH_LOCALNET].chainId), deploys the REAL pinned v4
 * contracts (SmartSession, AgentValidator, UniversalRulesPolicy behind a
 * TransparentUpgradeableProxy, AGW implementation, AGWFactory behind an
 * ERC1967Proxy) from an isolated build prepared by
 * scripts/agw-local/prepare.sh, and installs a stub gateway at the
 * UniversalGatewayPC precompile address. It registers that deployment as a
 * NON-advertised generation so the SDK can be driven end to end.
 *
 * Limits: no UEA factory / precompiles / Cosmos module, so only Push-EOA
 * signers are exercised; the gateway is a stub (pull + burn + fee arithmetic);
 * no TSS, relay or destination execution happens.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PushChain } from '../src';
import { CHAIN, PUSH_NETWORK } from '../src/lib/constants/enums';
import { LIBRARY } from '../src/lib/constants/enums';
import {
  registerAgenticGeneration,
  resetAgenticGenerations,
  type AgenticGeneration,
} from '../src/lib/agentic/deployments';

export const CHAIN_ID = 9000;
export const GATEWAY_PRECOMPILE = getAddress(
  '0x00000000000000000000000000000000000000c1'
);
export const EXECUTOR_MODULE = getAddress(
  '0x00000000000000000000000000000000000000e1'
);
export const ACCOUNT_ID = 'push.agw.1.0.0';

/** Anvil's well-known development keys (public test material, not secrets). */
export const DEV_KEYS: Hex[] = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
];

export function buildDir(): string {
  const dir = process.env['AGW_LOCAL_DIR'];
  if (!dir || !existsSync(join(dir, 'out', 'AGW.sol', 'AGW.json'))) {
    throw new Error(
      'AGW_LOCAL_DIR must point at a build produced by packages/core/scripts/agw-local/prepare.sh'
    );
  }
  return dir;
}

function artifact(
  dir: string,
  file: string,
  name: string
): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(
    readFileSync(join(dir, 'out', file, `${name}.json`), 'utf8')
  );
  return { abi: json.abi as Abi, bytecode: json.bytecode.object as Hex };
}

export interface Harness {
  rpcUrl: string;
  anvil: ChildProcess;
  publicClient: PublicClient;
  wallets: WalletClient[];
  generation: AgenticGeneration;
  addresses: {
    engine: Address;
    validator: Address;
    rulesPolicy: Address;
    walletImplementation: Address;
    factory: Address;
    universalCore: Address;
    gateway: Address;
    target: Address;
  };
  deploy(
    walletIndex: number,
    name: string,
    file: string,
    args?: readonly unknown[]
  ): Promise<Address>;
  write(
    walletIndex: number,
    to: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[],
    value?: bigint
  ): Promise<Hex>;
  client(
    walletIndex: number,
    opts?: { agenticWallet?: Address; progressHook?: (e: unknown) => void }
  ): Promise<PushChain>;
  readOnlyClient(
    walletIndex: number,
    opts?: { agenticWallet?: Address }
  ): Promise<PushChain>;
  stop(): Promise<void>;
  dir: string;
}

const localChain = (rpcUrl: string) =>
  defineChain({
    id: CHAIN_ID,
    name: 'push-localnet-harness',
    nativeCurrency: { name: 'PC', symbol: 'PC', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

async function waitForRpc(url: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_chainId',
          params: [],
        }),
      });
      if (res.ok) return;
    } catch {
      // not yet listening
    }
    if (Date.now() - start > timeoutMs)
      throw new Error(`anvil did not start at ${url}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

export async function startHarness(port = 18545): Promise<Harness> {
  const dir = buildDir();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil = spawn(
    'anvil',
    [
      '--port',
      String(port),
      '--chain-id',
      String(CHAIN_ID),
      '--hardfork',
      'prague',
      '--silent',
    ],
    { stdio: 'ignore' }
  );
  try {
    return await deployHarness(dir, rpcUrl, anvil);
  } catch (err) {
    anvil.kill('SIGTERM');
    throw err;
  }
}

async function deployHarness(
  dir: string,
  rpcUrl: string,
  anvil: ChildProcess
): Promise<Harness> {
  await waitForRpc(rpcUrl);
  const chain = localChain(rpcUrl);
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  }) as PublicClient;
  const wallets = DEV_KEYS.map((k) =>
    createWalletClient({
      account: privateKeyToAccount(k),
      chain,
      transport: http(rpcUrl),
    })
  );

  const deploy = async (
    walletIndex: number,
    name: string,
    file: string,
    args: readonly unknown[] = []
  ) => {
    const art = artifact(dir, file, name);
    const hash = await wallets[walletIndex].deployContract({
      abi: art.abi,
      bytecode: art.bytecode,
      args: args as unknown[],
      account: wallets[walletIndex].account!,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`deploy ${name} failed`);
    return getAddress(receipt.contractAddress);
  };
  const write = async (
    walletIndex: number,
    to: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[],
    value?: bigint
  ) => {
    const hash = await wallets[walletIndex].sendTransaction({
      to,
      data: encodeFunctionData({ abi, functionName, args: args as unknown[] }),
      value,
      account: wallets[walletIndex].account!,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success')
      throw new Error(`${functionName} reverted`);
    return hash;
  };

  const admin = wallets[0].account!.address;
  const engine = await deploy(0, 'SmartSession', 'SmartSession.sol');
  const validator = await deploy(0, 'AgentValidator', 'AgentValidator.sol');
  const urpLogic = await deploy(
    0,
    'UniversalRulesPolicy',
    'UniversalRulesPolicy.sol'
  );
  const urpAbi = artifact(
    dir,
    'UniversalRulesPolicy.sol',
    'UniversalRulesPolicy'
  ).abi;
  const rulesPolicy = await deploy(
    0,
    'TransparentUpgradeableProxy',
    'TransparentUpgradeableProxy.sol',
    [
      urpLogic,
      admin,
      encodeFunctionData({
        abi: urpAbi,
        functionName: 'initialize',
        args: [GATEWAY_PRECOMPILE, EXECUTOR_MODULE, engine],
      }),
    ]
  );
  const coreLogic = await deploy(
    0,
    'HarnessUniversalCore',
    'HarnessFixtures.sol'
  );
  const universalCore = getAddress(
    '0x00000000000000000000000000000000000000c0'
  );
  await publicClient.request({
    method: 'anvil_setCode' as never,
    params: [
      universalCore,
      await publicClient.getCode({ address: coreLogic }),
    ] as never,
  });
  // The stub's storage initializers are not installed by etching code.
  await publicClient.request({
    method: 'anvil_setStorageAt' as never,
    params: [
      universalCore,
      `0x${'00'.repeat(32)}`,
      `0x${BigInt(10 ** 15)
        .toString(16)
        .padStart(64, '0')}`,
    ] as never,
  });
  await publicClient.request({
    method: 'anvil_setStorageAt' as never,
    params: [
      universalCore,
      `0x${'00'.repeat(31)}01`,
      `0x${BigInt(10 ** 14)
        .toString(16)
        .padStart(64, '0')}`,
    ] as never,
  });
  const gatewayImpl = await deploy(
    0,
    'HarnessGatewayPC',
    'HarnessFixtures.sol',
    [universalCore]
  );
  const gatewayCode = await publicClient.getCode({ address: gatewayImpl });
  await publicClient.request({
    method: 'anvil_setCode' as never,
    params: [GATEWAY_PRECOMPILE, gatewayCode] as never,
  });
  const walletImplementation = await deploy(0, 'AGW', 'AGW.sol', [
    engine,
    rulesPolicy,
    validator,
    GATEWAY_PRECOMPILE,
  ]);
  const factoryLogic = await deploy(0, 'AGWFactory', 'AGWFactory.sol');
  const factoryAbi = artifact(dir, 'AGWFactory.sol', 'AGWFactory').abi;
  const factory = await deploy(0, 'ERC1967Proxy', 'ERC1967Proxy.sol', [
    factoryLogic,
    encodeFunctionData({
      abi: factoryAbi,
      functionName: 'initialize',
      args: [admin, walletImplementation],
    }),
  ]);
  const target = await deploy(0, 'HarnessTarget', 'HarnessFixtures.sol');

  resetAgenticGenerations();
  const generation = registerAgenticGeneration({
    id: 'v4',
    sourceCommit: 'e8db74815cfbbf5389593805e464fe8d85f7f735',
    network: PUSH_NETWORK.LOCALNET,
    advertised: false,
    addresses: {
      factory,
      walletImplementation,
      sessionEngine: engine,
      rulesPolicy,
      sessionValidator: validator,
      gateway: GATEWAY_PRECOMPILE,
    },
    startBlock: BigInt(0),
    accountId: ACCOUNT_ID,
  });

  const signerFor = (walletIndex: number) =>
    PushChain.utils.signer.toUniversalFromKeypair(wallets[walletIndex], {
      chain: CHAIN.PUSH_LOCALNET,
      library: LIBRARY.ETHEREUM_VIEM,
    });

  const client = async (
    walletIndex: number,
    opts: { agenticWallet?: Address; progressHook?: (e: unknown) => void } = {}
  ) =>
    PushChain.initialize(await signerFor(walletIndex), {
      network: PUSH_NETWORK.LOCALNET,
      rpcUrls: { [CHAIN.PUSH_LOCALNET]: [rpcUrl] },
      ...(opts.agenticWallet ? { agenticWallet: opts.agenticWallet } : {}),
      ...(opts.progressHook
        ? { progressHook: opts.progressHook as never }
        : {}),
    });

  const readOnlyClient = async (
    walletIndex: number,
    opts: { agenticWallet?: Address } = {}
  ) =>
    PushChain.initialize(
      {
        address: wallets[walletIndex].account!.address,
        chain: CHAIN.PUSH_LOCALNET,
      },
      {
        network: PUSH_NETWORK.LOCALNET,
        rpcUrls: { [CHAIN.PUSH_LOCALNET]: [rpcUrl] },
        ...(opts.agenticWallet ? { agenticWallet: opts.agenticWallet } : {}),
      }
    );

  return {
    rpcUrl,
    anvil,
    publicClient,
    wallets,
    generation,
    addresses: {
      engine,
      validator,
      rulesPolicy,
      walletImplementation,
      factory,
      universalCore,
      gateway: GATEWAY_PRECOMPILE,
      target,
    },
    deploy,
    write,
    client,
    readOnlyClient,
    dir,
    stop: async () => {
      resetAgenticGenerations();
      anvil.kill('SIGTERM');
    },
  };
}

export function artifactAbi(dir: string, file: string, name: string): Abi {
  return artifact(dir, file, name).abi;
}
