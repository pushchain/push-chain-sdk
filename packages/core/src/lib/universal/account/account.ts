import {
  bytesToHex,
  getAddress,
  Abi,
  http,
  createPublicClient,
  hexToBytes,
} from 'viem';
import { PublicKey } from '@solana/web3.js';
import {
  CHAIN_INFO,
  getPushViemChain,
  PUSH_CHAIN_INFO,
  VM_NAMESPACE,
} from '../../constants/chain';
import { CHAIN, VM, PUSH_NETWORK } from '../../constants/enums';
import {
  DerivedExecutorAccount,
  ExecutorAccountInfo,
  OriginAccountInfo,
  ResolvedControllerAccounts,
  UniversalAccount,
} from '../universal.types';
import { bs58 } from '../../internal/bs58';
import { FACTORY_V1 } from '../../constants/abi/factoryV1';
import { PushClient } from '../../push-client/push-client';
import { Cache, CacheKeys } from '../../cache/cache';
import { PushChain } from '../../push-chain/push-chain';
import {
  getCEAAddress,
  getPushAccountForCEA,
} from '../../orchestrator/cea-utils';

/**
 * Formats a blockchain address based on the virtual machine type of the provided chain.
 *
 * - For EVM chains, it converts the address to its checksummed format.
 * - For non-EVM chains (e.g., Solana), the original address is returned as-is. - Can be changed in future
 * @param {CHAIN} chain - A fully qualified chain identifier (e.g., CHAIN.ETHEREUM_MAINNET).
 * @param {string} address - The raw address string to normalize.
 * @returns {string} - A VM-compliant formatted address.
 *
 * @throws {Error} If an invalid EVM address is provided.
 *
 * @example
 * // EVM address gets checksummed
 * formatAddress(CHAIN.ETHEREUM_SEPOLIA, "0xabcd...") // → "0xAbCd..."
 *
 * @example
 * // Non-EVM address is returned as-is
 * formatAddress(CHAIN.SOLANA_DEVNET, "solanaAddress123") // → "solanaAddress123"
 */
function formatAddress(chain: CHAIN, address: string): string {
  if (CHAIN_INFO[chain].vm === VM.EVM) {
    try {
      return getAddress(address.toLowerCase());
    } catch {
      throw new Error('Invalid EVM address format');
    }
  }
  return address;
}

/**
 * Creates a `UniversalAccount` object from an address and chain options.
 * Alternative to createUniversalAccount with a different parameter structure.
 *
 * @param {string} address - The account address.
 * @param {Object} options - The configuration options.
 * @param {CHAIN} options.chain - The chain the account is associated with.
 * @returns {UniversalAccount} A normalized account object with chain and address.
 *
 * @example
 * const universalAccount = toUniversal(
 *   '0x35B84d6848D16415177c64D64504663b998A6ab4',
 *   { chain: CHAIN.ETHEREUM_SEPOLIA }
 * );
 * // → { chain: CHAIN.ETHEREUM_SEPOLIA, address: '0x35B84d6848D16415177c64D64504663b998A6ab4' }
 */
export function toUniversal(
  address: string,
  options: { chain: CHAIN }
): UniversalAccount {
  return {
    chain: options.chain,
    address: formatAddress(options.chain, address),
  };
}

/**
 * Converts an address and chain into a CAIP-10 style address string.
 *
 * Format: `namespace:chainId:address`
 * Namespace is derived from the chain's VM type using VM_NAMESPACE.
 *
 * @param {string} address - The account address to convert.
 * @param {Object} options - The configuration options.
 * @param {CHAIN} options.chain - The chain the account is associated with.
 * @returns {string} A CAIP-10 formatted string.
 *
 * @example
 * Utils.account.toChainAgnostic('0xabc123...', {
 *   chain: CHAIN.ETHEREUM_SEPOLIA
 * })
 * // → 'eip155:11155111:0xabc123...'
 */
