import {
  ClientOptions,
  ReadContractParams,
  WriteContractParams,
} from './vm-client.types';
import {
  bytesToHex,
  createPublicClient,
  http,
  parseAbi,
  serializeTransaction,
  Hex,
  PublicClient,
  hexToBytes,
  encodeFunctionData,
  parseEther,
} from 'viem';

/**
 * EVM client for reading and writing evm chains
 */
export class EvmClient {
  private publicClient: PublicClient;

  constructor({ rpcUrl }: ClientOptions) {
    this.publicClient = createPublicClient({
      transport: http(rpcUrl),
    });
  }

  /**
   * Returns the balance (in wei) of an EVM address.
   * @param address - The address to check.
   * @returns Balance in wei as bigint.
   */
  async getBalance(address: `0x${string}`): Promise<bigint> {
    return this.publicClient.getBalance({ address });
  }

  /**
   * Performs a read-only call to a smart contract.
   * @param params - ReadContractParams
   * @returns The decoded return value of the contract call.
   */
  async readContract<T = unknown>({
    abi,
    address,
    functionName,
    args = [],
  }: ReadContractParams): Promise<T> {
    return this.publicClient.readContract({
      abi: parseAbi(abi),
      address: address as `0x${string}`,
      functionName,
      args,
    }) as Promise<T>;
  }

  /**
   * Writes a transaction to a smart contract using a UniversalSigner.
   * @param params - WriteContractParams
   * @returns The transaction hash of the submitted tx.
   */
  async writeContract({
    abi,
    address,
    functionName,
    args = [],
    value = parseEther('0'),
    signer,
  }: WriteContractParams): Promise<Hex> {
    const data = encodeFunctionData({
      abi: parseAbi(abi),
      functionName,
      args,
    });

    return this.sendTransaction({
      to: address as `0x${string}`,
      data,
      value,
      signer,
    });
  }

  /**
   * Sends a raw EVM transaction using a UniversalSigner.
   */
  async sendTransaction({
    to,
    data,
    value = parseEther('0'),
    signer,
  }: {
    to: `0x${string}`;
    data: Hex;
    value?: bigint;
    signer: {
      address: string;
      signTransaction: (tx: Uint8Array) => Promise<Uint8Array>;
    };
  }): Promise<Hex> {
    const [nonce, gas, feePerGas] = await Promise.all([
      this.publicClient.getTransactionCount({
        address: signer.address as `0x${string}`,
      }),
      this.publicClient.estimateGas({
        account: signer.address as `0x${string}`,
        to,
        data,
      }),
      this.publicClient.estimateFeesPerGas(),
    ]);

    const chainId = await this.publicClient.getChainId();

    const unsignedTx = serializeTransaction({
      chainId,
      type: 'eip1559',
      to,
      data,
      gas,
      nonce,
      maxFeePerGas: feePerGas.maxFeePerGas,
      maxPriorityFeePerGas: feePerGas.maxPriorityFeePerGas,
      value,
    });

    const signedTx = await signer.signTransaction(hexToBytes(unsignedTx));

    return this.publicClient.sendRawTransaction({
      serializedTransaction: bytesToHex(signedTx),
    });
  }
}
