import {
  Abi,
  zeroHash,
  toBytes,
  keccak256,
  encodeAbiParameters,
  encodePacked,
} from 'viem';
import { CHAIN, NETWORK, VM } from '../constants/enums';
import { UniversalSigner } from '../universal/universal.types';
import { ExecuteParams } from './orchestrator.types';
import { EvmClient } from '../vm-client/evm-client';
import { CHAIN_INFO } from '../constants/chain';
import { LOCKER_ABI } from '../constants/abi';
import { toChainAgnostic } from '../universal/account';
import { PushClient } from '../push-client/push-client';
import { SvmClient } from '../vm-client/svm-client';
import LOCKER_IDL from '../constants/idl.json';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';

export class Orchestrator {
  private pushClient: PushClient;

  constructor(
    private readonly universalSigner: UniversalSigner,
    pushNetwork: NETWORK,
    private readonly rpcUrl: Partial<Record<CHAIN, string>> = {},
    private readonly printTraces = false
  ) {
    const pushChain =
      pushNetwork === NETWORK.MAINNET ? CHAIN.PUSH_MAINNET : CHAIN.PUSH_TESTNET;
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

    if (this.printTraces) {
      console.log(
        `[Orchestrator] Starting cross-chain execution from chain: ${chain}`
      );
    }

    // Add validation that if sepolia, or any origin testnet, you can only interact with Push testnet. Same for mainnet
    const isTestnet = [
      CHAIN.ETHEREUM_SEPOLIA,
      CHAIN.SOLANA_TESTNET,
      CHAIN.SOLANA_DEVNET,
    ].includes(chain);

    const isMainnet = [CHAIN.ETHEREUM_MAINNET, CHAIN.SOLANA_MAINNET].includes(
      chain
    );

    if (
      isTestnet &&
      this.pushClient.pushChainInfo.chainId !==
        CHAIN_INFO[CHAIN.PUSH_TESTNET].chainId
    ) {
      throw new Error('Testnet chains can only interact with Push Testnet');
    }

    if (
      isMainnet &&
      this.pushClient.pushChainInfo.chainId !==
        CHAIN_INFO[CHAIN.PUSH_MAINNET].chainId
    ) {
      throw new Error('Mainnet chains can only interact with Push Mainnet');
    }

    // 1. Block direct execution if signer is already on Push Chain
    if (this.isPushChain(chain)) {
      throw new Error('UniversalSigner is already on Push Chain');
    }

    // 2. Get Push chain NMSC address for this signer
    if (this.printTraces) {
      console.log('[Orchestrator] Fetching NMSC address for signer...');
    }
    const { address: nmscAddress, deployed: isNMSCDeployed } =
      await this.pushClient.getNMSCAddress(
        toChainAgnostic(this.universalSigner)
      );
    if (this.printTraces) {
      console.log(
        `[Orchestrator] NMSC Address: ${nmscAddress}, Deployed: ${isNMSCDeployed}`
      );
    }

    // 3. Estimate funds required for the execution
    if (this.printTraces) {
      console.log('[Orchestrator] Estimating required funds...');
    }
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

    // Calculate required gas fee with buffer to account for potential gas price fluctuations
    const gasPrice = await this.pushClient.getGasPrice();
    const gasBufferPercent = BigInt(110); // 10% buffer
    const adjustedGasEstimate = (gasEstimate * gasBufferPercent) / BigInt(100);
    const requiredGasFee = gasPrice * adjustedGasEstimate;
    const requiredFunds = requiredGasFee + execute.value;

    if (this.printTraces) {
      console.log(
        `[Orchestrator] Required funds: ${requiredFunds} (Gas: ${requiredGasFee}, Value: ${execute.value})`
      );
    }

    // 4. Check NMSC balance on Push Chain ( in nPUSH )
    if (this.printTraces) {
      console.log('[Orchestrator] Checking NMSC balance...');
    }
    const funds = await this.pushClient.getBalance(nmscAddress);
    if (this.printTraces) {
      console.log(`[Orchestrator] Current balance: ${funds}`);
    }

    // 5. Create execution hash ( execution data to be signed )
    if (this.printTraces) {
      console.log('[Orchestrator] Computing execution hash...');
    }
    const executionHash = this.computeExecutionHash({
      verifyingContract: nmscAddress,
      payload: {
        target: execute.target,
        value: execute.value,
        data: execute.data,
        gasLimit: execute.gasLimit || BigInt(21000000),
        maxFeePerGas: execute.maxFeePerGas || BigInt(10000000000000000),
        maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(2),
        nonce: execute.nonce || BigInt(1), // TODO: fetch is from nmsc itself
        deadline: execute.deadline || BigInt(9999999999),
      },
    });
    if (this.printTraces) {
      console.log(`[Orchestrator] Execution hash: ${executionHash}`);
    }

    // 6 If not enough funds, lock required fee on source chain and send tx to Push chain
    let feeLockTxHash: string | null = null;
    if (funds < requiredFunds) {
      if (this.printTraces) {
        console.log(
          '[Orchestrator] Insufficient funds, locking additional fees...'
        );
      }
      const fundDifference = requiredFunds - funds;
      const fundDifferenceInUSDC = this.pushClient.pushToUSDC(fundDifference); // in micro-USDC ( USDC with 6 decimal points )
      feeLockTxHash = await this.lockFee(
        fundDifferenceInUSDC,
        toBytes(executionHash)
      );
      if (this.printTraces) {
        console.log(
          `[Orchestrator] Fee lock transaction hash: ${feeLockTxHash}`
        );
      }
    }

    // 7. Sign execution data
    if (this.printTraces) {
      console.log('[Orchestrator] Signing execution data...');
    }

    // TODO: Fix signing according to Validator's logic
    // Does it need to beut8 encoded for only solana or for eth too ??
    const signature = await this.universalSigner.signMessage(
      toBytes(executionHash) // UTF-8 encode the hex string
    );
    if (this.printTraces) {
      console.log('[Orchestrator] Execution data signed successfully');
    }

    // 8. Send Tx to Push chain
    if (this.printTraces) {
      console.log('[Orchestrator] Sending transaction to Push chain...');
    }
    const txHash = await this.sendCrossChainPushTx(
      isNMSCDeployed,
      feeLockTxHash,
      execute,
      signature
    );
    if (this.printTraces) {
      console.log(
        `[Orchestrator] Transaction sent successfully. Hash: ${txHash}`
      );
    }

    return txHash;
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
    executionHash: Uint8Array = toBytes(zeroHash)
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

        const [lockerPda, lockerBump] =
          anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from('locker')],
            new PublicKey(lockerContract)
          );

        return await svmClient.writeContract({
          abi: LOCKER_IDL,
          address: lockerContract,
          functionName: 'addFunds',
          args: [amount, executionHash],
          signer: this.universalSigner,
          accounts: {
            locker: lockerPda,
            user: new PublicKey(this.universalSigner.address),
            systemProgram: SystemProgram.programId,
          },
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
   * Computes the EIP-712 digest hash for the CrossChainPayload structure.
   * This is the message that should be signed by the user's wallet (e.g., Solana signer).
   *
   * The resulting hash is equivalent to:
   * keccak256("\x19\x01" || domainSeparator || structHash)
   *
   * @param chainId - EVM chain ID of the destination chain (Push Chain)
   * @param verifyingContract - Address of the verifying contract (i.e., the user's NMSC smart wallet)
   * @param version - Optional EIP-712 domain version (default: '0.1.0')
   * @param payload - Execution details encoded into the CrossChainPayload struct
   * @returns keccak256 digest to be signed by the user
   */
  private computeExecutionHash({
    chainId = Number(this.pushClient.pushChainInfo.chainId),
    verifyingContract,
    payload,
    version = '0.1.0',
  }: {
    chainId?: number;
    verifyingContract: `0x${string}`;
    version?: string;
    payload: {
      target: `0x${string}`;
      value: bigint;
      data: `0x${string}`;
      gasLimit: bigint;
      maxFeePerGas: bigint;
      maxPriorityFeePerGas: bigint;
      nonce: bigint;
      deadline: bigint;
    };
  }): `0x${string}` {
    // 1. Hash the type signature
    const typeHash = keccak256(
      toBytes(
        'CrossChainPayload(address target,uint256 value,bytes data,uint256 gasLimit,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,uint256 nonce,uint256 deadline)'
      )
    );

    // 2. Domain separator
    const domainTypeHash = keccak256(
      toBytes(
        'EIP712Domain(string version,uint256 chainId,address verifyingContract)'
      )
    );

    const domainSeparator = keccak256(
      encodeAbiParameters(
        [
          { name: 'typeHash', type: 'bytes32' },
          { name: 'version', type: 'bytes32' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        [
          domainTypeHash,
          keccak256(toBytes(version)),
          BigInt(chainId),
          verifyingContract,
        ]
      )
    );

    // 3. Struct hash
    const structHash = keccak256(
      encodeAbiParameters(
        [
          { name: 'typeHash', type: 'bytes32' },
          { name: 'target', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'dataHash', type: 'bytes32' },
          { name: 'gasLimit', type: 'uint256' },
          { name: 'maxFeePerGas', type: 'uint256' },
          { name: 'maxPriorityFeePerGas', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
        [
          typeHash,
          payload.target,
          payload.value,
          keccak256(payload.data),
          payload.gasLimit,
          payload.maxFeePerGas,
          payload.maxPriorityFeePerGas,
          payload.nonce,
          payload.deadline,
        ]
      )
    );

    // 4. Final digest: keccak256("\x19\x01" || domainSeparator || structHash)
    const digest = keccak256(
      encodePacked(
        ['string', 'bytes32', 'bytes32'],
        ['\x19\x01', domainSeparator, structHash]
      )
    );

    return digest;
  }
}