export function toChainAgnostic(
  address: string,
  options: { chain: CHAIN }
): string {
  const { chain } = options;

  const chainMeta = CHAIN_INFO[chain];
  if (!chainMeta) {
    throw new Error(`Unrecognized chain: ${chain}`);
  }

  const { chainId, vm } = chainMeta;
  const namespace = VM_NAMESPACE[vm];

  return `${namespace}:${chainId}:${formatAddress(chain, address)}`;
}

/**
 * Converts a CAIP-10 formatted string into a UniversalAccount.
 *
 * @param {string} caip - A CAIP-10 address string (e.g., 'eip155:1:0xabc...').
 * @returns {UniversalAccount} The resolved account.
 * @throws {Error} If the CAIP string is invalid or unsupported.
 *
 * @example
 * Utils.account.fromChainAgnostic('eip155:11155111:0xabc...')
 * // → { chain: CHAIN.ETHEREUM_SEPOLIA, address: '0xabc...' }
 */
export function fromChainAgnostic(caip: string): UniversalAccount {
  const [namespace, chainId, rawAddress] = caip.split(':');

  const chain = (Object.entries(CHAIN_INFO).find(
    ([, info]) =>
      info.chainId === chainId && VM_NAMESPACE[info.vm] === namespace
  )?.[0] ?? null) as CHAIN | null;

  if (!chain) {
    throw new Error(`Unsupported or unknown CAIP address: ${caip}`);
  }

  return {
    chain,
    address: formatAddress(chain, rawAddress),
  };
}

// Global cache instance for convertOriginToExecutor
const accountCache = new Cache();

// Cache for convertExecutorToOrigin — UEA→origin mapping is immutable once deployed.
// Keyed by `${address}:${network}` to handle different Push Chain networks.
const executorToOriginCache = new Map<string, OriginAccountInfo>();

/**
 * Determines the Push Network based on the chain type (testnet vs mainnet)
 */
function getPushNetworkFromChain(chain: CHAIN): PUSH_NETWORK {
  const testnetChains = [
    CHAIN.ETHEREUM_SEPOLIA,
    CHAIN.ARBITRUM_SEPOLIA,
    CHAIN.BASE_SEPOLIA,
    CHAIN.BNB_TESTNET,
    CHAIN.SOLANA_TESTNET,
    CHAIN.SOLANA_DEVNET,
    CHAIN.PUSH_TESTNET_DONUT,
    CHAIN.PUSH_TESTNET,
    CHAIN.PUSH_LOCALNET,
  ];

  const mainnetChains = [
    CHAIN.ETHEREUM_MAINNET,
    CHAIN.SOLANA_MAINNET,
    CHAIN.PUSH_MAINNET,
  ];

  const localnetChains = [CHAIN.PUSH_LOCALNET];

  if (testnetChains.includes(chain)) {
    return PUSH_NETWORK.TESTNET_DONUT;
  } else if (mainnetChains.includes(chain)) {
    return PUSH_NETWORK.MAINNET;
  } else if (localnetChains.includes(chain)) {
    return PUSH_NETWORK.LOCALNET;
  } else {
    throw new Error(`Unsupported chain for Push Network mapping: ${chain}`);
  }
}

let _convertOriginToExecutorWarned = false;

/**
 * @deprecated Use `deriveExecutorAccount()` instead, which accepts a CAIP-10
 *   string and uses `options.chain` to control UEA vs CEA derivation.
 */
