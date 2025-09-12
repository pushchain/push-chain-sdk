import {
  Abi,
  zeroHash,
  toBytes,
  keccak256,
  encodeAbiParameters,
  encodePacked,
  bytesToHex,
  stringToBytes,
  getCreate2Address,
  hexToBytes,
  TransactionReceipt,
  getAddress,
  decodeFunctionData,
} from 'viem';
import { PushChain } from '../push-chain/push-chain';
import { CHAIN, PUSH_NETWORK, VM } from '../constants/enums';
import {
  UniversalAccount,
  UniversalSigner,
} from '../universal/universal.types';
import { ExecuteParams } from './orchestrator.types';
import { EvmClient } from '../vm-client/evm-client';
import { CHAIN_INFO, UEA_PROXY, VM_NAMESPACE } from '../constants/chain';
import {
  FACTORY_V1,
  FEE_LOCKER_EVM,
  FEE_LOCKER_SVM,
  UEA_SVM,
} from '../constants/abi';
import { PushClient } from '../push-client/push-client';
import { SvmClient } from '../vm-client/svm-client';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Any } from 'cosmjs-types/google/protobuf/any';
import {
  UniversalPayload,
  VerificationType,
  UniversalAccountId,
} from '../generated/v1/tx';
import { PriceFetch } from '../price-fetch/price-fetch';
import { utils } from '@coral-xyz/anchor';
import {
  PROGRESS_HOOK,
  ProgressEvent,
} from '../progress-hook/progress-hook.types';
import PROGRESS_HOOKS from '../progress-hook/progress-hook';
import { TxResponse } from '../vm-client/vm-client.types';
import { UEA_EVM } from '../constants/abi/uea.evm';
import {
  UniversalTxResponse,
  Signature,
  UniversalTxReceipt,
} from './orchestrator.types';

export class Orchestrator {
  private pushClient: PushClient;

  constructor(
    private readonly universalSigner: UniversalSigner,
    private pushNetwork: PUSH_NETWORK,
    private readonly rpcUrls: Partial<Record<CHAIN, string[]>> = {},
    private readonly printTraces = false,
    private progressHook?: (progress: ProgressEvent) => void
  ) {
    let pushChain: CHAIN;
    if (pushNetwork === PUSH_NETWORK.MAINNET) {
      pushChain = CHAIN.PUSH_MAINNET;
    } else if (
      pushNetwork === PUSH_NETWORK.TESTNET_DONUT ||
      pushNetwork === PUSH_NETWORK.TESTNET
    ) {
      pushChain = CHAIN.PUSH_TESTNET_DONUT;
    } else {
      pushChain = CHAIN.PUSH_LOCALNET;
    }

    const pushChainRPCs: string[] =
      this.rpcUrls[pushChain] || CHAIN_INFO[pushChain].defaultRPC;

    this.pushClient = new PushClient({
      rpcUrls: pushChainRPCs,
      network: pushNetwork,
    });
  }

  /**
   * Read-only accessors for current Orchestrator configuration
   */
  public getNetwork(): PUSH_NETWORK {
    return this.pushNetwork;
  }

  public getRpcUrls(): Partial<Record<CHAIN, string[]>> {
    return this.rpcUrls;
  }

  public getPrintTraces(): boolean {
    return this.printTraces;
  }

  public getProgressHook(): ((progress: ProgressEvent) => void) | undefined {
    return this.progressHook;
  }

