import {
  bytesToHex,
  hexToBytes,
  parseTransaction,
  WalletClient,
  Hex,
} from 'viem';
import { TypedDataDomain, TypedData } from '../../constants';
import {
  EthersV5SignerType,
  EthersV6SignerType,
  SignAuthorizationParams,
  SignedAuthorization,
  UniversalAccount,
  UniversalSigner,
  UniversalSignerSkeleton,
  ViemSignerType,
} from '../universal.types';
let _nacl: typeof import('tweetnacl') | null = null;
async function getNacl() {
  if (!_nacl) _nacl = await import('tweetnacl');
  return _nacl;
}
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import { CHAIN, LIBRARY } from '../../constants/enums';
import { CHAIN_INFO } from '../../constants/chain';
import { bs58 } from '../../internal/bs58';

/**
 * Converts viem's parsed transaction to an ethers-compatible TransactionRequest.
 * viem uses `gas` while ethers expects `gasLimit`.
 *
 * For EIP-7702 (type-4) transactions the `authorizationList` entries also need
 * reshaping: viem represents the signature inline (`r`/`s`/`yParity`), whereas
 * ethers expects a nested `signature`. Without this conversion ethers normalises
 * the entry to a zero signature and the delegation is silently dropped.
 */
function toEthersTxRequest(
  viemTx: ReturnType<typeof parseTransaction>
): Record<string, unknown> {
  const { gas, type, authorizationList, ...rest } = viemTx as Record<
    string,
    any
  >;
  const out: Record<string, unknown> = { ...rest, gasLimit: gas };
  if (Array.isArray(authorizationList) && authorizationList.length > 0) {
    out['type'] = 4;
    out['authorizationList'] = authorizationList.map((a: any) => ({
      address: a.address ?? a.contractAddress,
      chainId: a.chainId,
      nonce: a.nonce,
      signature: { r: a.r, s: a.s, yParity: a.yParity },
    }));
  }
  return out;
}

/**
 * Builds an EIP-7702 `signAuthorization` for a viem WalletClient, but ONLY when
 * the underlying account can sign offline (a local account). viem exposes the
 * `signAuthorization` action on every client — including JSON-RPC accounts that
 * cannot actually produce one — so we gate on `account.signAuthorization`
 * (present on local accounts only). Returns `undefined` otherwise so callers
 * fall back to non-7702 execution.
 */
function viemSignAuthorization(
  wallet: any,
  address: string
):
  | ((params: SignAuthorizationParams) => Promise<SignedAuthorization>)
  | undefined {
  const account = wallet?.account;
  if (!account || typeof account.signAuthorization !== 'function') {
    return undefined;
  }
  return async ({ contractAddress, chainId, nonce, executor }) => {
    const auth = await wallet.signAuthorization({
      account: account || (address as `0x${string}`),
      contractAddress,
      ...(chainId !== undefined ? { chainId } : {}),
      ...(nonce !== undefined ? { nonce } : {}),
      ...(executor ? { executor } : {}),
    });
    return auth as SignedAuthorization;
  };
}

/**
 * Builds an EIP-7702 `signAuthorization` for an ethers v6 signer. Presence of
 * `authorize` is not a reliable capability signal (AbstractSigner's default
 * throws), so callers MUST also handle a runtime failure and fall back — see
 * `EIP7702NotSupportedError` in evm-client. Returns `undefined` when the method
 * is entirely absent (e.g. ethers v5).
 */
function ethersSignAuthorization(
  wallet: any,
  chain: CHAIN
):
  | ((params: SignAuthorizationParams) => Promise<SignedAuthorization>)
  | undefined {
  if (typeof wallet?.authorize !== 'function') return undefined;
  return async ({ contractAddress, chainId, nonce }) => {
    const cid = chainId ?? Number(chain.split(':')[1]);
    const auth = await wallet.authorize({
      address: contractAddress,
      chainId: cid,
      nonce: nonce ?? 0,
    });
    const sig = auth.signature;
    return {
      address: contractAddress,
      chainId: Number(auth.chainId ?? cid),
      nonce: Number(auth.nonce ?? nonce ?? 0),
      r: sig.r as `0x${string}`,
      s: sig.s as `0x${string}`,
      yParity: Number(sig.yParity),
    };
  };
}

