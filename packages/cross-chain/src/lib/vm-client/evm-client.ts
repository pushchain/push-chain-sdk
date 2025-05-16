import { UniversalSigner } from '../universal/universal.types';
import {
  ClientOptions,
  ReadContractParams,
  WriteContractParams,
} from './vm-client.types';
import {
  bytesToHex,
  createPublicClient,
  encodeFunctionData,
  hexToBytes,
  http,
  parseEther,
  PublicClient,
  serializeTransaction,
  Hex,
  Abi,
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
   */
  async getBalance(address: `0x${string}`): Promise<bigint> {
    return this.publicClient.getBalance({ address });
  }

  /**
   * Performs a read-only call to a smart contract.
   */
  async readContract<T = unknown>({
    abi,
    address,
    functionName,
    args = [],
  }: ReadContractParams): Promise<T> {
    return this.publicClient.readContract({
      abi: abi as Abi,
      address: address as `0x${string}`,
      functionName,
      args,
    }) as Promise<T>;
  }

  /**
   * Writes a transaction to a smart contract using a UniversalSigner.
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
      abi: abi as Abi,
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
    signer: UniversalSigner;
  }): Promise<Hex> {
    const [nonce, gas, feePerGas] = await Promise.all([
      this.publicClient.getTransactionCount({
        address: signer.address as `0x${string}`,
      }),
      this.publicClient.estimateGas({
        account: signer.address as `0x${string}`,
        to,
        data,
        value,
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

    if (!signer.signTransaction) {
      throw new Error('signer.signTransaction is undefined');
    }

    const signedTx = await signer.signTransaction(hexToBytes(unsignedTx));

    return this.publicClient.sendRawTransaction({
      serializedTransaction: bytesToHex(signedTx),
    });
  }

  /**
   * Estimates the gas required for a transaction.
   */
  async estimateGas({
    from,
    to,
    value,
    data,
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
  }: {
    from: `0x${string}`;
    to: `0x${string}`;
    value?: bigint;
    data?: `0x${string}`;
    gas?: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  }): Promise<bigint> {
    return this.publicClient.estimateGas({
      account: from,
      to,
      value,
      data,
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
  }

  /**
   * Gets the current gas price (for legacy transactions).
   */
  async getGasPrice(): Promise<bigint> {
    return this.publicClient.getGasPrice();
  }
}
