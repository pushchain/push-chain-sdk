import {
  bytesToHex,
  hexToBytes,
  parseTransaction,
  WalletClient,
  Account,
} from 'viem';
import { TypedDataDomain, TypedData } from '../../constants';
import {
  EthersV5SignerType,
  EthersV6SignerType,
  TypedDataField,
  UniversalAccount,
  UniversalSigner,
  UniversalSignerSkeleton,
  ViemSignerType,
} from '../universal.types';
import * as nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import { CHAIN, LIBRARY } from '../../constants/enums';
import { ethers, getBytes, hexlify, Wallet } from 'ethers';

/**
 * Creates a `UniversalSigner` object for signing messages and transactions
 * on any supported chain.
 *
 * @param {Object} params - The signer configuration object.
 * @param {string} params.address - The signer's address.
 * @param {(data: Uint8Array) => Promise<Uint8Array>} params.signMessage - Required function to sign messages.
 * @param {(data: Uint8Array) => Promise<Uint8Array>} [params.signTransaction] - Required function to sign transactions.
 * @param {CHAIN} params.chain - The chain the signer will operate on.
 * @returns {UniversalSigner} A signer object with chain metadata.
 *
 * @example
 * const signer = createUniversalSigner({
 *   chain: CHAIN.ETHEREUM_SEPOLIA
 *   address: "0xabc...",
 *   signMessage: async (data) => sign(data),
 *   signTransaction: async (data) => signRawTx(data),
 * });
 */
export function createUniversalSigner({
  account,
  signMessage,
  signTransaction,
  signTypedData,
}: UniversalSigner): UniversalSigner {
  return {
    account,
    signMessage,
    signTransaction,
    signTypedData,
  };
}

/**
 * Creates a UniversalSigner from either a viem WalletClient or Account instance.
 *
 * @param {WalletClient | Account} clientOrAccount - The viem WalletClient or Account instance
 * @param {CHAIN} chain - The chain the signer will operate on
 * @returns {Promise<UniversalSigner>} A signer object configured for the specified chain
 */