  /**
   * Executes an interaction on Push Chain
   */
  async execute(execute: ExecuteParams): Promise<UniversalTxResponse> {
    try {
      // Validate fundGas property - must not be set for now
      if (execute.fundGas) {
        throw new Error('Unsupported token');
      }

      const chain = this.universalSigner.account.chain;
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_01, chain);
      this.validateMainnetConnection(chain);
      /**
       * Push to Push Tx
       */
      if (this.isPushChain(chain)) {
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_06);
        const tx = await this.sendPushTx(execute);
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_99_01, [tx]);
        return tx;
      }
      /**
       * Fetch Gas details and estimate cost of execution
       */
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_02_01);
      const gasEstimate = execute.gasLimit || BigInt(1e7);
      const gasPrice = await this.pushClient.getGasPrice();
      const requiredGasFee = gasEstimate * gasPrice;
      const requiredFunds = requiredGasFee + execute.value;
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_02_02, requiredFunds);
      /**
       * Fetch UEA Details
       */
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_03_01);
      const UEA = this.computeUEAOffchain();
      const [code, funds] = await Promise.all([
        this.pushClient.publicClient.getCode({ address: UEA }),
        this.pushClient.getBalance(UEA),
      ]);
      const isUEADeployed = code !== undefined;
      const nonce = isUEADeployed ? await this.getUEANonce(UEA) : BigInt(0);
      this.executeProgressHook(
        PROGRESS_HOOK.SEND_TX_03_02,
        UEA,
        isUEADeployed,
        funds,
        nonce
      );
      /**
       * Compute Universal Payload Hash
       */
      let feeLockTxHash: string | undefined = execute.feeLockTxHash;
      if (feeLockTxHash && !feeLockTxHash.startsWith('0x')) {
        // decode svm base58
        feeLockTxHash = bytesToHex(utils.bytes.bs58.decode(feeLockTxHash));
      }
      // Fee locking is required if UEA is not deployed OR insufficient funds
      const feeLockingRequired =
        (!isUEADeployed || funds < requiredFunds) && !feeLockTxHash;
      const universalPayload = JSON.parse(
        JSON.stringify(
          {
            to: execute.to,
            value: execute.value,
            data: execute.data || '0x',
            gasLimit: execute.gasLimit || BigInt(1e7),
            maxFeePerGas: execute.maxFeePerGas || BigInt(1e10),
            maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(0),
            nonce,
            deadline: execute.deadline || BigInt(9999999999),
            vType: feeLockingRequired
              ? VerificationType.universalTxVerification
              : VerificationType.signedVerification,
          },
          this.bigintReplacer
        )
      ) as UniversalPayload;
      const executionHash = this.computeExecutionHash({
        verifyingContract: UEA,
        payload: universalPayload,
      });
      /**
       * Prepare verification data by either signature or fund locking
       */
      let verificationData: `0x${string}`;
      /**
       * 1. UEA deployed + sufficient funds: No fee locking needed
       * 2. UEA deployed + insufficient funds: Lock requiredFunds
       * 3. UEA not deployed + sufficient funds: Lock 0.001 PC (for deployment)
       * 4. UEA not deployed + insufficient funds: Lock requiredFunds
       */
      if (!feeLockingRequired) {
        /**
         * Sign Universal Payload
         */
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_01, executionHash);
        const signature = await this.signUniversalPayload(
          universalPayload,
          UEA
        );
        verificationData = bytesToHex(signature);
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_02, verificationData);
      } else {
        /**
         * Fee Locking
         */
        const fundDifference = requiredFunds - funds;
        const fixedPushAmount = PushChain.utils.helpers.parseUnits('0.001', 18); // Minimum lock 0.001 Push tokens
        const lockAmount =
          funds < requiredFunds ? fundDifference : fixedPushAmount;
        const lockAmountInUSD = this.pushClient.pushToUSDC(lockAmount);

        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_05_01, lockAmount);
        const feeLockTxHashBytes = await this.lockFee(
          lockAmountInUSD,
          executionHash
        );
        feeLockTxHash = bytesToHex(feeLockTxHashBytes);
        verificationData = bytesToHex(feeLockTxHashBytes);
        /**
         * Waiting for Confirmations
         */
        const { vm } = CHAIN_INFO[chain];

        this.executeProgressHook(
          PROGRESS_HOOK.SEND_TX_05_02,
          vm === VM.SVM
            ? utils.bytes.bs58.encode(feeLockTxHashBytes)
            : feeLockTxHash,
          CHAIN_INFO[chain].confirmations
        );
        await this.waitForLockerFeeConfirmation(feeLockTxHashBytes);
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_05_03);
      }
      /**
       * Broadcasting Tx to PC
       */
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_06);
      const transactions = await this.sendUniversalTx(
        isUEADeployed,
        feeLockTxHash,
        universalPayload,
        verificationData
      );
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_99_01, transactions);
      return transactions[transactions.length - 1];
    } catch (err) {
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_99_02, err);
      throw err;
    }
  }

  /**
   * Locks a fee on the origin chain by interacting with the chain's fee-locker contract.
   *
   * @param amount - Fee amount in USDC (8 Decimals)
   * @param executionHash - Optional execution payload hash (default: zeroHash)
   * @returns Transaction hash of the locking transaction
   */
  private async lockFee(
    amount: bigint, // USD with 8 decimals
    executionHash: string = zeroHash
  ): Promise<Uint8Array> {
    const chain = this.universalSigner.account.chain;
    var { lockerContract, vm, defaultRPC } = CHAIN_INFO[chain];

    if (!lockerContract) {
      throw new Error(`Locker contract not configured for chain: ${chain}`);
    }

    const rpcUrls: string[] = this.rpcUrls[chain] || defaultRPC;

    switch (vm) {
      case VM.EVM: {
        // Run price fetching and client creation in parallel
        const [nativeTokenUsdPrice, evmClient] = await Promise.all([
          new PriceFetch(this.rpcUrls).getPrice(chain), // 8 decimals
          Promise.resolve(new EvmClient({ rpcUrls })),
        ]);

        const nativeDecimals = 18; // ETH, MATIC, etc.
        const nativeAmount =
          (amount * BigInt(10 ** nativeDecimals)) / nativeTokenUsdPrice;

        const txHash = await evmClient.writeContract({
          abi: FEE_LOCKER_EVM as Abi,
          address: lockerContract,
          functionName: 'addFunds',
          args: [executionHash],
          signer: this.universalSigner,
          value: nativeAmount,
        });
        return hexToBytes(txHash);
      }

      case VM.SVM: {
        lockerContract = process.env['SOLANA_PROGRAM_ID'] as string;
        // Run price fetching, client creation, and PDA computation in parallel
        const [nativeTokenUsdPrice, svmClient, [lockerPda]] = await Promise.all(
          [
            new PriceFetch(this.rpcUrls).getPrice(chain), // 8 decimals
            Promise.resolve(new SvmClient({ rpcUrls })),
            Promise.resolve(
              anchor.web3.PublicKey.findProgramAddressSync(
                [stringToBytes('locker')],
                new PublicKey(lockerContract)
              )
            ),
          ]
        );

        const nativeDecimals = 9; // SOL lamports
        const nativeAmount =
          (amount * BigInt(10 ** nativeDecimals)) / nativeTokenUsdPrice;

        const txHash = await svmClient.writeContract({
          abi: FEE_LOCKER_SVM,
          address: lockerContract,
          functionName: 'addFunds',
          args: [nativeAmount, toBytes(executionHash)],
          signer: this.universalSigner,
          accounts: {
            locker: lockerPda,
            user: new PublicKey(this.universalSigner.account.address),
            priceUpdate: new PublicKey(
              '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'
            ),
            systemProgram: SystemProgram.programId,
          },
        });
        return utils.bytes.bs58.decode(txHash);
      }

      default:
        throw new Error(`Unsupported VM type: ${vm}`);
    }
  }

  private async signUniversalPayload(
    universalPayload: UniversalPayload,
    verifyingContract: `0x${string}`,
    version?: string
  ) {
    const chain = this.universalSigner.account.chain;
    const { vm, chainId } = CHAIN_INFO[chain];

    switch (vm) {
      case VM.EVM: {
        if (!this.universalSigner.signTypedData) {
          throw new Error('signTypedData is not defined');
        }
        return this.universalSigner.signTypedData({
          domain: {
            version: version || '0.1.0',
            chainId: Number(chainId),
            verifyingContract,
          },
          types: {
            UniversalPayload: [
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'data', type: 'bytes' },
              { name: 'gasLimit', type: 'uint256' },
              { name: 'maxFeePerGas', type: 'uint256' },
              { name: 'maxPriorityFeePerGas', type: 'uint256' },
              { name: 'nonce', type: 'uint256' },
              { name: 'deadline', type: 'uint256' },
              { name: 'vType', type: 'uint8' },
            ],
          },
          primaryType: 'UniversalPayload',
          message: universalPayload,
        });
      }

      case VM.SVM: {
        const digest = this.computeExecutionHash({
          verifyingContract,
          payload: universalPayload,
          version: version || '0.1.0',
        });
        return this.universalSigner.signMessage(stringToBytes(digest));
      }

      default: {
        throw new Error(`Unsupported VM type: ${vm}`);
      }
    }
  }

  /**
   * Sends a custom Cosmos tx to Push Chain (gasless) to execute user intent.
   */
  private async sendUniversalTx(
    isUEADeployed: boolean,
    feeLockTxHash?: string,
    universalPayload?: UniversalPayload,
    verificationData?: `0x${string}`
  ): Promise<UniversalTxResponse[]> {
    const { chain, address } = this.universalSigner.account;
    const { vm, chainId } = CHAIN_INFO[chain];

    const universalAccountId: UniversalAccountId = {
      chainNamespace: VM_NAMESPACE[vm],
      chainId: chainId,
      owner:
        vm === VM.EVM
          ? address
          : vm === VM.SVM
          ? bytesToHex(utils.bytes.bs58.decode(address))
          : address,
    };

    const { cosmosAddress: signer } = this.pushClient.getSignerAddress();
    const msgs: Any[] = [];

    if (!isUEADeployed) {
      /**
       * @dev - fee should be locked for UEA deployment to avoid spamming
       */
      if (!feeLockTxHash) {
        throw new Error('UEA cannot be deployed without fee locking');
      }
      msgs.push(
        this.pushClient.createMsgDeployUEA({
          signer,
          universalAccountId,
          txHash: feeLockTxHash,
        })
      );
    }

    if (feeLockTxHash) {
      msgs.push(
        this.pushClient.createMsgMintPC({
          signer,
          universalAccountId,
          txHash: feeLockTxHash,
        })
      );
    }

    if (universalPayload && verificationData) {
      msgs.push(
        this.pushClient.createMsgExecutePayload({
          signer,
          universalAccountId,
          universalPayload,
          verificationData,
        })
      );
    }

    const txBody = await this.pushClient.createCosmosTxBody(msgs);
    const txRaw = await this.pushClient.signCosmosTx(txBody);
    const tx = await this.pushClient.broadcastCosmosTx(txRaw);
    if (tx.code !== 0) {
      throw new Error(tx.rawLog);
    }

    const ethTxHashes: `0x${string}`[] =
      tx.events
        ?.filter((e: any) => e.type === 'ethereum_tx')
        .flatMap((e: any) =>
          e.attributes
            ?.filter((attr: any) => attr.key === 'ethereumTxHash')
            .map((attr: any) => attr.value as `0x${string}`)
        ) ?? [];

    if (ethTxHashes.length === 0) {
      throw new Error('No ethereumTxHash found in transaction events');
    }

    // 🔗 Fetch all corresponding EVM transactions in parallel
    const evmTxs = await Promise.all(
      ethTxHashes.map(async (hash) => {
        return await this.pushClient.getTransaction(hash);
      })
    );

    return await Promise.all(
      evmTxs.map((tx) => this.transformToUniversalTxResponse(tx))
    );
  }

  /**
   * Sends a EVM trx on Push Chain
   * @dev - Only to be used from universal signer is on Push chain
   * @param execute
   * @returns Cosmos Tx Response for a given Evm Tx
   */
  private async sendPushTx(
    execute: ExecuteParams
  ): Promise<UniversalTxResponse> {
    const txHash = await this.pushClient.sendTransaction({
      to: execute.to,
      data: execute.data || '0x',
      value: execute.value,
      signer: this.universalSigner,
    });
    const txResponse = await this.pushClient.getTransaction(txHash);
    return await this.transformToUniversalTxResponse(txResponse);
  }

  /**
   * Computes the EIP-712 digest hash for the UniversalPayload structure.
   * This is the message that should be signed by the user's wallet (e.g., Solana signer).
   *
   * The resulting hash is equivalent to:
   * keccak256("\x19\x01" || domainSeparator || structHash)
   *
   * @param chainId - EVM chain ID of the destination chain (Push Chain)
   * @param verifyingContract - Address of the verifying contract (i.e., the user's UEA smart wallet)
   * @param version - Optional EIP-712 domain version (default: '0.1.0')
   * @param payload - Execution details encoded into the UniversalPayload struct
   * @returns keccak256 digest to be signed by the user
   */
  private computeExecutionHash({
    verifyingContract,
    payload,
    version = '0.1.0',
  }: {
    verifyingContract: `0x${string}`;
    version?: string;
    payload: UniversalPayload;
  }): `0x${string}` {
    const chain = this.universalSigner.account.chain;
    const { vm, chainId } = CHAIN_INFO[chain];

    // 1. Type hash
    const typeHash = keccak256(
      toBytes(
        'UniversalPayload(address to,uint256 value,bytes data,uint256 gasLimit,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,uint256 nonce,uint256 deadline,uint8 vType)'
      )
    );

    // 2. Domain separator
    const domainTypeHash = keccak256(
      toBytes(
        vm === VM.EVM
          ? 'EIP712Domain(string version,uint256 chainId,address verifyingContract)'
          : 'EIP712Domain_SVM(string version,string chainId,address verifyingContract)'
      )
    );

    const domainSeparator = keccak256(
      encodeAbiParameters(
        [
          { name: 'typeHash', type: 'bytes32' },
          { name: 'version', type: 'bytes32' },
          { name: 'chainId', type: vm === VM.EVM ? 'uint256' : 'string' },
          { name: 'verifyingContract', type: 'address' },
        ],
        [
          domainTypeHash,
          keccak256(toBytes(version)),
          vm === VM.EVM ? BigInt(chainId) : chainId,
          verifyingContract,
        ]
      )
    );

    // 3. Struct hash
    const structHash = keccak256(
      encodeAbiParameters(
        [
          { name: 'typeHash', type: 'bytes32' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes32' },
          { name: 'gasLimit', type: 'uint256' },
          { name: 'maxFeePerGas', type: 'uint256' },
          { name: 'maxPriorityFeePerGas', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'vType', type: 'uint8' },
        ],
        [
          typeHash,
          payload.to as `0x${string}`,
          BigInt(payload.value),
          keccak256(payload.data as `0x${string}`),
          BigInt(payload.gasLimit),
          BigInt(payload.maxFeePerGas),
          BigInt(payload.maxPriorityFeePerGas),
          BigInt(payload.nonce),
          BigInt(payload.deadline),
          payload.vType,
        ]
      )
    );

    // 4. Final digest
    return keccak256(
      encodePacked(
        ['string', 'bytes32', 'bytes32'],
        ['\x19\x01', domainSeparator, structHash]
      )
    );
  }

  /**
   * Computes UEA for given UniversalAccount
   * @dev - This fn calls a view fn of Factory Contract
   * @dev - Don't use this fn in production - only used for testing
   * @returns UEA Address with Deployment Status
   */
  async computeUEA(): Promise<{
    address: `0x${string}`;
    deployed: boolean;
  }> {
    const { chain, address } = this.universalSigner.account;
    const { vm, chainId } = CHAIN_INFO[chain];

    if (this.isPushChain(chain)) {
      throw new Error('UEA cannot be computed for a Push Chain Address');
    }

    const computedAddress: `0x{string}` = await this.pushClient.readContract({
      address: this.pushClient.pushChainInfo.factoryAddress,
      abi: FACTORY_V1 as Abi,
      functionName: 'computeUEA',
      args: [
        {
          chainNamespace: VM_NAMESPACE[vm],
          chainId: chainId,
          /**
           * @dev - Owner should be in bytes
           * for eth - convert hex to bytes
           * for sol - convert base64 to bytes
           * for others - not defined yet
           */
          owner:
            vm === VM.EVM
              ? address
              : vm === VM.SVM
              ? bytesToHex(utils.bytes.bs58.decode(address))
              : address,
        },
      ],
    });

    const byteCode = await this.pushClient.publicClient.getCode({
      address: computedAddress,
    });
    return { address: computedAddress, deployed: byteCode !== undefined };
  }

  computeUEAOffchain(): `0x${string}` {
    const { chain, address } = this.universalSigner.account;
    const { vm, chainId } = CHAIN_INFO[chain];

    // If already an on-chain Push EOA, just return it
    if (this.isPushChain(chain)) {
      return address as `0x${string}`;
    }

    // 1) Figure out the external‐chain ownerKey bytes
    let ownerKey: `0x${string}`;
    if (CHAIN_INFO[chain].vm === VM.EVM) {
      ownerKey = address as `0x${string}`;
    } else if (CHAIN_INFO[chain].vm === VM.SVM) {
      ownerKey = bytesToHex(utils.bytes.bs58.decode(address));
    } else {
      throw new Error(`Unsupported VM type: ${CHAIN_INFO[chain].vm}`);
    }

    // Step 1: Recreate the salt: keccak256(abi.encode(UniversalAccount))
    const encodedAccountId = encodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'chainNamespace', type: 'string' },
            { name: 'chainId', type: 'string' },
            { name: 'owner', type: 'bytes' },
          ],
        },
      ],
      [{ chainNamespace: VM_NAMESPACE[vm], chainId, owner: ownerKey }]
    );

    const salt = keccak256(encodedAccountId);

    // Step 2: Clone Minimal Proxy bytecode
    const minimalProxyRuntimeCode = ('0x3d602d80600a3d3981f3' +
      '363d3d373d3d3d363d73' +
      UEA_PROXY[this.pushNetwork].toLowerCase().replace(/^0x/, '') +
      '5af43d82803e903d91602b57fd5bf3') as `0x${string}`;

    // Step 3: Get init code hash (used by CREATE2)
    const initCodeHash = keccak256(minimalProxyRuntimeCode);

    // Step 4: Predict the address using standard CREATE2 formula
    const ueaAddress = getCreate2Address({
      from: this.pushClient.pushChainInfo.factoryAddress,
      salt,
      bytecodeHash: initCodeHash,
    });

    return ueaAddress;
  }

  /**
   * @dev - Although as of now nonce var is same in evm & svm so switch conditions does not matter
   * @param address UEA address
   * @returns UEA current nonce
   */
  private async getUEANonce(address: `0x${string}`): Promise<bigint> {
    const chain = this.universalSigner.account.chain;
    const { vm } = CHAIN_INFO[chain];

    switch (vm) {
      case VM.EVM: {
        return this.pushClient.readContract({
          address,
          abi: UEA_EVM as Abi,
          functionName: 'nonce',
        });
      }

      case VM.SVM: {
        return this.pushClient.readContract({
          address,
          abi: UEA_SVM as Abi,
          functionName: 'nonce',
        });
      }

      default: {
        throw new Error(`Unsupported VM type: ${vm}`);
      }
    }
  }

  // TODO: Fix this fn - It needs to get UOA for a given UEA
  getUOA(): UniversalAccount {
    return {
      chain: this.universalSigner.account.chain,
      address: this.universalSigner.account.address,
    };
  }

  private async waitForLockerFeeConfirmation(
    txHashBytes: Uint8Array
  ): Promise<void> {
    const chain = this.universalSigner.account.chain;
    const { vm, defaultRPC, confirmations, timeout } = CHAIN_INFO[chain];
    const rpcUrls = this.rpcUrls[chain] || defaultRPC;

    switch (vm) {
      case VM.EVM: {
        const evmClient = new EvmClient({ rpcUrls });
        await evmClient.waitForConfirmations({
          txHash: bytesToHex(txHashBytes),
          confirmations,
          timeoutMs: timeout,
        });
        return;
      }

      case VM.SVM: {
        const svmClient = new SvmClient({ rpcUrls });
        await svmClient.waitForConfirmations({
          txSignature: utils.bytes.bs58.encode(txHashBytes),
          confirmations,
          timeoutMs: timeout,
        });
        return;
      }

      default:
        throw new Error(`Unsupported VM for tx confirmation: ${vm}`);
    }
  }

  /********************************** HELPER FUNCTIONS **************************************************/

  /**
   * Transforms a TransactionReceipt to UniversalTxReceipt format
   */
  private transformToUniversalTxReceipt(
    receipt: TransactionReceipt, // TransactionReceipt from viem
    originalTxResponse: UniversalTxResponse
  ): UniversalTxReceipt {
    return {
      // 1. Identity
      hash: receipt.transactionHash,

      // 2. Block Info
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      transactionIndex: receipt.transactionIndex,

      // 3. Execution Context
      from: originalTxResponse.from,
      to: originalTxResponse.to,
      contractAddress: receipt.contractAddress || null,

      // 4. Gas & Usage
      gasPrice: originalTxResponse.gasPrice || BigInt(0),
      gasUsed: receipt.gasUsed,
      cumulativeGasUsed: receipt.cumulativeGasUsed,

      // 5. Logs
      logs: receipt.logs || [],
      logsBloom: receipt.logsBloom || '0x',

      // 6. Outcome
      status: receipt.status === 'success' ? 1 : 0,

      // 7. Raw
      raw: originalTxResponse.raw || {
        from: originalTxResponse.from,
        to: originalTxResponse.to,
      },
    };
  }

  /**
   * Transforms a TxResponse to the new UniversalTxResponse format
   */
  private async transformToUniversalTxResponse(
    tx: TxResponse
  ): Promise<UniversalTxResponse> {
    const chain = this.universalSigner.account.chain;
    const { vm, chainId } = CHAIN_INFO[chain];
    let from: `0x${string}`;
    let to: `0x${string}`;
    let value: bigint;
    let data: string;
    let rawTransactionData: {
      from: string;
      to: string;
      nonce: number;
      data: string;
      value: bigint;
    };

    const ueaOrigin =
      await PushChain.utils.account.convertExecutorToOriginAccount(
        tx.to as `0x${string}`
      );
    let originAddress: string;

    if (ueaOrigin.exists) {
      if (!ueaOrigin.account) {
        throw new Error('UEA origin account is null');
      }
      originAddress = ueaOrigin.account.address;
      from = getAddress(tx.to as `0x${string}`);

      let decoded;

      if (tx.input !== '0x') {
        decoded = decodeFunctionData({
          abi: UEA_EVM,
          data: tx.input,
        });
        if (!decoded?.args) {
          throw new Error('Failed to decode function data');
        }
        const universalPayload = decoded?.args[0] as {
          to: string;
          value: bigint;
          data: string;
          gasLimit: bigint;
          maxFeePerGas: bigint;
          maxPriorityFeePerGas: bigint;
          nonce: bigint;
          deadline: bigint;
          vType: number;
        };

        to = universalPayload.to as `0x${string}`;
        value = BigInt(universalPayload.value);
        data = universalPayload.data;
        rawTransactionData = {
          from: getAddress(tx.from),
          to: getAddress(tx.to as `0x${string}`),
          nonce: tx.nonce,
          data: tx.input,
          value: tx.value,
        };
      } else {
        to = getAddress(tx.to as `0x${string}`);
        value = tx.value;
        data = tx.input;
        rawTransactionData = {
          from: getAddress(tx.from),
          to: getAddress(tx.to as `0x${string}`),
          nonce: tx.nonce,
          data: tx.input,
          value: tx.value,
        };
      }
    } else {
      originAddress = getAddress(tx.from);
      from = getAddress(tx.from);
      to = getAddress(tx.to as `0x${string}`);
      value = tx.value;
      data = tx.input;
      rawTransactionData = {
        from: getAddress(tx.from),
        to: getAddress(tx.to as `0x${string}`),
        nonce: tx.nonce,
        data: tx.input,
        value: tx.value,
      };
    }

    const origin = `${VM_NAMESPACE[vm]}:${chainId}:${originAddress}`;

    // Create signature from transaction r, s, v values
    let signature: Signature;
    try {
      signature = {
        r: tx.r || '0x0',
        s: tx.s || '0x0',
        v: typeof tx.v === 'bigint' ? Number(tx.v) : tx.v || 0,
        yParity: tx.yParity,
      };
    } catch {
      // Fallback signature if parsing fails
      signature = {
        r: '0x0000000000000000000000000000000000000000000000000000000000000000',
        s: '0x0000000000000000000000000000000000000000000000000000000000000000',
        v: 0,
        yParity: 0,
      };
    }

    // Determine transaction type and typeVerbose
    let type = '99'; // universal
    let typeVerbose = 'universal';

    if (tx.type !== undefined) {
      const txType = tx.type;
      if (txType === 'eip1559') {
        type = '2';
        typeVerbose = 'eip1559';
      } else if (txType === 'eip2930') {
        type = '1';
        typeVerbose = 'eip2930';
      } else if (txType === 'legacy') {
        type = '0';
        typeVerbose = 'legacy';
      } else if (txType == 'eip4844') {
        type = '3';
        typeVerbose = 'eip4844';
      }
    }

    const universalTxResponse: UniversalTxResponse = {
      // 1. Identity
      hash: tx.hash,
      origin,

      // 2. Block Info
      blockNumber: tx.blockNumber || BigInt(0),
      blockHash: tx.blockHash || '',
      transactionIndex: tx.transactionIndex || 0,
      chainId,

      // 3. Execution Context
      from: from, // UEA (executor) address, checksummed for EVM
      to: to || '',
      nonce: tx.nonce,

      // 4. Payload
      data, // perceived calldata (was input)
      value,

      // 5. Gas
      gasLimit: tx.gas || BigInt(0), // (was gas)
      gasPrice: tx.gasPrice,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      accessList: Array.isArray(tx.accessList) ? [...tx.accessList] : [],

      // 6. Utilities
      wait: async (): Promise<UniversalTxReceipt> => {
        const receipt = await tx.wait();
        return this.transformToUniversalTxReceipt(receipt, universalTxResponse);
      },

      // 7. Metadata
      type,
      typeVerbose,
      signature,

      // 8. Raw Universal Fields
      raw: rawTransactionData,
    };

    return universalTxResponse;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private bigintReplacer(_key: string, value: any) {
    return typeof value === 'bigint'
      ? value.toString() // convert BigInt to string
      : value;
  }

  /**
   * Checks if the given chain belongs to the Push Chain ecosystem.
   * Used to differentiate logic for Push-native interactions vs external chains.
   *
   * @param chain - The chain identifier (e.g., PUSH_MAINNET, PUSH_TESTNET_DONUT)
   * @returns True if the chain is a Push chain, false otherwise.
   */
  private isPushChain(chain: CHAIN): boolean {
    return (
      chain === CHAIN.PUSH_MAINNET ||
      chain === CHAIN.PUSH_TESTNET_DONUT ||
      chain === CHAIN.PUSH_LOCALNET
    );
  }

  private validateMainnetConnection(chain: CHAIN) {
    const isMainnet = [CHAIN.ETHEREUM_MAINNET, CHAIN.SOLANA_MAINNET].includes(
      chain
    );
    if (
      isMainnet &&
      this.pushClient.pushChainInfo.chainId !==
        CHAIN_INFO[CHAIN.PUSH_MAINNET].chainId
    ) {
      throw new Error('Mainnet chains can only interact with Push Mainnet');
    }
  }

  private printLog(log: string): void {
    if (this.printTraces) {
      console.log(`[${this.constructor.name}] ${log}`);
    }
  }

  private executeProgressHook(hookId: string, ...args: any[]): void {
    const hookEntry = PROGRESS_HOOKS[hookId];
    const hookPayload: ProgressEvent = hookEntry(...args);
    this.printLog(hookPayload.message);
    if (!this.progressHook) return;
    // invoke the user-provided callback
    this.progressHook(hookPayload);
  }
}
