import { UniversalSigner } from '../universal/universal.types';
import {
  ClientOptions,
  ReadContractParams,
  TxResponse,
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
  fallback,
  TransactionReceipt,
} from 'viem';

/**
 * EVM client for reading and writing to Ethereum-compatible chains
 *
 * @example
 * // Initialize with an RPC URL
 * const evmClient = new EvmClient({
 *   rpcUrl: 'https://eth-sepolia.g.alchemy.com/v2/your-api-key'
 * });
 */
export class EvmClient {
  public publicClient: PublicClient;

  constructor({ rpcUrls }: ClientOptions) {
    const transports = rpcUrls.map((rpcUrl) => http(rpcUrl));
    this.publicClient = createPublicClient({
      transport: fallback(transports),
    });
  }

  /**
   * Returns the balance (in wei) of an EVM address.
   *
   * @param address - The EVM address to check balance for
   * @returns Balance as a bigint in wei
   *
   * @example
   * // Get balance of an address
   * const balance = await evmClient.getBalance('0x123...');
   * console.log(`Balance: ${balance} wei`);
   *
   * @example
   * // Check if an address has zero balance
   * const newAddress = privateKeyToAccount(generatePrivateKey()).address;
   * const balance = await evmClient.getBalance(newAddress);
   * if (balance === BigInt(0)) {
   *   console.log('Address has no funds');
   * }
   */
  async getBalance(address: `0x${string}`): Promise<bigint> {
    return this.publicClient.getBalance({ address });
  }

  /**
   * Performs a read-only call to a smart contract.
   *
   * @param params - Parameters including ABI, contract address, function name, and args
   * @returns The result of the contract call with the specified type
   *
   * @example
   * // Read a greeting value from a contract
   * const greeting = await evmClient.readContract<string>({
   *   abi: parseAbi(['function greet() view returns (string)']),
   *   address: '0x2ba5873eF818BEE57645B7d674149041C44F42c6',
   *   functionName: 'greet',
   * });
   * console.log(`Current greeting: ${greeting}`);
   *
   * @example
   * // Reading with arguments
   * const balance = await evmClient.readContract<bigint>({
   *   abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
   *   address: '0xTokenAddress',
   *   functionName: 'balanceOf',
   *   args: ['0xUserAddress'],
   * });
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
   * Returns the ERC-20 token balance of an owner address.
   *
   * This is a convenience wrapper around readContract using the minimal
   * ERC-20 ABI: balanceOf(address) -> uint256.
   */
  async getErc20Balance({
    tokenAddress,
    ownerAddress,
  }: {
    tokenAddress: `0x${string}`;
    ownerAddress: `0x${string}`;
  }): Promise<bigint> {
    const { parseAbi } = await import('viem');
    const erc20Abi = parseAbi([
      'function balanceOf(address) view returns (uint256)',
    ]);
    return this.readContract<bigint>({
      abi: erc20Abi as unknown as Abi,
      address: tokenAddress,
      functionName: 'balanceOf',
      args: [ownerAddress],
    });
  }