export async function convertOriginToExecutor(
  account: UniversalAccount,
  options: {
    chain?: CHAIN;
    onlyCompute?: boolean;
  } = { onlyCompute: true }
): Promise<ExecutorAccountInfo> {
  if (!_convertOriginToExecutorWarned) {
    console.warn(
      '[PushChain] convertOriginToExecutor() is deprecated. Use deriveExecutorAccount() instead.'
    );
    _convertOriginToExecutorWarned = true;
  }
  const { chain, address } = account;
  const { vm, chainId } = CHAIN_INFO[chain];

  // If target chain is external, compute CEA on that chain
  if (options.chain && !isPushChain(options.chain)) {
    // Get UEA first — if input is already on Push chain, use directly
    let ueaAddress: `0x${string}`;
    if (isPushChain(chain)) {
      ueaAddress = address as `0x${string}`;
    } else {
      // Compute UEA from origin account
      const ueaResult = await convertOriginToExecutor(account, {
        onlyCompute: false,
      });
      ueaAddress = ueaResult.address;
    }

    // Get CEA on the target external chain
    const { cea, isDeployed } = await getCEAAddress(
      ueaAddress,
      options.chain
    );

    if (options.onlyCompute) {
      return { address: cea, deployed: isDeployed };
    }
    return { address: cea };
  }

  if (isPushChain(chain)) {
    if (options.onlyCompute) {
      return { address: account.address as `0x${string}`, deployed: false };
    }
    return { address: account.address as `0x${string}` };
  }

  // Determine Push Network from the chain
  const pushNetwork = getPushNetworkFromChain(chain);

  // Check cache for computed address
  const cachedAddress = accountCache.get(
    CacheKeys.ueaAddressOnchain(chain, address, pushNetwork, vm)
  );

  if (cachedAddress) {
    if (options.onlyCompute) {
      // Check cache for deployment status
      const cachedDeploymentStatus = accountCache.get(
        CacheKeys.deploymentStatus(cachedAddress)
      );
      if (cachedDeploymentStatus !== null) {
        return {
          address: cachedAddress as `0x${string}`,
          deployed: cachedDeploymentStatus,
        };
      }
    } else {
      return { address: cachedAddress as `0x${string}` };
    }
  }

  let pushChain: CHAIN;
  if (pushNetwork === PUSH_NETWORK.MAINNET) {
    pushChain = CHAIN.PUSH_MAINNET;
  } else if (
    pushNetwork === PUSH_NETWORK.TESTNET_DONUT ||
    pushNetwork === PUSH_NETWORK.TESTNET
  ) {
    pushChain = CHAIN.PUSH_TESTNET_DONUT;
  } else {
    pushChain = CHAIN.PUSH_LOCALNET;
  }

  // Create PushClient to get factory address
  const pushClient = new PushClient({
    rpcUrls: CHAIN_INFO[pushChain].defaultRPC,
    network: pushNetwork,
  });

  const computedAddress: `0x${string}` = await pushClient.readContract({
    address: pushClient.pushChainInfo.factoryAddress,
    abi: FACTORY_V1 as Abi,
    functionName: 'computeUEA',
    args: [
      {
        chainNamespace: VM_NAMESPACE[vm],
        chainId: chainId,
        /**
         * @dev - OwnerKey should be in bytes
         * for eth - convert hex to bytes
         * for sol - convert base64 to bytes
         * for others - not defined yet
         */
        owner:
          vm === VM.EVM
            ? address
            : vm === VM.SVM
            ? bytesToHex(Uint8Array.from(bs58.decode(address)))
            : address,
      },
    ],
  });

  // Cache the computed address
  accountCache.set(
    CacheKeys.ueaAddressOnchain(chain, address, pushNetwork, vm),
    computedAddress
  );

  const byteCode = await pushClient.publicClient.getCode({
    address: computedAddress,
  });

  const isDeployed = byteCode !== undefined;

  // Cache the deployment status
  accountCache.set(CacheKeys.deploymentStatus(computedAddress), isDeployed);

  if (options.onlyCompute) {
    return { address: computedAddress, deployed: isDeployed };
  }
  return { address: computedAddress };
}

/**
 * Convert Executor to Origin Account
 *
 * Given a UEA (executor) address on Push Chain, returns the mapped origin
 * account and an existence flag.
 *
 * @deprecated Use `convertExecutorToOrigin()` instead, which supports both
 *   UEA and CEA lookups via the optional `options.chain` parameter.
 */
let _convertExecutorToOriginAccountWarned = false;

