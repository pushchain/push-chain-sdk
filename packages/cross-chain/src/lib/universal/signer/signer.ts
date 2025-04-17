import { bytesToHex, hexToBytes, parseTransaction, WalletClient } from 'viem';
import { createUniversalAccount } from '../account/account';
import { UniversalSigner } from '../universal.types';
import { CHAIN } from '../../constants/enums';

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
}: UniversalSigner): UniversalSigner {
  return {
    ...createUniversalAccount({ chain, address }),
    signMessage,
    signTransaction,
  };
}

/**
 * Wraps a viem WalletClient into a UniversalSigner.
 */
export async function toUniversal(
  client: WalletClient,
  chain: CHAIN
): Promise<UniversalSigner> {
  const address = (await client.getAddresses())[0];

  const universalSigner: UniversalSigner = {
    address: address,
    chain,
    signMessage: async (data: Uint8Array) => {
      const hexSig = await client.signMessage({
        account: client.account || address,
        message: { raw: data },
      });
      return hexToBytes(hexSig);
    },
    signTransaction: async (unsignedTx: Uint8Array) => {
      const tx = parseTransaction(bytesToHex(unsignedTx));
      const txHash = await client.signTransaction(tx as never);
      return hexToBytes(txHash);
    },
  };
  return createUniversalSigner(universalSigner);
}