  /**
   * Writes a transaction to a smart contract using a UniversalSigner.
   * This function handles contract interaction by encoding function data
   * and sending the transaction through sendTransaction.
   *
   * @param params - Parameters including ABI, contract address, function name, args, value and signer
   * @returns Transaction hash as a hex string
   *
   * @example
   * // Set a new greeting on a contract
   * const txHash = await evmClient.writeContract({
   *   abi: parseAbi(['function setGreeting(string _greeting)']),
   *   address: '0x2ba5873eF818BEE57645B7d674149041C44F42c6',
   *   functionName: 'setGreeting',
   *   args: ['Hello from Push SDK!'],
   *   signer: universalSigner,
   * });
   * console.log(`Transaction sent: ${txHash}`);
   *
   * @example
   * // Sending ether with a contract interaction
   * const txHash = await evmClient.writeContract({
   *   abi: parseAbi(['function deposit() payable']),
   *   address: '0xContractAddress',
   *   functionName: 'deposit',
   *   value: parseEther('0.1'), // Send 0.1 ETH
   *   signer: universalSigner,
   * });
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
   * This handles the full transaction flow:
   * 1. Gets nonce, estimates gas, and gets current fee data
   * 2. Serializes and signs the transaction
   * 3. Broadcasts the signed transaction to the network
   *
   * @param params - Transaction parameters including destination, data, value and signer
   * @returns Transaction hash as a hex string
   *
   * @example
   * // Send a simple ETH transfer
   * const txHash = await evmClient.sendTransaction({
   *   to: '0xRecipientAddress',
   *   data: '0x', // empty data for a simple transfer
   *   value: parseEther('0.01'),
   *   signer: universalSigner,
   * });
   * console.log(`ETH transfer sent: ${txHash}`);
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
        address: signer.account.address as `0x${string}`,
      }),
      // Use fixed gas for simple transfers, estimate for contract interactions
      data === '0x'
        ? Promise.resolve(BigInt(21000))
        : this.publicClient.estimateGas({
            account: signer.account.address as `0x${string}`,
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

    if (!signer.signAndSendTransaction) {
      throw new Error('signer.signAndSendTransaction is undefined');
    }

    const txHashBytes = await signer.signAndSendTransaction(
      hexToBytes(unsignedTx)
    );

    return bytesToHex(txHashBytes);
  }

  /**
   * Estimates the gas required for a transaction.
   *
   * @param params - Parameters including from/to addresses, value and optional data
   * @returns Estimated gas as a bigint
   *
   * @example
   * // Estimate gas for a simple transfer
   * const gasEstimate = await evmClient.estimateGas({
   *   from: '0xSenderAddress',
   *   to: '0xRecipientAddress',
   *   value: parseEther('0.01'),
   * });
   * console.log(`Estimated gas: ${gasEstimate}`);
   *
   * @example
   * // Estimate gas for a contract interaction
   * const data = encodeFunctionData({
   *   abi: parseAbi(['function setGreeting(string)']),
   *   functionName: 'setGreeting',
   *   args: ['New greeting'],
   * });
   *
   * const gasEstimate = await evmClient.estimateGas({
   *   from: universalSigner.account.address as `0x${string}`,
   *   to: '0xContractAddress',
   *   data,
   *   value: BigInt(0),
   * });
   */
  async estimateGas({
    from,
    to,
    value,
    data,
  }: {
    from?: `0x${string}`;
    to: `0x${string}`;
    value?: bigint;
    data?: `0x${string}`;
  }): Promise<bigint> {
    return this.publicClient.estimateGas({
      account: from || undefined,
      to,
      value,
      data,
    });
  }

  /**
   * Gets the current gas price on the network.
   * This is primarily used for legacy transactions, but can be useful
   * for gas cost estimation in EIP-1559 transactions as well.
   *
   * @returns Current gas price in wei as a bigint
   *
   * @example
   * // Get current gas price for cost estimation
   * const gasPrice = await evmClient.getGasPrice();
   * console.log(`Current gas price: ${gasPrice} wei`);
   *
   * @example
   * // Calculate total cost of a transaction
   * const gasPrice = await evmClient.getGasPrice();
   * const gasEstimate = await evmClient.estimateGas({...});
   * const totalCost = gasPrice * gasEstimate;
   * console.log(`Estimated transaction cost: ${totalCost} wei`);
   */
  async getGasPrice(): Promise<bigint> {
    return this.publicClient.getGasPrice();
  }

  /**
   * Fetches the full transaction response by hash.
   *
   * @param txHash - The transaction hash to query
   * @returns The transaction object or null if not found
   *
   * @example
   * const tx = await evmClient.getTransaction('0xabc...');
   * console.log(tx?.from, tx?.to, tx?.value);
   */
  async getTransaction(txHash: `0x${string}`): Promise<TxResponse> {
    const tx = await this.publicClient.getTransaction({ hash: txHash });
    if (!tx) throw new Error('No transaction found!');

    const wait = async (confirmations = 1): Promise<TransactionReceipt> => {
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations,
      });
      return receipt;
    };

    return {
      ...tx,
      wait,
    };
  }

  /**
   * Waits for a transaction to achieve the desired number of confirmations.
   *
   * @param txHash         - Transaction hash
   * @param confirmations  - Number of confirmations to wait for (default: 3)
   * @param pollIntervalMs - How often to check (default: 1000 ms)
   * @param timeoutMs      - Maximum time to wait before error (default: 60000 ms)
   */
  async waitForConfirmations({
    txHash,
    confirmations = 3,
    pollIntervalMs = 1000,
    timeoutMs = 30000,
  }: {
    txHash: `0x${string}`;
    confirmations?: number;
    pollIntervalMs?: number;
    timeoutMs?: number;
  }): Promise<void> {
    // first, wait for the tx to land in a block
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    const targetBlock = receipt.blockNumber + BigInt(confirmations);
    const startTime = Date.now();

    // poll until we hit the target block or timeout
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const currentBlock = await this.publicClient.getBlockNumber();
      if (currentBlock >= targetBlock) {
        return;
      }

      if (Date.now() - startTime > timeoutMs) {
        throw new Error(
          `Timeout: transaction ${txHash} not confirmed with ${confirmations} confirmations ` +
            `within ${timeoutMs} ms`
        );
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }
}
