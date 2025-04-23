import { Abi, parseAbi, parseEther, zeroHash } from 'viem';
import { CHAIN, ENV, VM } from '../constants/enums';
import { UniversalSigner } from '../universal/universal.types';
import { ExecuteParams } from './orchestrator.types';
import { EvmClient } from '../vm-client/evm-client';
import { CHAIN_ID } from 'packages/devnet/src/lib/constants';
import { CHAIN_INFO } from '../constants/chain';
import { LOCKER_ABI } from '../constants/abi';

export class Orchestrator {
  constructor(
    private readonly universalSigner: UniversalSigner,
    private readonly pushNetwork: ENV,
    private readonly rpcUrl: Partial<Record<CHAIN, string>> = {},
    private readonly printTraces = false
  ) {}

  /**
   * Executes an interaction on Push Chain — either direct or gasless.
   * Handles NMSC derivation, fee checks, and optional fee-locking.
   */
  async execute({
    target,
    value = parseEther('0'),
    data,
  }: ExecuteParams): Promise<`0x${string}`> {
    const chain = this.universalSigner.chain;

    // 1. Block direct execution if signer is already on Push Chain
    if (this.isPushChain(chain)) {
      throw new Error('UniversalSigner is already on Push Chain');
    }

    // 2. Derive NMSC address for this signer (on Push Chain)
    const nmscAddress = await this.deriveNMSCAddress();

    // 3. Estimate gas fee for this interaction
    const requiredFee = await this.estimateFee({ target, value, data });

    // 4. Check NMSC balance on Push Chain
    const hasFunds = await this.checkNMSCBalance(nmscAddress);

    // 5. If not enough funds, lock required fee on source chain
    if (hasFunds < requiredFee) {
      await this.lockFee(requiredFee);
    }

    // 6. Submit gasless transaction to Push Chain via custom Cosmos tx
    const txHash = await this.sendGaslessPushTx({
      target,
      value,
      data,
      nmscAddress,
    });

    return txHash;
  }

  /**
   * Computes the CREATE2-derived smart wallet address on Push Chain.
   */
  private async deriveNMSCAddress(): Promise<`0x${string}`> {
    // TODO: Use CREATE2 logic with known factory + salt (user address)
    return this.universalSigner.address as `0x${string}`;
  }

  /**
   * Estimates the gas fee needed for executing the user’s request on Push Chain.
   */
  private async estimateFee({
    target,
    value,
    data,
  }: ExecuteParams): Promise<bigint> {
    const pushChain =
      this.pushNetwork === ENV.MAINNET
        ? CHAIN.PUSH_MAINNET
        : CHAIN.PUSH_TESTNET;

    const pushChainRPC =
      this.rpcUrl[pushChain] || CHAIN_INFO[pushChain].defaultRPC;

    const evmClient = new EvmClient({ rpcUrl: pushChainRPC });

    // Simulate the tx to get estimated gas
    const gasEstimate = await evmClient.estimateGas({
      from: await this.deriveNMSCAddress(), // the NMSC smart wallet
      to: target as `0x${string}`,
      data,
      value,
    });

    // Fetch current gas price on Push Chain
    const gasPrice = await evmClient.getGasPrice();

    // Multiply to get total cost in wei
    return gasEstimate * gasPrice;
  }

  /**
   * Checks NMSC balance for a given account
   * In case NMSC is not deployed - balance would be 0
   */
  private async checkNMSCBalance(address: `0x${string}`): Promise<bigint> {
    const pushChain =
      this.pushNetwork === ENV.MAINNET
        ? CHAIN.PUSH_MAINNET
        : CHAIN.PUSH_TESTNET;
    const pushChainRPC =
      this.rpcUrl[pushChain] || CHAIN_INFO[pushChain].defaultRPC;

    const pushClient = new EvmClient({ rpcUrl: pushChainRPC });
    return pushClient.getBalance(address);
  }

  /**
   * Locks fee on origin chain by interacting with the fee-locker contract.
   * amount is in lowest asset representation of the chain ( wei for evm )
   */
  private async lockFee(amount: bigint): Promise<string> {
    const { lockerContract, vm, defaultRPC } =
      CHAIN_INFO[this.universalSigner.chain];

    switch (vm) {
      case VM.EVM: {
        if (!lockerContract) {
          throw new Error('Locker Contract Not Found');
        }
        const rpcUrl = this.rpcUrl[this.universalSigner.chain] || defaultRPC;
        const evmClient = new EvmClient({ rpcUrl });

        return await evmClient.writeContract({
          abi: LOCKER_ABI as Abi,
          address: lockerContract,
          functionName: 'addFunds',
          args: [zeroHash],
          signer: this.universalSigner,
          value: amount,
        });
      }
      case VM.SVM: {
        throw new Error('Not Implemented');
      }
      default: {
        throw new Error('Unknown VM');
      }
    }
  }

  /**
   * Sends a custom Cosmos tx to Push Chain (gasless) to execute user intent.
   */
  private async sendGaslessPushTx({
    target,
    value,
    data,
    nmscAddress,
  }: {
    target: string;
    value: bigint;
    data?: `0x${string}`;
    nmscAddress: string;
  }): Promise<`0x${string}`> {
    // TODO: build and broadcast custom Cosmos transaction (gasless meta tx)
    return '0xTxHash';
  }

  /**
   * Utility: checks if a chain belongs to the Push Chain group.
   */
  private isPushChain(chain: CHAIN): boolean {
    return chain === CHAIN.PUSH_MAINNET || chain === CHAIN.PUSH_TESTNET;
  }
}