/**
 * Maps an EVM numeric chainId to the corresponding CHAIN enum.
 * Shared by all signer skeleton generators to avoid duplication.
 */
function chainIdToChain(chainId: string | number | bigint): CHAIN {
  const id = chainId.toString();
  switch (id) {
    case '11155111':
      return CHAIN.ETHEREUM_SEPOLIA;
    case '421614':
      return CHAIN.ARBITRUM_SEPOLIA;
    case '84532':
      return CHAIN.BASE_SEPOLIA;
    case '97':
      return CHAIN.BNB_TESTNET;
    case '1':
      return CHAIN.ETHEREUM_MAINNET;
    case '9':
      return CHAIN.PUSH_MAINNET;
    case '42101':
      return CHAIN.PUSH_TESTNET;
    case '9000':
      return CHAIN.PUSH_LOCALNET;
    default:
      throw new Error(`Unsupported chainId: ${chainId}`);
  }
}

/**
 * Creates a `UniversalSigner` object for signing messages and transactions
 * on any supported chain.
 *
 * @param {Object} params - The signer configuration object.
 * @param {string} params.address - The signer's address.
 * @param {(data: Uint8Array) => Promise<Uint8Array>} params.signMessage - Required function to sign messages.
 * @param {(data: Uint8Array) => Promise<Uint8Array>} [params.signAndSendTransaction] - Required function to sign and send transactions.
 * @param {CHAIN} params.chain - The chain the signer will operate on.
 * @returns {UniversalSigner} A signer object with chain metadata.
 *
 * @example
 * const signer = createUniversalSigner({
 *   chain: CHAIN.ETHEREUM_SEPOLIA
 *   address: "0xabc...",
 *   signMessage: async (data) => sign(data),
 *   signAndSendTransaction: async (data) => signRawTx(data),
 * });
 */
export function createUniversalSigner({
  account,
  signMessage,
  signAndSendTransaction,
  signTypedData,
  signAuthorization,
}: UniversalSigner): UniversalSigner {
  return {
    account,
    signMessage,
    signAndSendTransaction,
    signTypedData,
    signAuthorization,
  };
}

/**
 * Creates a UniversalSigner from either a viem, ethers, solana WalletClient or Account instance.
 *
 * @param {WalletClient | Account | Keypair} clientOrAccount - The viem WalletClient or Account instance
 * @param {CHAIN} chain - The chain the signer will operate on
 * @returns {Promise<UniversalSigner>} A signer object configured for the specified chain
 */