export async function convertExecutorToOriginAccount(
  ueaAddress: `0x${string}`,
  options?: { network?: PUSH_NETWORK }
): Promise<OriginAccountInfo> {
  if (!_convertExecutorToOriginAccountWarned) {
    console.warn(
      '[PushChain] convertExecutorToOriginAccount() is deprecated. Use resolveControllerAccount() instead.'
    );
    _convertExecutorToOriginAccountWarned = true;
  }
  const pushChainKey = pushNetworkToChainKey(options?.network ?? PUSH_NETWORK.TESTNET_DONUT);
  const RPC_URL = PUSH_CHAIN_INFO[pushChainKey].defaultRPC[0];
  const FACTORY_ADDRESS =
    PUSH_CHAIN_INFO[pushChainKey].factoryAddress;

  // Create viem public client
  const client = createPublicClient({
    chain: getPushViemChain(pushChainKey),
    transport: http(RPC_URL),
  });

  const originResult = (await client.readContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_V1,
    functionName: 'getOriginForUEA',
    args: [ueaAddress],
  })) as [
    { chainNamespace: string; chainId: string; owner: `0x${string}` },
    boolean
  ];

  const [account, isUEA] = originResult;

  if (
    account.chainNamespace === '' ||
    account.chainId === '' ||
    account.owner === '0x'
  ) {
    return { account: null, exists: isUEA };
  }

  const universalAccount = PushChain.utils.account.fromChainAgnostic(
    `${account.chainNamespace}:${account.chainId}:${account.owner}`
  );
  if (isUEA) {
    if (universalAccount.chain.startsWith(VM_NAMESPACE[VM.SVM])) {
      // Convert hex-encoded owner to base58 address format
      const hexBytes = hexToBytes(account.owner);
      universalAccount.address = bs58.encode(Buffer.from(hexBytes));
    }
  }

  return { account: universalAccount, exists: isUEA };
}

/**
 * Convert Executor to Origin Account (with optional chain context)
 *
 * - Without `chain`: treats the address as a UEA on Push Chain and returns
 *   the mapped origin account (same as convertExecutorToOriginAccount).
 * - With `chain`: treats the address as a CEA on the specified external chain,
 *   looks up the corresponding PushAccount (UEA) on Push Chain, and returns it.
 *
 * @deprecated Use `resolveControllerAccount()` instead, which accepts a CAIP-10
 *   string and supports both UEA and CEA lookups via `options.chain`.
 */
let _convertExecutorToOriginWarned = false;