export async function toUniversalFromKeyPair(
  clientOrAccount: WalletClient | Account | Keypair | Wallet,
  { chain, library }: { chain: CHAIN; library: LIBRARY }
): Promise<UniversalSigner> {
  let address: string;
  let signMessage: (data: Uint8Array) => Promise<Uint8Array>;
  let signTransaction: (unsignedTx: Uint8Array) => Promise<Uint8Array>;
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

  // Check if signer has UID='custom', then we take signMessage, signTransaction, signTypedData, chain and address from the CustomUniversalSigner.
  // If ViemSigner, convert ViemSigner to UniversalSigner.

  switch (library) {
    case LIBRARY.ETHEREUM_ETHERSV6: {
      if (!(clientOrAccount instanceof ethers.Wallet)) {
        throw new Error('Expected ethers.Wallet for ETHEREUM_ETHERSV6 library');
      }
      const wallet = clientOrAccount as ethers.Wallet;
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

      // raw unsigned tx bytes → hex → parse → signTransaction → bytes
      signTransaction = async (raw) => {
        const unsignedHex = hexlify(raw);
        const tx = ethers.Transaction.from(unsignedHex);
        const txReq: ethers.TransactionRequest = {
          to: tx.to,
          value: tx.value,
          data: tx.data,
          gasLimit: tx.gasLimit,
          gasPrice: tx.gasPrice,
          maxFeePerGas: tx.maxFeePerGas,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
          nonce: tx.nonce,
          type: tx.type,
          chainId: tx.chainId,
        };
        const signedHex = await wallet.signTransaction(txReq);
        return getBytes(signedHex);
      };

      // EIP-712 typed data → _signTypedData → hex → bytes
      signTypedData = async ({ domain, types, primaryType, message }) => {
        const sigHex = await wallet.signTypedData(
          domain,
          types as unknown as Record<string, TypedDataField[]>,
          message
        );
        return getBytes(sigHex);
      };

      break;
    }

    case LIBRARY.ETHEREUM_VIEM: {
      if ('getAddresses' in clientOrAccount) {
        // It's a WalletClient
        address = (await clientOrAccount.getAddresses())[0];
        signMessage = async (data: Uint8Array) => {
          const hexSig = await clientOrAccount.signMessage({
            account: clientOrAccount.account || (address as `0x${string}`),
            message: { raw: data },
          });
          return hexToBytes(hexSig);
        };
        signTransaction = async (unsignedTx: Uint8Array) => {
          const tx = parseTransaction(bytesToHex(unsignedTx));
          const txHash = await clientOrAccount.signTransaction(tx as never);
          return hexToBytes(txHash);
        };
        signTypedData = async ({
          domain,
          types,
          primaryType,
          message,
        }: {
          domain: TypedDataDomain;
          types: TypedData;
          primaryType: string;
          message: Record<string, any>;
        }) => {
          const hexSig = await clientOrAccount.signTypedData({
            domain,
            types,
            primaryType,
            message,
            account: clientOrAccount.account || (address as `0x${string}`),
          });
          return hexToBytes(hexSig);
        };
      } else {
        // It's an Account
        const account = clientOrAccount as Account;
        if (
          !account.address ||
          !account.signMessage ||
          !account.signTransaction
        ) {
          throw new Error(
            'Invalid Account instance: missing required properties'
          );
        }
        address = account.address;
        signMessage = async (data: Uint8Array) => {
          const hexSig = await account.signMessage({
            message: { raw: data },
          });
          return hexToBytes(hexSig);
        };
        signTransaction = async (unsignedTx: Uint8Array) => {
          const tx = parseTransaction(bytesToHex(unsignedTx));
          const hexSig = await account.signTransaction(tx);
          return hexToBytes(hexSig);
        };
        signTypedData = async ({
          domain,
          types,
          primaryType,
          message,
        }: {
          domain: TypedDataDomain;
          types: TypedData;
          primaryType: string;
          message: Record<string, any>;
        }) => {
          const hexSig = await account.signTypedData({
            domain,
            types,
            primaryType,
            message,
          });
          return hexToBytes(hexSig);
        };
      }
      break;
    }

    case LIBRARY.SOLANA_WEB3JS: {
      // It's a Solana Keypair
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
      signTransaction = async (unsignedTx: Uint8Array) => {
        return nacl.sign.detached(unsignedTx, keypair.secretKey);
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
    signTransaction,
    signTypedData,
  };
  return createUniversalSigner(universalSigner);
}

// `signTypedData` is only mandatory for EVM Signers. For Solana, this is not necessary.
export function construct(
  account: UniversalAccount,
  options: {
    signMessage: (data: Uint8Array) => Promise<Uint8Array>;
    signTransaction: (unsignedTx: Uint8Array) => Promise<Uint8Array>;
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
  const { signMessage, signTransaction, signTypedData } = options;
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
    signTransaction,
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
    case '1':
      chain = CHAIN.ETHEREUM_MAINNET;
      break;
    case '9':
      chain = CHAIN.PUSH_MAINNET;
      break;
    case '9000':
      chain = CHAIN.PUSH_TESTNET;
      break;
    case '9001':
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
    signTransaction: async (raw) => {
      const unsignedHex = hexlify(raw);
      const tx = ethers.Transaction.from(unsignedHex);
      const txReq: ethers.TransactionRequest = {
        to: tx.to,
        value: tx.value,
        data: tx.data,
        gasLimit: tx.gasLimit,
        gasPrice: tx.gasPrice,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        nonce: tx.nonce,
        type: tx.type,
        chainId: tx.chainId,
      };
      const signedHex = await signer.signTransaction(txReq);
      return getBytes(signedHex);
    },

    signTypedData: async ({ domain, types, primaryType, message }) => {
      const sigHex = await signer._signTypedData(
        domain,
        types as unknown as Record<string, TypedDataField[]>,
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
    case '1':
      chain = CHAIN.ETHEREUM_MAINNET;
      break;
    case '9':
      chain = CHAIN.PUSH_MAINNET;
      break;
    case '9000':
      chain = CHAIN.PUSH_TESTNET;
      break;
    case '9001':
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
    signTransaction: async (raw) => {
      const unsignedHex = hexlify(raw);
      const tx = ethers.Transaction.from(unsignedHex);
      const txReq: ethers.TransactionRequest = {
        to: tx.to,
        value: tx.value,
        data: tx.data,
        gasLimit: tx.gasLimit,
        gasPrice: tx.gasPrice,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        nonce: tx.nonce,
        type: tx.type,
        chainId: tx.chainId,
      };
      const signedHex = await signer.signTransaction(txReq);
      return getBytes(signedHex);
    },

    signTypedData: async ({ domain, types, primaryType, message }) => {
      const sigHex = await signer.signTypedData(
        domain,
        types as unknown as Record<string, TypedDataField[]>,
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
    case '1':
      chain = CHAIN.ETHEREUM_MAINNET;
      break;
    case '9':
      chain = CHAIN.PUSH_MAINNET;
      break;
    case '9000':
      chain = CHAIN.PUSH_TESTNET;
      break;
    case '9001':
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
    signTransaction: async (unsignedTx: Uint8Array) => {
      // For viem signers, we need to handle transaction signing differently
      // Since the ViemSignerType doesn't have signTransaction, we'll need to
      // use the account's signTransaction method if available
      if (signer.account['signTransaction']) {
        const tx = parseTransaction(bytesToHex(unsignedTx));
        const hexSig = await signer.account['signTransaction'](tx);
        return hexToBytes(hexSig);
      }
      throw new Error(
        'Transaction signing not supported for this viem signer type'
      );
    },
    signTypedData: async ({
      domain,
      types,
      primaryType,
      message,
    }: {
      domain: TypedDataDomain;
      types: TypedData;
      primaryType: string;
      message: Record<string, any>;
    }) => {
      const hexSig = await signer.signTypedData({
        domain,
        types,
        primaryType,
        message,
        account: address as `0x${string}`,
      });
      return hexToBytes(hexSig);
    },
  };
}