export async function toUniversalFromKeypair(
  clientOrAccount: WalletClient | Keypair | EthersV6SignerType,
  { chain, library }: { chain: CHAIN; library: LIBRARY }
): Promise<UniversalSigner> {
  let address: string;
  let signMessage: (data: Uint8Array) => Promise<Uint8Array>;
  let signAndSendTransaction: (unsignedTx: Uint8Array) => Promise<Uint8Array>;
  let signTypedData: ({
    domain,
    types,
    primaryType,
    message,
  }: {
    domain: TypedDataDomain;
    types: TypedData;
    primaryType: string;
    message: Record<string, any>;
  }) => Promise<Uint8Array>;
  // Optional: only set for EVM wallets that support EIP-7702 authorization
  // signing. Left undefined for Solana and wallets without 7702 support, in
  // which case callers fall back to a non-7702 path.
  let signAuthorization:
    | ((params: SignAuthorizationParams) => Promise<SignedAuthorization>)
    | undefined;

  // Check if signer has UID='custom', then we take signMessage, signAndSendTransaction, signTypedData, chain and address from the CustomUniversalSigner.
  // If ViemSigner, convert ViemSigner to UniversalSigner.

  switch (library) {
    case LIBRARY.ETHEREUM_ETHERSV6: {
      if (
        typeof (clientOrAccount as any).signMessage !== 'function' ||
        typeof (clientOrAccount as any).sendTransaction !== 'function' ||
        typeof (clientOrAccount as any).getAddress !== 'function'
      ) {
        throw new Error(
          'Expected an object with signMessage, sendTransaction, getAddress methods for ETHEREUM_ETHERSV6 library'
        );
      }
      const wallet = clientOrAccount as EthersV6SignerType;
      if (!wallet.provider) {
        throw new Error('ethers.Wallet must have a provider attached');
      }
      // fetch on-chain chainId
      const { chainId } = await wallet.provider.getNetwork();
      if (chainId.toString() !== chain.split(':')[1]) {
        throw new Error(
          `Chain mismatch: wallet is on ${chainId}, expected ${chain}`
        );
      }

      address = await wallet.getAddress();

      // raw bytes → signMessage → hex → back to bytes
      signMessage = async (data) => {
        const sigHex = await wallet.signMessage(data);
        return hexToBytes(sigHex as Hex);
      };

      // raw unsigned tx bytes → hex → parse → signAndSendTransaction → bytes
      signAndSendTransaction = async (raw) => {
        const unsignedHex = bytesToHex(raw);
        const tx = toEthersTxRequest(parseTransaction(unsignedHex));
        const txResponse = await wallet.sendTransaction(tx);
        return hexToBytes(txResponse.hash as Hex);
      };

      // EIP-712 typed data → signTypedData → hex → bytes
      signTypedData = async ({ domain, types, primaryType, message }) => {
        const sigHex = await wallet.signTypedData(
          domain,
          types as unknown as Record<string, any[]>,
          message
        );
        return hexToBytes(sigHex as Hex);
      };

      // EIP-7702 authorization signing (ethers v6). Backed by a runtime
      // fallback in evm-client since `authorize` presence isn't a guarantee.
      signAuthorization = ethersSignAuthorization(wallet, chain);

      break;
    }

    case LIBRARY.ETHEREUM_VIEM: {
      const wallet = clientOrAccount as WalletClient;
      address = (await wallet.getAddresses())[0];

      signMessage = async (data: Uint8Array) => {
        const hexSig = await (clientOrAccount as WalletClient).signMessage({
          account: wallet.account || (address as `0x${string}`),
          message: { raw: data },
        });
        return hexToBytes(hexSig);
      };

      signAndSendTransaction = async (unsignedTx: Uint8Array) => {
        const tx = parseTransaction(bytesToHex(unsignedTx));
        const txHash = await wallet.sendTransaction(tx as never);
        return hexToBytes(txHash);
      };

      signTypedData = async ({ domain, types, primaryType, message }) => {
        const hexSig = await wallet.signTypedData({
          domain,
          types,
          primaryType,
          message,
          account:
            (clientOrAccount as WalletClient).account ||
            (address as `0x${string}`),
        });
        return hexToBytes(hexSig);
      };

      // EIP-7702 authorization signing — only for local viem accounts that can
      // sign offline (gated inside the helper); JSON-RPC accounts fall back.
      signAuthorization = viemSignAuthorization(wallet, address);
      break;
    }

    case LIBRARY.SOLANA_WEB3JS: {
      const keypair = clientOrAccount as Keypair;
      if (
        chain !== CHAIN.SOLANA_MAINNET &&
        chain !== CHAIN.SOLANA_TESTNET &&
        chain !== CHAIN.SOLANA_DEVNET
      ) {
        throw new Error('Invalid chain for Solana Keypair');
      }

      address = keypair.publicKey.toBase58();

      signMessage = async (data: Uint8Array) => {
        const nacl = await getNacl();
        return nacl.sign.detached(data, keypair.secretKey);
      };

      // ✅ Sign and send the transaction to Solana network
      signAndSendTransaction = async (unsignedTx: Uint8Array) => {
        const endpoint = CHAIN_INFO[chain].defaultRPC[0];
        const connection = new Connection(endpoint, 'confirmed');

        let txHash: string;

        // Detect if this is a versioned transaction by looking at the message portion.
        // Transaction format: [signature_count (compact-u16)][signatures][message]
        // For versioned messages, the first byte of the message has high bit set (>= 0x80)
        // Read signature count - if < 0x80, it's a single byte count
        let sigOffset = 1;
        const sigCount = unsignedTx[0];
        if (sigCount >= 0x80) {
          // Two-byte compact-u16 encoding
          sigOffset = 2;
        }
        // Skip past signatures (64 bytes each) to get to the message
        const messageOffset = sigOffset + sigCount * 64;
        const isVersionedTx = unsignedTx[messageOffset] >= 0x80;

        if (isVersionedTx) {
          // Handle as versioned transaction (v0)
          const vtx = VersionedTransaction.deserialize(unsignedTx);
          vtx.sign([keypair]);
          const rawVtx = vtx.serialize();
          txHash = await connection.sendRawTransaction(rawVtx);
        } else {
          // Handle as legacy transaction
          const tx = Transaction.from(unsignedTx);
          const messageBytes = tx.serializeMessage();
          const nacl = await getNacl();
          const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
          tx.addSignature(
            new PublicKey(keypair.publicKey.toBase58()),
            Buffer.from(signature)
          );
          const rawTx = tx.serialize();
          txHash = await connection.sendRawTransaction(rawTx);
        }

        return bs58.decode(txHash);
      };

      signTypedData = async () => {
        throw new Error('Typed data signing is not supported for Solana');
      };

      break;
    }

    default: {
      throw new Error(`Unsupported library: ${library}`);
    }
  }

  const universalSigner: UniversalSigner = {
    account: {
      address,
      chain,
    },
    signMessage,
    signAndSendTransaction,
    signTypedData,
    signAuthorization,
  };
  return createUniversalSigner(universalSigner);
}

