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
import { CHAIN, LIBRARY } from '../../constants/enums';
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
export async function toUniversal(
  clientOrAccount: WalletClient | Account | Keypair,
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

  switch (library) {
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

    case LIBRARY.SOLANA_WEB3: {
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
    address,
    chain,
    signMessage,
    signTransaction,
    signTypedData,
  };
  return createUniversalSigner(universalSigner);
}