export async function convertExecutorToOrigin(
  executorAddress: string,
  options?: {
    chain?: CHAIN;
    network?: PUSH_NETWORK;
    /** @internal Skip deprecation warning for SDK-internal calls */
    _internal?: boolean;
  }
): Promise<OriginAccountInfo> {
  if (!options?._internal && !_convertExecutorToOriginWarned) {
    console.warn(
      '[PushChain] convertExecutorToOrigin() is deprecated. Use resolveControllerAccount() instead.'
    );
    _convertExecutorToOriginWarned = true;
  }

  if (options?.chain && !isPushChain(options.chain)) {
    // CEA on external chain → look up PushAccount (UEA) on Push Chain
    const pushAccountAddress = await getPushAccountForCEA(
      executorAddress as `0x${string}`,
      options.chain
    );

    if (
      pushAccountAddress ===
      '0x0000000000000000000000000000000000000000'
    ) {
      return { account: null, exists: false };
    }

    // Determine Push Chain from the external chain's network
    const pushNetwork = getPushNetworkFromChain(options.chain);
    let pushChain: CHAIN;
    if (pushNetwork === PUSH_NETWORK.MAINNET) {
      pushChain = CHAIN.PUSH_MAINNET;
    } else if (
      pushNetwork === PUSH_NETWORK.TESTNET_DONUT ||
      pushNetwork === PUSH_NETWORK.TESTNET
    ) {
      pushChain = CHAIN.PUSH_TESTNET_DONUT;
    } else {
      pushChain = CHAIN.PUSH_LOCALNET;
    }

    return {
      account: {
        chain: pushChain,
        address: pushAccountAddress,
      },
      exists: true,
    };
  }

  // Default: UEA on Push Chain → origin account
  const network = options?.network ?? PUSH_NETWORK.TESTNET_DONUT;
  const cacheKey = `${executorAddress.toLowerCase()}:${network}`;
  const cached = executorToOriginCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pushChainKey = pushNetworkToChainKey(network);
  const RPC_URL = PUSH_CHAIN_INFO[pushChainKey].defaultRPC[0];
  const FACTORY_ADDRESS =
    PUSH_CHAIN_INFO[pushChainKey].factoryAddress;

  const client = createPublicClient({
    chain: getPushViemChain(pushChainKey),
    transport: http(RPC_URL),
  });

  const originResult = (await client.readContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_V1,
    functionName: 'getOriginForUEA',
    args: [executorAddress as `0x${string}`],
  })) as [
    { chainNamespace: string; chainId: string; owner: `0x${string}` },
    boolean
  ];

  const [account, isUEA] = originResult;

  if (
    account.chainNamespace === '' ||
    account.chainId === '' ||
    account.owner === '0x'
  ) {
    const result: OriginAccountInfo = { account: null, exists: isUEA };
    executorToOriginCache.set(cacheKey, result);
    return result;
  }

  const universalAccount = PushChain.utils.account.fromChainAgnostic(
    `${account.chainNamespace}:${account.chainId}:${account.owner}`
  );
  if (isUEA) {
    if (universalAccount.chain.startsWith(VM_NAMESPACE[VM.SVM])) {
      const hexBytes = hexToBytes(account.owner);
      universalAccount.address = bs58.encode(Buffer.from(hexBytes));
    }
  }

  const result: OriginAccountInfo = { account: universalAccount, exists: isUEA };
  executorToOriginCache.set(cacheKey, result);
  return result;
}

/**
 * Maps a PUSH_NETWORK to the corresponding Push Chain key for PUSH_CHAIN_INFO lookup.
 */
function pushNetworkToChainKey(
  network: PUSH_NETWORK
): CHAIN.PUSH_MAINNET | CHAIN.PUSH_TESTNET_DONUT | CHAIN.PUSH_LOCALNET {
  if (network === PUSH_NETWORK.MAINNET) return CHAIN.PUSH_MAINNET;
  if (network === PUSH_NETWORK.TESTNET_DONUT || network === PUSH_NETWORK.TESTNET) return CHAIN.PUSH_TESTNET_DONUT;
  return CHAIN.PUSH_LOCALNET;
}

function isPushChain(chain: CHAIN): boolean {
  return (
    chain === CHAIN.PUSH_MAINNET ||
    chain === CHAIN.PUSH_TESTNET_DONUT ||
    chain === CHAIN.PUSH_LOCALNET
  );
}

/**
 * Resolves the chain name (enum key) for a CHAIN value.
 * e.g., CHAIN.PUSH_TESTNET_DONUT → "PUSH_TESTNET_DONUT"
 */
function getChainName(chain: CHAIN): string {
  // Special case: prefer PUSH_TESTNET_DONUT over PUSH_TESTNET for 'eip155:42101'
  if ((chain as string) === 'eip155:42101') {
    return 'PUSH_TESTNET_DONUT';
  }
  const entry = Object.entries(CHAIN).find(([, val]) => val === chain);
  return entry ? entry[0] : chain;
}

/**
 * Derive the SVM CEA (PDA) for a UEA address on a Solana-based chain.
 *
 * Solana doesn't use a CEAFactory contract — instead, the CEA is a
 * Program Derived Address (PDA) with seeds: ["push_identity", ueaBytes]
 * and the SVM gateway program as the program ID.
 *
 * @param ueaAddress - The UEA (or Push EOA) hex address (20 bytes).
 * @param targetChain - The SVM target chain.
 * @param skipNetworkCheck - Whether to skip deployment status check.
 * @returns The derived 32-byte Solana PDA address (as 0x-prefixed hex) and deployment status.
 */