// `signTypedData` is only mandatory for EVM Signers. For Solana, this is not necessary.
export function construct(
  account: UniversalAccount,
  options: {
    signMessage: (data: Uint8Array) => Promise<Uint8Array>;
    signAndSendTransaction: (unsignedTx: Uint8Array) => Promise<Uint8Array>;
    signTypedData?: ({
      domain,
      types,
      primaryType,
      message,
    }: {
      domain: TypedDataDomain;
      types: TypedData;
      primaryType: string;
      message: Record<string, any>;
    }) => Promise<Uint8Array>;
  }
): UniversalSignerSkeleton {
  const { signMessage, signAndSendTransaction, signTypedData } = options;
  if (
    signTypedData &&
    (account.chain === CHAIN.SOLANA_MAINNET ||
      account.chain === CHAIN.SOLANA_TESTNET ||
      account.chain === CHAIN.SOLANA_DEVNET)
  ) {
    throw new Error('Typed data signing is not supported for Solana');
  }

  return {
    signerId: 'CustomGeneratedSigner',
    account,
    signMessage,
    signAndSendTransaction,
    signTypedData,
  };
}

export async function toUniversal(
  signer:
    | UniversalSignerSkeleton
    | EthersV6SignerType
    | EthersV5SignerType
    | ViemSignerType
): Promise<UniversalSigner> {
  if ('signerId' in signer) {
    return createUniversalSigner(signer as UniversalSignerSkeleton);
  }

  let skeleton: UniversalSignerSkeleton;
  if (!isViemSigner(signer)) {
    const wallet = signer as EthersV5SignerType | EthersV6SignerType;
    if (!wallet.provider) {
      throw new Error(
        'ethers.Wallet must have a provider attached to determine chain'
      );
    }

    // Check if _signTypedData property is present to determine if it's EthersV5 or EthersV6
    if ('_signTypedData' in wallet) {
      skeleton = await generateSkeletonFromEthersV5(
        wallet as EthersV5SignerType
      );
    } else {
      skeleton = await generateSkeletonFromEthersV6(
        wallet as EthersV6SignerType
      );
    }
  } else {
    skeleton = await generateSkeletonFromViem(signer as ViemSignerType);
  }

  return createUniversalSigner(skeleton);
}

