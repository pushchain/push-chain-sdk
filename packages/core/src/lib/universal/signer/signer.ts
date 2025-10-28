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
  UniversalAccount,
  UniversalSigner,
  UniversalSignerSkeleton,
  ViemSignerType,
} from '../universal.types';
import * as nacl from 'tweetnacl';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { CHAIN, LIBRARY } from '../../constants/enums';
import { ethers, getBytes, hexlify } from 'ethers';
import { CHAIN_INFO } from '../../constants/chain';
import { utils } from '@coral-xyz/anchor';

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
}: UniversalSigner): UniversalSigner {
  return {
    account,
    signMessage,
    signAndSendTransaction,
    signTypedData,
  };
}

/**
 * Creates a UniversalSigner from either a viem, ethers, solana WalletClient or Account instance.
 *
 * @param {WalletClient | Account | Keypair | ethers.HDNodeWallet} clientOrAccount - The viem WalletClient or Account instance
 * @param {CHAIN} chain - The chain the signer will operate on
 * @returns {Promise<UniversalSigner>} A signer object configured for the specified chain
 */
export async function toUniversalFromKeypair(
  clientOrAccount: WalletClient | Keypair | ethers.Wallet | ethers.HDNodeWallet,
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
      const wallet = clientOrAccount as ethers.Wallet | ethers.HDNodeWallet;
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

      // raw bytes → ethers.signMessage → hex → back to bytes
      signMessage = async (data) => {
        const sigHex = await wallet.signMessage(data);
        return getBytes(sigHex);
      };

      // raw unsigned tx bytes → hex → parse → signAndSendTransaction → bytes
      signAndSendTransaction = async (raw) => {
        const unsignedHex = hexlify(raw);
        const tx = ethers.Transaction.from(unsignedHex);
        const txResponse = await wallet.sendTransaction(tx);
        return hexToBytes(txResponse.hash as Hex);
      };

      // EIP-712 typed data → _signTypedData → hex → bytes
      signTypedData = async ({ domain, types, primaryType, message }) => {
        const sigHex = await wallet.signTypedData(
          domain,
          types as unknown as Record<string, any[]>,
          message
        );
        return getBytes(sigHex);
      };

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
        return nacl.sign.detached(data, keypair.secretKey);
      };

      // ✅ Sign and send the transaction to Solana network
      signAndSendTransaction = async (unsignedTx: Uint8Array) => {
        // sign
        const tx = Transaction.from(unsignedTx);
        const messageBytes = tx.serializeMessage();
        const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
        tx.addSignature(
          new PublicKey(keypair.publicKey.toBase58()),
          Buffer.from(signature)
        );
        const rawTx = tx.serialize();
        const endpoint = CHAIN_INFO[chain].defaultRPC[0];
        const connection = new Connection(endpoint, 'confirmed');
        const txHash = await connection.sendRawTransaction(rawTx);
        return utils.bytes.bs58.decode(txHash);
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

  // Map chainId to CHAIN enum - this is a simplified mapping
  let chain: CHAIN;
  switch (chainId.toString()) {
    case '11155111':
      chain = CHAIN.ETHEREUM_SEPOLIA;
      break;
    case '421614':
      chain = CHAIN.ARBITRUM_SEPOLIA;
      break;
    case '84532':
      chain = CHAIN.BASE_SEPOLIA;
      break;
    case '97':
      chain = CHAIN.BNB_TESTNET;
      break;
    case '1':
      chain = CHAIN.ETHEREUM_MAINNET;
      break;
    case '9':
      chain = CHAIN.PUSH_MAINNET;
      break;
    case '42101':
      chain = CHAIN.PUSH_TESTNET;
      break;
    case '9000':
      chain = CHAIN.PUSH_LOCALNET;
      break;
    default:
      throw new Error(`Unsupported chainId: ${chainId}`);
  }

  if (!Object.values(CHAIN).includes(chain)) {
    throw new Error(`Unsupported chainId: ${chainId}`);
  }

  return {
    signerId: `EthersSignerV5-${address}`,
    account: { address, chain },

    signMessage: async (data) => {
      const sigHex = await signer.signMessage(data);
      return getBytes(sigHex);
    },

    // raw unsigned tx bytes → hex → parse → signTransaction → bytes
    signAndSendTransaction: async (raw) => {
      const unsignedHex = hexlify(raw);
      const tx = ethers.Transaction.from(unsignedHex);
      const txResponse = await signer.sendTransaction(tx);
      return hexToBytes(txResponse.hash as Hex);
    },

    signTypedData: async ({ domain, types, primaryType, message }) => {
      const sigHex = await signer._signTypedData(
        domain,
        types as unknown as Record<string, any[]>,
        message
      );
      return getBytes(sigHex);
    },
  };
}

async function generateSkeletonFromEthersV6(
  signer: EthersV6SignerType
): Promise<UniversalSignerSkeleton> {
  const address = await signer.getAddress();

  const { chainId } = await signer.provider.getNetwork();

  // Map chainId to CHAIN enum - this is a simplified mapping
  let chain: CHAIN;
  switch (chainId.toString()) {
    case '11155111':
      chain = CHAIN.ETHEREUM_SEPOLIA;
      break;
    case '421614':
      chain = CHAIN.ARBITRUM_SEPOLIA;
      break;
    case '84532':
      chain = CHAIN.BASE_SEPOLIA;
      break;
    case '97':
      chain = CHAIN.BNB_TESTNET;
      break;
    case '1':
      chain = CHAIN.ETHEREUM_MAINNET;
      break;
    case '9':
      chain = CHAIN.PUSH_MAINNET;
      break;
    case '42101':
      chain = CHAIN.PUSH_TESTNET;
      break;
    case '9000':
      chain = CHAIN.PUSH_LOCALNET;
      break;
    default:
      throw new Error(`Unsupported chainId: ${chainId}`);
  }

  if (!Object.values(CHAIN).includes(chain)) {
    throw new Error(`Unsupported chainId: ${chainId}`);
  }

  return {
    signerId: `EthersSignerV6-${address}`,
    account: { address, chain },

    signMessage: async (data) => {
      const sigHex = await signer.signMessage(data);
      return getBytes(sigHex);
    },

    // raw unsigned tx bytes → hex → parse → signTransaction → bytes
    signAndSendTransaction: async (raw) => {
      const unsignedHex = hexlify(raw);
      const tx = ethers.Transaction.from(unsignedHex);
      const txResponse = await signer.sendTransaction(tx);
      return hexToBytes(txResponse.hash as Hex);
    },

    signTypedData: async ({ domain, types, primaryType, message }) => {
      const sigHex = await signer.signTypedData(
        domain,
        types as unknown as Record<string, any[]>,
        message
      );
      return getBytes(sigHex);
    },
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

  // Map chainId to CHAIN enum
  let chain: CHAIN;
  switch (chainId.toString()) {
    case '11155111':
      chain = CHAIN.ETHEREUM_SEPOLIA;
      break;
    case '421614':
      chain = CHAIN.ARBITRUM_SEPOLIA;
      break;
    case '84532':
      chain = CHAIN.BASE_SEPOLIA;
      break;
    case '97':
      chain = CHAIN.BNB_TESTNET;
      break;
    case '1':
      chain = CHAIN.ETHEREUM_MAINNET;
      break;
    case '9':
      chain = CHAIN.PUSH_MAINNET;
      break;
    case '42101':
      chain = CHAIN.PUSH_TESTNET;
      break;
    case '9000':
      chain = CHAIN.PUSH_LOCALNET;
      break;
    default:
      throw new Error(`Unsupported chainId: ${chainId}`);
  }

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
  };
}