export function deriveSvmCeaPda(
  ueaAddress: `0x${string}`,
  targetChain: CHAIN,
  skipNetworkCheck: boolean
): DerivedExecutorAccount {
  const gatewayAddress = CHAIN_INFO[targetChain].lockerContract;
  if (!gatewayAddress) {
    throw new Error(`SVM gateway program not configured for chain ${targetChain}`);
  }
  const gatewayProgramId = new PublicKey(gatewayAddress);
  const ueaBytes = Buffer.from(ueaAddress.slice(2), 'hex'); // 20 bytes
  const [ceaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('push_identity'), ueaBytes],
    gatewayProgramId
  );
  const ceaPdaHex = ('0x' +
    Buffer.from(ceaPda.toBytes()).toString('hex')) as `0x${string}`;

  return { address: ceaPdaHex, deployed: skipNetworkCheck ? null : null };
}

/**
 * Derive the executor account (UEA or CEA) for a given account.
 *
 * - If account is on an external chain (Ethereum, Solana, etc.):
 *   Computes the UEA on Push Chain via the factory contract's computeUEA.
 *   If options.chain is an external chain, further derives the CEA on that chain.
 *
 * - If account is on Push Chain:
 *   Returns the address as-is (it's already a UEA or Push EOA).
 *   If options.chain is an external chain, derives the CEA on that chain.
 *
 * @param account - UniversalAccount with chain and address.
 * @param options.chain - Target external chain for CEA derivation. If omitted, returns UEA.
 * @param options.skipNetworkCheck - If true, skip deployment check and return deployed: false.
 * @returns The derived executor account address and deployment status.
 */