async function generateSkeletonFromEthersV5(
  signer: EthersV5SignerType
): Promise<UniversalSignerSkeleton> {
  const address = await signer.getAddress();

  const { chainId } = await signer.provider.getNetwork();
  const chain = chainIdToChain(chainId);

  return {
    signerId: `EthersSignerV5-${address}`,
    account: { address, chain },

    signMessage: async (data) => {
      const sigHex = await signer.signMessage(data);
      return hexToBytes(sigHex as Hex);
    },

    // raw unsigned tx bytes → hex → parse → signTransaction → bytes
    signAndSendTransaction: async (raw) => {
      const unsignedHex = bytesToHex(raw);
      const tx = toEthersTxRequest(parseTransaction(unsignedHex));
      const txResponse = await signer.sendTransaction(tx);
      return hexToBytes(txResponse.hash as Hex);
    },

    signTypedData: async ({ domain, types, primaryType, message }) => {
      const sigHex = await signer._signTypedData(
        domain,
        types as unknown as Record<string, any[]>,
        message
      );
      return hexToBytes(sigHex as Hex);
    },
  };
}

async function generateSkeletonFromEthersV6(
  signer: EthersV6SignerType
): Promise<UniversalSignerSkeleton> {
  const address = await signer.getAddress();

  const { chainId } = await signer.provider.getNetwork();
  const chain = chainIdToChain(chainId);

  return {
    signerId: `EthersSignerV6-${address}`,
    account: { address, chain },

    signMessage: async (data) => {
      const sigHex = await signer.signMessage(data);
      return hexToBytes(sigHex as Hex);
    },

    // raw unsigned tx bytes → hex → parse → signTransaction → bytes
    signAndSendTransaction: async (raw) => {
      const unsignedHex = bytesToHex(raw);
      const tx = toEthersTxRequest(parseTransaction(unsignedHex));
      const txResponse = await signer.sendTransaction(tx);
      return hexToBytes(txResponse.hash as Hex);
    },

    signTypedData: async ({ domain, types, primaryType, message }) => {
      const sigHex = await signer.signTypedData(
        domain,
        types as unknown as Record<string, any[]>,
        message
      );
      return hexToBytes(sigHex as Hex);
    },

    signAuthorization: ethersSignAuthorization(signer, chain),
  };
}

function isViemSigner(
  signer: ViemSignerType | EthersV5SignerType | EthersV6SignerType
) {
  return (
    typeof (signer as any).signTypedData === 'function' &&
    typeof (signer as any).getChainId === 'function'
  );
}

async function generateSkeletonFromViem(
  signer: ViemSignerType
): Promise<UniversalSignerSkeleton> {
  if (!signer.account) {
    throw new Error('Signer account is not set');
  }
  const address = signer.account['address'];
  const chainId = await signer.getChainId();
  const chain = chainIdToChain(chainId);

  return {
    signerId: `ViemSigner-${address}`,
    account: {
      address,
      chain,
    },
    signMessage: async (data: Uint8Array) => {
      const hexSig = await signer.signMessage({
        account: address as `0x${string}`,
        message: { raw: data },
      });
      return hexToBytes(hexSig);
    },
    signAndSendTransaction: async (unsignedTx: Uint8Array) => {
      // For viem signers, we need to handle transaction signing differently
      // Since the ViemSignerType doesn't have signTransaction, we'll need to
      // use the account's signTransaction method if available
      if (signer.account['signTransaction']) {
        const tx = parseTransaction(bytesToHex(unsignedTx));
        const txHash = await signer.sendTransaction(tx);
        return hexToBytes(txHash as Hex);
      }
      throw new Error(
        'Transaction signing not supported for this viem signer type'
      );
    },
    signTypedData: async ({ domain, types, primaryType, message }) => {
      const hexSig = await signer.signTypedData({
        domain,
        types,
        primaryType,
        message,
        account: (signer as WalletClient).account || (address as `0x${string}`),
      });
      return hexToBytes(hexSig);
    },

    // Gated on a local account inside the helper (JSON-RPC accounts → undefined).
    signAuthorization: viemSignAuthorization(signer, address),
  };
}
