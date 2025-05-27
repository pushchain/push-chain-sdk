import {
  bytesToHex,
  hexToBytes,
  parseTransaction,
  WalletClient,
  Account,
  TypedDataDomain,
  TypedData,
} from 'viem';
import { createUniversalAccount } from '../account/account';
import { UniversalSigner } from '../universal.types';
import { CHAIN } from '../../constants/enums';
import * as nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';

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
  chain,
  address,
  signMessage,
  signTransaction,
  signTypedData,
}: UniversalSigner): UniversalSigner {
  return {
    ...createUniversalAccount({ chain, address }),
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
export async function toUniversalFromViem(
  clientOrAccount: WalletClient | Account,
  chain: CHAIN
): Promise<UniversalSigner> {
  let address: `0x${string}`;
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

  if ('getAddresses' in clientOrAccount) {
    // It's a WalletClient
    address = (await clientOrAccount.getAddresses())[0];
    signMessage = async (data: Uint8Array) => {
      const hexSig = await clientOrAccount.signMessage({
        account: clientOrAccount.account || address,
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
        account: clientOrAccount.account || address,
      });
      return hexToBytes(hexSig);
    };
  } else {
    // It's an Account
    if (
      !clientOrAccount.address ||
      !clientOrAccount.signMessage ||
      !clientOrAccount.signTransaction
    ) {
      throw new Error('Invalid Account instance: missing required properties');
    }
    address = clientOrAccount.address;
    signMessage = async (data: Uint8Array) => {
      const hexSig = await clientOrAccount.signMessage({
        message: { raw: data },
      });
      return hexToBytes(hexSig);
    };
    signTransaction = async (unsignedTx: Uint8Array) => {
      const tx = parseTransaction(bytesToHex(unsignedTx));
      const hexSig = await clientOrAccount.signTransaction(tx);
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
      const hexSig = await clientOrAccount.signTypedData({
        domain,
        types,
        primaryType,
        message,
      });
      return hexToBytes(hexSig);
    };
  }

  const universalSigner: UniversalSigner = {
    address,
    chain,
    signMessage,
    signTransaction,
    signTypedData,
  };
  return createUniversalSigner(universalSigner);
}

/**
 * Creates a UniversalSigner from a Solana Keypair.
 *
 * @param {Keypair} keypair - The Solana Keypair to create the signer from
 * @param {CHAIN} chain - The chain the signer will operate on (should be a Solana chain)
 * @returns {UniversalSigner} A signer object configured for Solana operations
 */
export function toUniversalFromSolanaKeypair(
  keypair: Keypair,
  chain: CHAIN
): UniversalSigner {
  if (
    chain !== CHAIN.SOLANA_MAINNET &&
    chain !== CHAIN.SOLANA_TESTNET &&
    chain !== CHAIN.SOLANA_DEVNET
  ) {
    throw new Error('Invalid chain for Solana Keypair');
  }
  const universalSigner: UniversalSigner = {
    address: keypair.publicKey.toBase58(),
    chain,
    signMessage: async (data: Uint8Array) => {
      return nacl.sign.detached(data, keypair.secretKey);
    },
    signTransaction: async (unsignedTx: Uint8Array) => {
      return nacl.sign.detached(unsignedTx, keypair.secretKey);
    },
  };
  return createUniversalSigner(universalSigner);
}