export async function deriveExecutorAccount(
  account: UniversalAccount,
  options?: {
    chain?: CHAIN;
    skipNetworkCheck?: boolean;
  }
): Promise<DerivedExecutorAccount> {
  const skipNetworkCheck = options?.skipNetworkCheck ?? false;
  const targetChain = options?.chain;
  const { chain, address } = account;

  // --- Case 1: Input is on an external chain ---
  if (!isPushChain(chain)) {
    const { vm, chainId } = CHAIN_INFO[chain];
    const pushNetwork = getPushNetworkFromChain(chain);

    // Check cache for previously computed UEA
    const cachedUea = accountCache.get(
      CacheKeys.ueaAddressOnchain(chain, address, pushNetwork, vm)
    );

    let ueaAddress: `0x${string}`;

    if (cachedUea) {
      ueaAddress = cachedUea as `0x${string}`;
    } else {
      // Compute UEA via factory contract
      const pushChainKey = pushNetworkToChainKey(pushNetwork);
      const pushClient = new PushClient({
        rpcUrls: CHAIN_INFO[pushChainKey].defaultRPC,
        network: pushNetwork,
      });

      ueaAddress = await pushClient.readContract({
        address: pushClient.pushChainInfo.factoryAddress,
        abi: FACTORY_V1 as Abi,
        functionName: 'computeUEA',
        args: [
          {
            chainNamespace: VM_NAMESPACE[vm],
            chainId: chainId,
            owner:
              vm === VM.EVM
                ? address
                : vm === VM.SVM
                ? bytesToHex(Uint8Array.from(bs58.decode(address)))
                : address,
          },
        ],
      });

      // Cache the computed address
      accountCache.set(
        CacheKeys.ueaAddressOnchain(chain, address, pushNetwork, vm),
        ueaAddress
      );
    }

    // If target chain is external, derive CEA from the computed UEA
    if (targetChain && !isPushChain(targetChain)) {
      // SVM chains use PDA derivation, not CEAFactory
      if (CHAIN_INFO[targetChain].vm === VM.SVM) {
        return deriveSvmCeaPda(ueaAddress, targetChain, skipNetworkCheck);
      }
      const { cea, isDeployed } = await getCEAAddress(
        ueaAddress,
        targetChain
      );
      return { address: cea, deployed: skipNetworkCheck ? null : isDeployed };
    }

    // Return UEA with deployment check
    if (skipNetworkCheck) {
      return { address: ueaAddress, deployed: null };
    }

    const pushChainKey = pushNetworkToChainKey(pushNetwork);
    const pushClient = new PushClient({
      rpcUrls: CHAIN_INFO[pushChainKey].defaultRPC,
      network: pushNetwork,
    });
    const byteCode = await pushClient.publicClient.getCode({
      address: ueaAddress,
    });
    const isDeployed = byteCode !== undefined;
    accountCache.set(CacheKeys.deploymentStatus(ueaAddress), isDeployed);

    return { address: ueaAddress, deployed: isDeployed };
  }

  // --- Case 2: Input is on Push Chain ---
  // If target chain is external, derive CEA
  if (targetChain && !isPushChain(targetChain)) {
    // SVM chains use PDA derivation, not CEAFactory
    if (CHAIN_INFO[targetChain].vm === VM.SVM) {
      return deriveSvmCeaPda(
        address as `0x${string}`,
        targetChain,
        skipNetworkCheck
      );
    }
    const { cea, isDeployed } = await getCEAAddress(
      address as `0x${string}`,
      targetChain
    );
    return { address: cea, deployed: skipNetworkCheck ? null : isDeployed };
  }

  // Push address, no external target — return with deployment check
  if (skipNetworkCheck) {
    return { address: address as `0x${string}`, deployed: null };
  }

  const pushNetwork =
    targetChain && isPushChain(targetChain)
      ? getPushNetworkFromChain(targetChain)
      : getPushNetworkFromChain(chain);
  const pushChainKey = pushNetworkToChainKey(pushNetwork);
  const pushClient = new PushClient({
    rpcUrls: CHAIN_INFO[pushChainKey].defaultRPC,
    network: pushNetwork,
  });
  const byteCode = await pushClient.publicClient.getCode({
    address: address as `0x${string}`,
  });
  return {
    address: address as `0x${string}`,
    deployed: byteCode !== undefined,
  };
}

/**
 * Resolve the controller (origin) accounts for a given executor address.
 *
 * Given a UEA or CEA plain address, resolves the full controller chain
 * back to the origin account.
 *
 * @param address - Plain address string of the executor account (e.g., "0xABC...")
 * @param options.chain - Chain context. If external chain, address is treated as CEA on that chain. If omitted or Push chain, address is treated as UEA on Push Chain.
 * @param options.skipNetworkCheck - If true, skip existence checks, set exists: false
 * @returns Resolved accounts in the controller chain
 */
