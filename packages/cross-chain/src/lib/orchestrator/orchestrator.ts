import { Abi, zeroHash, toBytes, sha256 } from 'viem';
import { CHAIN, NETWORK, VM } from '../constants/enums';
import { UniversalSigner } from '../universal/universal.types';
import { ExecuteParams } from './orchestrator.types';
import { EvmClient } from '../vm-client/evm-client';
import { CHAIN_INFO } from '../constants/chain';
import { LOCKER_ABI } from '../constants/abi';
import { toChainAgnostic } from '../universal/account';
import { PushClient } from '../push-client/push-client';
import { SvmClient } from '../vm-client/svm-client';

export class Orchestrator {
  private pushClient: PushClient;
  constructor(
    private readonly universalSigner: UniversalSigner,
    private readonly pushNetwork: NETWORK,
    private readonly rpcUrl: Partial<Record<CHAIN, string>> = {},
    private readonly printTraces = false
  ) {
    const pushChain =
      this.pushNetwork === NETWORK.MAINNET
        ? CHAIN.PUSH_MAINNET
        : CHAIN.PUSH_TESTNET;
    const pushChainRPC =
      this.rpcUrl[pushChain] || CHAIN_INFO[pushChain].defaultRPC;
    this.pushClient = new PushClient({
      rpcUrl: pushChainRPC,
      network: pushNetwork,
    });
  }

  /**
   * Executes an interaction on Push Chain
   */
  async execute(execute: ExecuteParams): Promise<`0x${string}`> {
    const chain = this.universalSigner.chain;

    // TODO: add validation that if sepolia, or any origin testnet, you can only interact with Push testnet. Same for mainnet

    // 1. Block direct execution if signer is already on Push Chain
    if (this.isPushChain(chain)) {
      throw new Error('UniversalSigner is already on Push Chain');
    }

    // 2. Get Push chain NMSC address for this signer
    const { address: nmscAddress, deployed: isNMSCDeployed } =
      await this.pushClient.getNMSCAddress(
        toChainAgnostic(this.universalSigner)
      );

    // 3. Estimate funds required for the execution
    // TODO: Fix gas estimation - estimation is req on how much gas the sc will take for the execution. Also nonce should also be accounted for
    const gasEstimate = await this.pushClient.estimateGas({
      from: nmscAddress, // the NMSC smart wallet
      to: execute.target as `0x${string}`,
      data: execute.data,
      value: execute.value,
      gas: execute.gasLimit,
      maxFeePerGas: execute.maxFeePerGas,
      maxPriorityFeePerGas: execute.maxPriorityFeePerGas,
    });
    const requiredGasFee = (await this.pushClient.getGasPrice()) * gasEstimate;
    const requiredFunds = requiredGasFee + execute.value;

    // 4. Check NMSC balance on Push Chain ( in nPUSH )
    const funds = await this.pushClient.getBalance(nmscAddress);

    // 5. Create execution hash ( execution data to be signed )
    const executionHash = this.sha256HashOfJson(execute);

    // 6 If not enough funds, lock required fee on source chain and send tx to Push chain
    let feeLockTxHash: string | null = null;
    if (funds < requiredFunds) {
      const fundDifference = requiredFunds - funds;
      const fundDifferenceInUSDC = this.pushClient.pushToUSDC(fundDifference); // in micro-USDC ( USDC with 6 decimal points )
      feeLockTxHash = await this.lockFee(fundDifferenceInUSDC, executionHash);
    }

    // 7. Sign execution data
    // TODO: Fix signing according to Validator's logic
    const signature = await this.universalSigner.signMessage(
      toBytes(executionHash) // UTF-8 encode the hex string
    );

    // 8. Send Tx to Push chain
    return this.sendCrossChainPushTx(
      isNMSCDeployed,
      feeLockTxHash,
      execute,
      signature
    );
  }

  /**
   * Locks a fee on the origin chain by interacting with the chain's fee-locker contract.
   *
   * @param amount - Fee amount in USDC (8 Decimals)
   * @param executionHash - Optional execution payload hash (default: zeroHash)
   * @returns Transaction hash of the locking transaction
   */
  private async lockFee(
    amount: bigint,
    executionHash: string = zeroHash
  ): Promise<string> {
    const chain = this.universalSigner.chain;
    const { lockerContract, vm, defaultRPC } = CHAIN_INFO[chain];

    if (!lockerContract) {
      throw new Error(`Locker contract not configured for chain: ${chain}`);
    }

    const rpcUrl = this.rpcUrl[chain] || defaultRPC;

    // TODO: Convert USDC to the native token's lowest denomination (e.g., wei for EVM)

    switch (vm) {
      case VM.EVM: {
        const evmClient = new EvmClient({ rpcUrl });

        return await evmClient.writeContract({
          abi: LOCKER_ABI as Abi,
          address: lockerContract,
          functionName: 'addFunds',
          args: [executionHash],
          signer: this.universalSigner,
          value: amount,
        });
      }

      case VM.SVM: {
        const svmClient = new SvmClient({ rpcUrl });

        // TODO: Fix svm client calling
        return await svmClient.writeContract({
          abi: LOCKER_ABI as Abi,
          address: lockerContract,
          functionName: 'addFunds',
          args: [executionHash],
          signer: this.universalSigner,
          value: amount,
        });
      }

      default: {
        throw new Error(`Unsupported VM type: ${vm}`);
      }
    }
  }

  /**
   * Sends a custom Cosmos tx to Push Chain (gasless) to execute user intent.
   */
  public async sendCrossChainPushTx(
    isNMSCDeployed: boolean,
    feeLockTxHash: string | null,
    execute?: ExecuteParams,
    signature?: Uint8Array
  ): Promise<`0x${string}`> {
    // TODO: build and broadcast custom Cosmos transaction (gasless meta tx)
    if (!isNMSCDeployed) {
      // prepare MsgDeployNMSC
    }

    if (feeLockTxHash) {
      // prepare MsgMintPush
    }

    if (execute && signature) {
      // prepare MsgExecutePayload
    }

    // createTxBody
    // signTx
    // broadcastTx

    return '0xTxHash';
  }

  /**
   * Checks if the given chain belongs to the Push Chain ecosystem.
   * Used to differentiate logic for Push-native interactions vs external chains.
   *
   * @param chain - The chain identifier (e.g., PUSH_MAINNET, PUSH_TESTNET)
   * @returns True if the chain is a Push chain, false otherwise.
   */
  private isPushChain(chain: CHAIN): boolean {
    return chain === CHAIN.PUSH_MAINNET || chain === CHAIN.PUSH_TESTNET;
  }

  /**
   * Creates a deterministic SHA-256 hash of a JSON object.
   * Ensures consistent key ordering before hashing to avoid mismatches.
   *
   * @param obj - Any JSON-serializable object
   * @returns A hex string representing the SHA-256 hash of the sorted JSON
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sha256HashOfJson(obj: any): string {
    const jsonStr = JSON.stringify(obj, Object.keys(obj).sort());
    return sha256(toBytes(jsonStr));
  }
}