export async function resolveControllerAccount(
  address: string,
  options?: {
    chain?: CHAIN;
    skipNetworkCheck?: boolean;
  }
): Promise<ResolvedControllerAccounts> {
  const inputChain = options?.chain;
  const skipNetworkCheck = options?.skipNetworkCheck ?? false;

  // Case A: External chain → address is a CEA on that chain
  if (inputChain && !isPushChain(inputChain)) {
    // Look up UEA on Push Chain from CEA
    const pushAccountAddress = await getPushAccountForCEA(
      address as `0x${string}`,
      inputChain
    );

    if (
      pushAccountAddress === '0x0000000000000000000000000000000000000000'
    ) {
      return { accounts: [] };
    }

    // Determine Push Chain from external chain's network
    const pushNetwork = getPushNetworkFromChain(inputChain);
    const pushChainKey = pushNetworkToChainKey(pushNetwork);

    // Now resolve UEA → origin
    const pushChainId = pushChainKey as CHAIN;
    const RPC_URL = PUSH_CHAIN_INFO[pushChainKey].defaultRPC[0];
    const FACTORY_ADDRESS = PUSH_CHAIN_INFO[pushChainKey].factoryAddress;

    const client = createPublicClient({
      chain: getPushViemChain(pushChainKey),
      transport: http(RPC_URL),
    });

    const originResult = (await client.readContract({
      address: FACTORY_ADDRESS,
      abi: FACTORY_V1,
      functionName: 'getOriginForUEA',
      args: [pushAccountAddress],
    })) as [
      { chainNamespace: string; chainId: string; owner: `0x${string}` },
      boolean
    ];

    const [originAccount, isUEA] = originResult;
    const accounts: ResolvedControllerAccounts['accounts'] = [];

    // Add UEA entry
    accounts.push({
      chain: pushChainId,
      chainName: getChainName(pushChainId),
      address: pushAccountAddress,
      type: 'uea',
      exists: skipNetworkCheck ? false : true,
    });

    // Add origin (UOA) entry if found
    if (
      isUEA &&
      originAccount.chainNamespace !== '' &&
      originAccount.chainId !== '' &&
      originAccount.owner !== '0x'
    ) {
      const originUniversal = fromChainAgnostic(
        `${originAccount.chainNamespace}:${originAccount.chainId}:${originAccount.owner}`
      );

      // Handle SVM address conversion
      let originAddress = originUniversal.address;
      if (originUniversal.chain.startsWith(VM_NAMESPACE[VM.SVM])) {
        const hexBytes = hexToBytes(originAccount.owner);
        originAddress = bs58.encode(Buffer.from(hexBytes));
      }

      accounts.push({
        chain: originUniversal.chain,
        chainName: getChainName(originUniversal.chain),
        address: originAddress,
        type: 'uoa',
        exists: skipNetworkCheck ? false : true,
        role: 'controller',
      });
    }

    return { accounts };
  }

  // Case B: No chain or Push chain → address is a UEA or EOA on Push Chain
  const pushNetwork =
    inputChain && isPushChain(inputChain)
      ? getPushNetworkFromChain(inputChain)
      : PUSH_NETWORK.TESTNET_DONUT;
  const pushChainKey = pushNetworkToChainKey(pushNetwork);
  const pushChainId = pushChainKey as CHAIN;
  const RPC_URL = PUSH_CHAIN_INFO[pushChainKey].defaultRPC[0];
  const FACTORY_ADDRESS = PUSH_CHAIN_INFO[pushChainKey].factoryAddress;

  const client = createPublicClient({
    chain: getPushViemChain(pushChainKey),
    transport: http(RPC_URL),
  });

  const originResult = (await client.readContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_V1,
    functionName: 'getOriginForUEA',
    args: [address as `0x${string}`],
  })) as [
    { chainNamespace: string; chainId: string; owner: `0x${string}` },
    boolean
  ];

  const [originAccount, isUEA] = originResult;

  // If it's a UEA, resolve to origin
  if (
    isUEA &&
    originAccount.chainNamespace !== '' &&
    originAccount.chainId !== '' &&
    originAccount.owner !== '0x'
  ) {
    const originUniversal = fromChainAgnostic(
      `${originAccount.chainNamespace}:${originAccount.chainId}:${originAccount.owner}`
    );

    // Handle SVM address conversion
    let originAddress = originUniversal.address;
    if (originUniversal.chain.startsWith(VM_NAMESPACE[VM.SVM])) {
      const hexBytes = hexToBytes(originAccount.owner);
      originAddress = bs58.encode(Buffer.from(hexBytes));
    }

    return {
      accounts: [
        {
          chain: originUniversal.chain,
          chainName: getChainName(originUniversal.chain),
          address: originAddress,
          type: 'uoa',
          exists: skipNetworkCheck ? false : true,
          role: 'controller',
        },
      ],
    };
  }

  // Not a UEA — Push Chain EOA/smart contract, return as controller
  return {
    accounts: [
      {
        chain: pushChainId,
        chainName: getChainName(pushChainId),
        address: address,
        type: 'uoa',
        exists: skipNetworkCheck ? false : true,
        role: 'controller',
      },
    ],
  };
}
