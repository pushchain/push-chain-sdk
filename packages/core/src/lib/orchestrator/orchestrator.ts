import {
  Abi,
  zeroHash,
  toBytes,
  keccak256,
  sha256,
  encodeAbiParameters,
  encodePacked,
  bytesToHex,
  stringToBytes,
  getCreate2Address,
  hexToBytes,
  TransactionReceipt,
  getAddress,
  decodeFunctionData,
  parseAbi,
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
  ERC20_EVM,
  UNIVERSAL_GATEWAY_V0,
  SVM_GATEWAY_IDL,
} from '../constants/abi';
import { PushClient } from '../push-client/push-client';
import { SvmClient } from '../vm-client/svm-client';
import { PublicKey, SystemProgram, Connection } from '@solana/web3.js';
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
import {
  ConversionQuote,
  MOVEABLE_TOKENS,
  MoveableToken,
  PAYABLE_TOKENS,
  PayableToken,
} from '../constants/tokens';

export class Orchestrator {
  private pushClient: PushClient;
  private ueaVersionCache?: string;

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
      // FUNDS_TX short-circuit: Bridge tokens from origin chain to Push Chain
      // - EVM (Sepolia): UniversalGatewayV0
      // - SVM (Solana Devnet): pushsolanagateway
      if (execute.funds) {
        if (!execute.data || execute.data === '0x') {
          // Disallow user-provided `value` for funds-only bridging. The SDK derives
          // origin-chain msg.value automatically from the funds input:
          //  - Native path: msg.value = bridgeAmount
          //  - ERC-20 path: msg.value = 0
          if (execute.value !== undefined && execute.value !== BigInt(0)) {
            throw new Error(
              'Do not set `value` when using funds bridging; the SDK sets origin msg.value from `funds.amount` automatically'
            );
          }
          const chain = this.universalSigner.account.chain;
          const { vm } = CHAIN_INFO[chain];
          if (
            !(
              chain === CHAIN.ETHEREUM_SEPOLIA ||
              chain === CHAIN.ARBITRUM_SEPOLIA ||
              chain === CHAIN.BASE_SEPOLIA ||
              chain === CHAIN.BNB_TESTNET ||
              chain === CHAIN.SOLANA_DEVNET
            )
          ) {
            throw new Error(
              'Funds bridging is only supported on Ethereum Sepolia, Arbitrum Sepolia, Base Sepolia, BNB Testnet, and Solana Devnet for now'
            );
          }

          // Progress: Origin chain detected
          this.executeProgressHook(PROGRESS_HOOK.SEND_TX_01, chain);

          const { defaultRPC, lockerContract } = CHAIN_INFO[chain];
          const rpcUrls: string[] = this.rpcUrls[chain] || defaultRPC;

          // Resolve token: default to native token based on VM (ETH for EVM, SOL for SVM)
          if (!execute.funds.token) {
            const available: MoveableToken[] =
              (MOVEABLE_TOKENS[chain] as MoveableToken[] | undefined) || [];
            const vm = CHAIN_INFO[chain].vm;
            const preferredSymbol =
              vm === VM.EVM ? 'ETH' : vm === VM.SVM ? 'SOL' : undefined;
            const nativeToken = preferredSymbol
              ? available.find((t) => t.symbol === preferredSymbol)
              : undefined;
            if (!nativeToken) {
              throw new Error('Native token not configured for this chain');
            }
            execute.funds.token = nativeToken;
          }

          const amount = execute.funds.amount;
          const symbol = execute.funds.token.symbol;

          // Funds Flow: Preparing funds transfer
          this.executeProgressHook(
            PROGRESS_HOOK.SEND_TX_06_01,
            amount,
            execute.funds.token.decimals,
            symbol
          );

          if (vm === VM.EVM) {
            const evmClient = new EvmClient({ rpcUrls });
            const gatewayAddress = lockerContract as `0x${string}`;
            const tokenAddr = execute.funds.token.address as `0x${string}`;
            // Approve gateway to pull tokens if ERC-20 (not native sentinel)
            if (execute.funds.token.mechanism === 'approve') {
              await this.ensureErc20Allowance(
                evmClient,
                tokenAddr,
                gatewayAddress,
                amount
              );
            } else if (execute.funds.token.mechanism === 'permit2') {
              throw new Error('Permit2 is not supported yet');
            } else if (execute.funds.token.mechanism === 'native') {
              // Native flow uses msg.value == bridgeAmount and bridgeToken = address(0)
            }
          }

          const bridgeAmount = amount;

          const revertCFG = {
            fundRecipient: this.universalSigner.account
              .address as `0x${string}`,
            revertMsg: '0x',
          } as unknown as never; // typed by viem via ABI

          if (vm === VM.EVM) {
            const evmClient = new EvmClient({ rpcUrls });
            const gatewayAddress = lockerContract as `0x${string}`;
            const tokenAddr = execute.funds.token.address as `0x${string}`;
            // Call UniversalGatewayV0.sendFunds(recipient, bridgeToken, bridgeAmount, revertCFG)
            const recipient = execute.to; // funds to recipient on Push Chain
            const isNative = execute.funds.token.mechanism === 'native';
            const bridgeToken =
              execute.funds.token.mechanism === 'approve'
                ? tokenAddr
                : ('0x0000000000000000000000000000000000000000' as `0x${string}`);

            let txHash: `0x${string}`;
            try {
              txHash = await evmClient.writeContract({
                abi: UNIVERSAL_GATEWAY_V0 as unknown as Abi,
                address: gatewayAddress,
                functionName: 'sendFunds',
                args: [recipient, bridgeToken, bridgeAmount, revertCFG],
                signer: this.universalSigner,
                value: isNative ? bridgeAmount : BigInt(0),
              });
            } catch (err) {
              this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_04);
              throw err;
            }

            this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_03);
            this.executeProgressHook(
              PROGRESS_HOOK.SEND_TX_06_02,
              txHash,
              bridgeAmount,
              execute.funds.token.decimals,
              symbol
            );

            await this.waitForEvmConfirmationsWithCountdown(
              evmClient,
              txHash,
              4,
              210000
            );
            // After origin confirmations, query Push Chain for UniversalTx status
            await this.queryUniversalTxStatusFromGatewayTx(
              evmClient,
              gatewayAddress,
              txHash,
              'sendFunds'
            );
            const tx = await evmClient.getTransaction(txHash);
            return await this.transformToUniversalTxResponse(tx);
          } else {
            // SVM path (Solana Devnet)
            const svmClient = new SvmClient({ rpcUrls });
            const programId = new PublicKey(SVM_GATEWAY_IDL.address);
            const [configPda] = PublicKey.findProgramAddressSync(
              [stringToBytes('config')],
              programId
            );
            const [vaultPda] = PublicKey.findProgramAddressSync(
              [stringToBytes('vault')],
              programId
            );
            const [whitelistPda] = PublicKey.findProgramAddressSync(
              [stringToBytes('whitelist')],
              programId
            );

            const userPk = new PublicKey(this.universalSigner.account.address);

            // pay-with-token gas abstraction is not supported on Solana
            if (execute.payGasWith !== undefined) {
              throw new Error('Pay-with token is not supported on Solana');
            }

            let txSignature: string;
            // SVM-specific RevertSettings: bytes must be a Buffer
            const revertSvm = {
              fundRecipient: userPk,
              revertMsg: Buffer.from([]),
            } as unknown as never;
            // New gateway expects EVM recipient as [u8; 20]
            const recipientEvm20: number[] = Array.from(
              Buffer.from(
                (execute.to as `0x${string}`).slice(2).padStart(40, '0'),
                'hex'
              ).subarray(0, 20)
            );
            if (execute.funds.token.mechanism === 'native') {
              // Native SOL funds-only
              // Compute a local whitelist PDA to avoid TS scope issues
              const [whitelistPdaLocal] = PublicKey.findProgramAddressSync(
                [stringToBytes('whitelist')],
                programId
              );
              txSignature = await svmClient.writeContract({
                abi: SVM_GATEWAY_IDL,
                address: programId.toBase58(),
                functionName: 'sendFunds', // -> unified sendFunds(recipient, bridge_token, bridge_amount, revert_cfg)
                args: [
                  recipientEvm20,
                  PublicKey.default,
                  bridgeAmount,
                  revertSvm,
                ],
                signer: this.universalSigner,
                accounts: {
                  config: configPda,
                  vault: vaultPda,
                  user: userPk,
                  tokenWhitelist: whitelistPdaLocal,
                  userTokenAccount: userPk,
                  gatewayTokenAccount: vaultPda,
                  bridgeToken: PublicKey.default,
                  tokenProgram: new PublicKey(
                    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
                  ),
                  systemProgram: SystemProgram.programId,
                },
              });
            } else if (execute.funds.token.mechanism === 'approve') {
              // SPL token funds-only (requires pre-existing ATAs)
              const mintPk = new PublicKey(execute.funds.token.address);
              // Associated Token Accounts
              const TOKEN_PROGRAM_ID = new PublicKey(
                'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
              );
              const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
                'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
              );
              const userAta = PublicKey.findProgramAddressSync(
                [
                  userPk.toBuffer(),
                  TOKEN_PROGRAM_ID.toBuffer(),
                  mintPk.toBuffer(),
                ],
                ASSOCIATED_TOKEN_PROGRAM_ID
              )[0];
              const vaultAta = PublicKey.findProgramAddressSync(
                [
                  vaultPda.toBuffer(),
                  TOKEN_PROGRAM_ID.toBuffer(),
                  mintPk.toBuffer(),
                ],
                ASSOCIATED_TOKEN_PROGRAM_ID
              )[0];

              txSignature = await svmClient.writeContract({
                abi: SVM_GATEWAY_IDL,
                address: programId.toBase58(),
                functionName: 'sendFunds',
                args: [recipientEvm20, mintPk, bridgeAmount, revertSvm],
                signer: this.universalSigner,
                accounts: {
                  config: configPda,
                  vault: vaultPda,
                  tokenWhitelist: whitelistPda,
                  userTokenAccount: userAta,
                  gatewayTokenAccount: vaultAta,
                  user: userPk,
                  bridgeToken: mintPk,
                  tokenProgram: TOKEN_PROGRAM_ID,
                  systemProgram: SystemProgram.programId,
                },
              });
            } else {
              throw new Error('Unsupported token mechanism on Solana');
            }

            this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_03);
            this.executeProgressHook(
              PROGRESS_HOOK.SEND_TX_06_02,
              txSignature,
              bridgeAmount,
              execute.funds.token.decimals,
              symbol
            );

            await svmClient.waitForConfirmations({
              txSignature,
              confirmations: 25,
              timeoutMs: 300000,
            });
            // After origin confirmations, query Push Chain for UniversalTx status (SVM)
            await this.queryUniversalTxStatusFromGatewayTx(
              undefined,
              undefined,
              txSignature,
              'sendFunds'
            );
            this.executeProgressHook(PROGRESS_HOOK.SEND_TX_06_06);

            // Build a minimal UniversalTxResponse for SVM origin
            const chainId = CHAIN_INFO[chain].chainId;
            const origin = `${VM_NAMESPACE[vm]}:${chainId}:${this.universalSigner.account.address}`;
            const universalTxResponse: UniversalTxResponse = {
              hash: txSignature,
              origin,
              blockNumber: BigInt(0),
              blockHash: '',
              transactionIndex: 0,
              chainId,
              from: this.universalSigner.account.address,
              to: '0x0000000000000000000000000000000000000000',
              nonce: 0,
              data: '0x',
              value: BigInt(0),
              gasLimit: BigInt(0),
              gasPrice: undefined,
              maxFeePerGas: undefined,
              maxPriorityFeePerGas: undefined,
              accessList: [],
              wait: async () => ({
                hash: txSignature,
                blockNumber: BigInt(0),
                blockHash: '',
                transactionIndex: 0,
                from: this.universalSigner.account.address,
                to: '0x0000000000000000000000000000000000000000',
                contractAddress: null,
                gasPrice: BigInt(0),
                gasUsed: BigInt(0),
                cumulativeGasUsed: BigInt(0),
                logs: [],
                logsBloom: '0x',
                status: 1,
                raw: {
                  from: this.universalSigner.account.address,
                  to: '0x0000000000000000000000000000000000000000',
                },
              }),
              type: '99',
              typeVerbose: 'universal',
              signature: { r: '0x0', s: '0x0', v: 0 },
              raw: {
                from: this.universalSigner.account.address,
                to: '0x0000000000000000000000000000000000000000',
                nonce: 0,
                data: '0x',
                value: BigInt(0),
              },
            };
            return universalTxResponse;
          }
        } else {
          // Bridge funds + execute payload. Support:
          // - EVM (Sepolia): ERC-20 approve path + native gas via msg.value
          // - SVM (Solana Devnet): SPL or native SOL with gas_amount
          const { chain, evmClient, gatewayAddress } =
            this.getOriginGatewayContext();

          this.executeProgressHook(PROGRESS_HOOK.SEND_TX_01, chain);

          // Default token to native ETH if none provided
          if (!execute.funds.token) {
            const available: MoveableToken[] =
              (MOVEABLE_TOKENS[chain] as MoveableToken[] | undefined) || [];
            const vm = CHAIN_INFO[chain].vm;
            const preferredSymbol =
              vm === VM.EVM ? 'ETH' : vm === VM.SVM ? 'SOL' : undefined;
            const nativeToken = preferredSymbol
              ? available.find((t) => t.symbol === preferredSymbol)
              : undefined;
            if (!nativeToken) {
              throw new Error('Native token not configured for this chain');
            }
            execute.funds.token = nativeToken;
          }

          const mechanism = execute.funds.token.mechanism;

          const { deployed, nonce } = await this.getUeaStatusAndNonce();
          const { payload: universalPayload } =
            await this.buildGatewayPayloadAndGas(execute, nonce);

          this.executeProgressHook(PROGRESS_HOOK.SEND_TX_02_01);

          // Compute required gas funding on Push Chain and current UEA balance
          const gasEstimate = execute.gasLimit || BigInt(1e7);
          const gasPrice = await this.pushClient.getGasPrice();
          const requiredGasFee = gasEstimate * gasPrice;
          const payloadValue = execute.value ?? BigInt(0);
          const requiredFunds = requiredGasFee + payloadValue;

          const ueaAddress = this.computeUEAOffchain();
          const [ueaBalance] = await Promise.all([
            this.pushClient.getBalance(ueaAddress),
          ]);

          // UEA resolved (address, deployment status, balance, nonce)
          this.executeProgressHook(
            PROGRESS_HOOK.SEND_TX_03_02,
            ueaAddress,
            deployed
          );

          // Determine USD to deposit via gateway (8 decimals) with caps: min=$1, max=$10
          const oneUsd = PushChain.utils.helpers.parseUnits('1', 8);
          const tenUsd = PushChain.utils.helpers.parseUnits('10', 8);
          const deficit =
            requiredFunds > ueaBalance ? requiredFunds - ueaBalance : BigInt(0);
          let depositUsd =
            deficit > BigInt(0) ? this.pushClient.pushToUSDC(deficit) : oneUsd;

          if (depositUsd < oneUsd) depositUsd = oneUsd;
          if (depositUsd > tenUsd)
            throw new Error(
              'Deposit value exceeds max $10 worth of native token'
            );

          this.executeProgressHook(PROGRESS_HOOK.SEND_TX_02_02, depositUsd);

          // If SVM, clamp depositUsd to on-chain Config caps
          if (CHAIN_INFO[chain].vm === VM.SVM) {
            const svmClient = new SvmClient({
              rpcUrls:
                this.rpcUrls[CHAIN.SOLANA_DEVNET] ||
                CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC,
            });
            const programId = new PublicKey(SVM_GATEWAY_IDL.address);
            const [configPda] = PublicKey.findProgramAddressSync(
              [stringToBytes('config')],
              programId
            );
            try {
              const cfg: any = await svmClient.readContract({
                abi: SVM_GATEWAY_IDL,
                address: SVM_GATEWAY_IDL.address,
                functionName: 'config',
                args: [configPda.toBase58()],
              });
              const minField =
                cfg.minCapUniversalTxUsd ?? cfg.min_cap_universal_tx_usd;
              const maxField =
                cfg.maxCapUniversalTxUsd ?? cfg.max_cap_universal_tx_usd;
              const minCapUsd = BigInt(minField.toString());
              const maxCapUsd = BigInt(maxField.toString());
              if (depositUsd < minCapUsd) depositUsd = minCapUsd;
              // Add 20% safety margin to avoid BelowMinCap due to price drift
              const withMargin = (minCapUsd * BigInt(12)) / BigInt(10);
              if (depositUsd < withMargin) depositUsd = withMargin;
              if (depositUsd > maxCapUsd) depositUsd = maxCapUsd;
            } catch {
              // best-effort; fallback to previous bounds if read fails
            }
          }

          // Convert USD(8) -> native units using pricing path
          const nativeTokenUsdPrice = await new PriceFetch(
            this.rpcUrls
          ).getPrice(chain); // 8 decimals
          const nativeDecimals = CHAIN_INFO[chain].vm === VM.SVM ? 9 : 18;
          const oneNativeUnit = PushChain.utils.helpers.parseUnits(
            '1',
            nativeDecimals
          );
          // Ceil division to avoid rounding below min USD on-chain
          let nativeAmount =
            (depositUsd * oneNativeUnit + (nativeTokenUsdPrice - BigInt(1))) /
            nativeTokenUsdPrice;
          // Add 1 unit safety to avoid BelowMinCap from rounding differences
          nativeAmount = nativeAmount + BigInt(1);

          const revertCFG = {
            fundRecipient: this.universalSigner.account
              .address as `0x${string}`,
            revertMsg: '0x',
          } as unknown as never;

          const bridgeAmount = execute.funds.amount;
          const symbol = execute.funds.token.symbol;

          // Funds Flow: Preparing funds transfer
          this.executeProgressHook(
            PROGRESS_HOOK.SEND_TX_06_01,
            bridgeAmount,
            execute.funds.token.decimals,
            symbol
          );

          if (CHAIN_INFO[this.universalSigner.account.chain].vm === VM.EVM) {
            const tokenAddr = execute.funds.token.address as `0x${string}`;
            if (mechanism !== 'approve') {
              throw new Error(
                'Only ERC-20 tokens are supported for funds+payload on EVM; native and permit2 are not supported yet'
              );
            }
            const evmClientEvm = evmClient as EvmClient;
            const gatewayAddressEvm = gatewayAddress as `0x${string}`;
            await this.ensureErc20Allowance(
              evmClientEvm,
              tokenAddr,
              gatewayAddressEvm,
              bridgeAmount
            );
          }

          let txHash: `0x${string}` | string;
          try {
            if (CHAIN_INFO[this.universalSigner.account.chain].vm === VM.EVM) {
              const tokenAddr = execute.funds.token.address as `0x${string}`;
              // Compute EIP-712 signature for the universal payload and hash to bytes32
              this.executeProgressHook(PROGRESS_HOOK.SEND_TX_03_01);
              const ueaAddress = this.computeUEAOffchain();
              this.executeProgressHook(
                PROGRESS_HOOK.SEND_TX_03_02,
                ueaAddress,
                deployed
              );

              this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_01);
              this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_02);
              const ueaVersion = await this.fetchUEAVersion();
              const eip712Signature = await this.signUniversalPayload(
                universalPayload,
                ueaAddress,
                ueaVersion
              );
              this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_03);
              const eip712SignatureHex =
                typeof eip712Signature === 'string'
                  ? (eip712Signature as `0x${string}`)
                  : (bytesToHex(eip712Signature) as `0x${string}`);
              const evmClientEvm = evmClient as EvmClient;
              const gatewayAddressEvm = gatewayAddress as `0x${string}`;
              // New behavior: if user provided a gasTokenAddress, pay gas in that token via Uniswap quote
              // Determine pay-with token address, min-out and slippage
              const payWith = execute.payGasWith;
              const gasTokenAddress = payWith?.token?.address as
                | `0x${string}`
                | undefined;

              if (gasTokenAddress) {
                if (chain !== CHAIN.ETHEREUM_SEPOLIA) {
                  throw new Error(
                    `Only ${PushChain.utils.chains.getChainName(
                      CHAIN.ETHEREUM_SEPOLIA
                    )} is supported for paying gas fees with ERC-20 tokens`
                  );
                }
                let amountOutMinETH =
                  payWith?.minAmountOut !== undefined
                    ? BigInt(payWith.minAmountOut)
                    : nativeAmount;

                const slippageBps = payWith?.slippageBps ?? 100;
                amountOutMinETH = BigInt(
                  PushChain.utils.conversion.slippageToMinAmount(
                    amountOutMinETH.toString(),
                    { slippageBps }
                  )
                );

                const { gasAmount } =
                  await this.calculateGasAmountFromAmountOutMinETH(
                    gasTokenAddress as `0x${string}`,
                    amountOutMinETH
                  );
                const deadline = BigInt(0);

                // Ensure caller has enough balance of the gas token to cover fees
                const ownerAddress = this.universalSigner.account
                  .address as `0x${string}`;
                const gasTokenBalance = await evmClientEvm.getErc20Balance({
                  tokenAddress: gasTokenAddress as `0x${string}`,
                  ownerAddress,
                });
                if (gasTokenBalance < gasAmount) {
                  const sym = payWith?.token?.symbol ?? 'gas token';
                  const decimals = payWith?.token?.decimals ?? 18;
                  const needFmt = PushChain.utils.helpers.formatUnits(
                    gasAmount,
                    decimals
                  );
                  const haveFmt = PushChain.utils.helpers.formatUnits(
                    gasTokenBalance,
                    decimals
                  );
                  throw new Error(
                    `Insufficient ${sym} balance to cover gas fees: need ${needFmt}, have ${haveFmt}`
                  );
                }

                // Approve gas token to gateway
                await this.ensureErc20Allowance(
                  evmClientEvm,
                  gasTokenAddress,
                  gatewayAddressEvm,
                  gasAmount
                );

                // Approve bridge token already done above; now call new gateway signature (nonpayable)
                txHash = await evmClientEvm.writeContract({
                  abi: UNIVERSAL_GATEWAY_V0 as unknown as Abi,
                  address: gatewayAddressEvm,
                  functionName: 'sendTxWithFunds',
                  args: [
                    tokenAddr,
                    bridgeAmount,
                    gasTokenAddress,
                    gasAmount,
                    amountOutMinETH,
                    deadline,
                    universalPayload,
                    revertCFG,
                    eip712SignatureHex,
                  ],
                  signer: this.universalSigner,
                });
              } else {
                // Existing native-ETH value path
                txHash = await evmClientEvm.writeContract({
                  abi: UNIVERSAL_GATEWAY_V0 as unknown as Abi,
                  address: gatewayAddressEvm,
                  functionName: 'sendTxWithFunds',
                  args: [
                    tokenAddr,
                    bridgeAmount,
                    universalPayload,
                    revertCFG,
                    eip712SignatureHex,
                  ],
                  signer: this.universalSigner,
                  value: nativeAmount,
                });
              }
            } else {
              // SVM funds+payload path
              const svmClient = new SvmClient({
                rpcUrls:
                  this.rpcUrls[CHAIN.SOLANA_DEVNET] ||
                  CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC,
              });
              const programId = new PublicKey(SVM_GATEWAY_IDL.address);
              const [configPda] = PublicKey.findProgramAddressSync(
                [stringToBytes('config')],
                programId
              );
              const [vaultPda] = PublicKey.findProgramAddressSync(
                [stringToBytes('vault')],
                programId
              );
              // whitelistPda already computed above
              const userPk = new PublicKey(
                this.universalSigner.account.address
              );
              const priceUpdatePk = new PublicKey(
                '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'
              );

              // pay-with-token gas abstraction is not supported on Solana
              if (execute.payGasWith !== undefined) {
                throw new Error('Pay-with token is not supported on Solana');
              }

              const isNative =
                mechanism === 'native' || execute.funds.token.symbol === 'SOL';
              const revertSvm2 = {
                fundRecipient: userPk,
                revertMsg: Buffer.from([]),
              } as unknown as never;
              // Compute signature for universal payload on SVM
              const ueaAddressSvm = this.computeUEAOffchain();
              const ueaVersion = await this.fetchUEAVersion();
              const svmSignature = await this.signUniversalPayload(
                universalPayload,
                ueaAddressSvm,
                ueaVersion
              );
              if (isNative) {
                // Native SOL as bridge + gas
                const [whitelistPdaLocal] = PublicKey.findProgramAddressSync(
                  [stringToBytes('whitelist')],
                  programId
                );
                txHash = await svmClient.writeContract({
                  abi: SVM_GATEWAY_IDL,
                  address: programId.toBase58(),
                  functionName: 'sendTxWithFunds',
                  args: [
                    PublicKey.default, // bridge_token = default for native SOL
                    bridgeAmount,
                    universalPayload,
                    revertSvm2,
                    nativeAmount,
                    Buffer.from(svmSignature),
                  ],
                  signer: this.universalSigner,
                  accounts: {
                    config: configPda,
                    vault: vaultPda,
                    tokenWhitelist: whitelistPdaLocal,
                    userTokenAccount: userPk, // for native SOL, can be any valid account
                    gatewayTokenAccount: vaultPda, // for native SOL, can be any valid account
                    user: userPk,
                    priceUpdate: priceUpdatePk,
                    bridgeToken: PublicKey.default,
                    tokenProgram: new PublicKey(
                      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
                    ),
                    systemProgram: SystemProgram.programId,
                  },
                });
              } else {
                // SPL token as bridge + native SOL lamports as gas_amount
                const mintPk = new PublicKey(execute.funds.token.address);
                const TOKEN_PROGRAM_ID = new PublicKey(
                  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
                );
                const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
                  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
                );
                const userAta = PublicKey.findProgramAddressSync(
                  [
                    userPk.toBuffer(),
                    TOKEN_PROGRAM_ID.toBuffer(),
                    mintPk.toBuffer(),
                  ],
                  ASSOCIATED_TOKEN_PROGRAM_ID
                )[0];
                const vaultAta = PublicKey.findProgramAddressSync(
                  [
                    vaultPda.toBuffer(),
                    TOKEN_PROGRAM_ID.toBuffer(),
                    mintPk.toBuffer(),
                  ],
                  ASSOCIATED_TOKEN_PROGRAM_ID
                )[0];

                const [whitelistPdaLocal] = PublicKey.findProgramAddressSync(
                  [stringToBytes('whitelist')],
                  programId
                );
                txHash = await svmClient.writeContract({
                  abi: SVM_GATEWAY_IDL,
                  address: programId.toBase58(),
                  functionName: 'sendTxWithFunds',
                  args: [
                    mintPk,
                    bridgeAmount,
                    universalPayload,
                    revertSvm2,
                    nativeAmount,
                    Buffer.from(svmSignature),
                  ],
                  signer: this.universalSigner,
                  accounts: {
                    config: configPda,
                    vault: vaultPda,
                    tokenWhitelist: whitelistPdaLocal,
                    userTokenAccount: userAta,
                    gatewayTokenAccount: vaultAta,
                    user: userPk,
                    priceUpdate: priceUpdatePk,
                    bridgeToken: mintPk,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                  },
                });
              }
            }
          } catch (err) {
            this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_04);
            throw err;
          }

          // Payload Flow: Verification Success
          this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_03);

          // Funds Flow: Funds lock submitted
          this.executeProgressHook(
            PROGRESS_HOOK.SEND_TX_06_02,
            txHash,
            bridgeAmount,
            execute.funds.token.decimals,
            symbol
          );

          // Awaiting confirmations
          if (CHAIN_INFO[this.universalSigner.account.chain].vm === VM.EVM) {
            const evmClientEvm = evmClient as EvmClient;
            await this.waitForEvmConfirmationsWithCountdown(
              evmClientEvm,
              txHash as `0x${string}`,
              4,
              300000
            );
          } else {
            const svmClient = new SvmClient({
              rpcUrls:
                this.rpcUrls[CHAIN.SOLANA_DEVNET] ||
                CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC,
            });
            await svmClient.waitForConfirmations({
              txSignature: txHash as string,
              confirmations: 25,
              timeoutMs: 300000,
            });
          }

          // Funds Flow: Confirmed on origin
          let feeLockTxHash = txHash;
          if (CHAIN_INFO[this.universalSigner.account.chain].vm === VM.SVM) {
            if (feeLockTxHash && !feeLockTxHash.startsWith('0x')) {
              // decode svm base58
              const decoded = utils.bytes.bs58.decode(feeLockTxHash);
              feeLockTxHash = bytesToHex(new Uint8Array(decoded));
            }
          }
          const txs = await this.sendUniversalTx(deployed, feeLockTxHash);

          this.executeProgressHook(PROGRESS_HOOK.SEND_TX_06_06);

          // After sending Cosmos tx to Push Chain, query UniversalTx status
          if (CHAIN_INFO[this.universalSigner.account.chain].vm === VM.EVM) {
            const evmClientEvm = evmClient as EvmClient;
            const gatewayAddressEvm = gatewayAddress as `0x${string}`;
            await this.queryUniversalTxStatusFromGatewayTx(
              evmClientEvm,
              gatewayAddressEvm,
              txHash as `0x${string}`,
              'sendTxWithFunds'
            );
          } else {
            await this.queryUniversalTxStatusFromGatewayTx(
              undefined,
              undefined,
              txHash as string,
              'sendTxWithFunds'
            );
          }

          if (CHAIN_INFO[this.universalSigner.account.chain].vm === VM.EVM) {
            const evmClientEvm = evmClient as EvmClient;
            const evmTx = await evmClientEvm.getTransaction(
              txHash as `0x${string}`
            );
            this.executeProgressHook(
              PROGRESS_HOOK.SEND_TX_06_07,
              bridgeAmount,
              execute.funds.token.decimals,
              symbol
            );
            return await this.transformToUniversalTxResponse(evmTx);
          } else {
            return txs[txs.length - 1];
          }
        }
      }

      // Set default value for value if undefined
      if (execute.value === undefined) {
        execute.value = BigInt(0);
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
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_03_02, UEA, isUEADeployed);
      /**
       * Compute Universal Payload Hash
       */
      let feeLockTxHash: string | undefined = execute.feeLockTxHash;
      if (feeLockTxHash && !feeLockTxHash.startsWith('0x')) {
        // decode svm base58
        const decoded = utils.bytes.bs58.decode(feeLockTxHash);
        feeLockTxHash = bytesToHex(new Uint8Array(decoded));
      }
      // Fee locking is required if UEA is not deployed OR insufficient funds
      const feeLockingRequired =
        (!isUEADeployed || funds < requiredFunds) && !feeLockTxHash;

      // Support multicall payload encoding when execute.data is an array
      let payloadData: `0x${string}`;
      if (Array.isArray(execute.data)) {
        // Gate multicall to supported testnets
        const allowedChains = [
          CHAIN.ETHEREUM_SEPOLIA,
          CHAIN.ARBITRUM_SEPOLIA,
          CHAIN.BASE_SEPOLIA,
          CHAIN.SOLANA_DEVNET,
          CHAIN.BNB_TESTNET,
        ];
        if (!allowedChains.includes(this.universalSigner.account.chain)) {
          throw new Error(
            'Multicall is only enabled for Ethereum Sepolia, Arbitrum Sepolia, Base Sepolia, and Solana Devnet'
          );
        }

        // For multicall, `to` must be the executor account (UEA) of the sender
        // i.e., PushChain.universal.account
        const expectedUea = this.computeUEAOffchain();
        const toAddr = getAddress(execute.to as `0x${string}`);
        if (toAddr !== getAddress(expectedUea)) {
          throw new Error(
            'Multicall requires `to` to be the executor account (UEA) of the sender.'
          );
        }

        // Normalize and validate calls
        const normalizedCalls = execute.data.map((c) => ({
          to: getAddress(c.to as `0x${string}`),
          value: c.value,
          data: c.data as `0x${string}`,
        }));

        // bytes4(keccak256("UEA_MULTICALL")) selector, e.g., 0x4e2d2ff6-like prefix
        const selector = keccak256(toBytes('UEA_MULTICALL')).slice(
          0,
          10
        ) as `0x${string}`;

        // abi.encode(Call[]), where Call = { address to; uint256 value; bytes data; }
        const encodedCalls = encodeAbiParameters(
          [
            {
              type: 'tuple[]',
              components: [
                { name: 'to', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'data', type: 'bytes' },
              ],
            },
          ],
          [normalizedCalls]
        );

        // Concatenate prefix selector with encodedCalls without 0x
        payloadData = (selector + encodedCalls.slice(2)) as `0x${string}`;
      } else {
        payloadData = (execute.data || '0x') as `0x${string}`;
      }

      // Determine payload `to` value. For multicall, `to` must be UEA, pass-through as-is.
      const payloadTo: `0x${string}` = execute.to as `0x${string}`;

      const universalPayload = JSON.parse(
        JSON.stringify(
          {
            to: payloadTo,
            value: execute.value,
            data: payloadData,
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
      const ueaVersion = await this.fetchUEAVersion();
      const executionHash = this.computeExecutionHash({
        verifyingContract: UEA,
        payload: universalPayload,
        version: ueaVersion,
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
          UEA,
          ueaVersion
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
      const errMessage =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
          ? err
          : (() => {
              try {
                return JSON.stringify(err);
              } catch {
                return 'Unknown error';
              }
            })();
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_99_02, errMessage);
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
    const { lockerContract, vm, defaultRPC } = CHAIN_INFO[chain];

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
        return new Uint8Array(utils.bytes.bs58.decode(txHash));
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
          ? bytesToHex(new Uint8Array(utils.bytes.bs58.decode(address)))
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

      // TODO: pchaind q uexecutor all-universal-tx  --node https://rpc-testnet-donut-node1.push.org/
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
    // For PushChain, multicall is not supported. Ensure data is hex string.
    if (Array.isArray(execute.data)) {
      throw new Error('Multicall is not supported on PushChain');
    }

    const txHash = await this.pushClient.sendTransaction({
      to: execute.to,
      data: (execute.data || '0x') as `0x${string}`,
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
              ? bytesToHex(new Uint8Array(utils.bytes.bs58.decode(address)))
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
      ownerKey = bytesToHex(new Uint8Array(utils.bytes.bs58.decode(address)));
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

  /**
   * Quotes exact-output on Uniswap V3 for EVM origin chains using QuoterV2.
   * Returns the minimum required input (amountIn) to receive the target amountOut.
   */
  public async _quoteExactOutput(
    amountOut: bigint,
    {
      from,
      to,
    }: {
      from: PayableToken | undefined;
      to: MoveableToken | undefined;
    }
  ): Promise<ConversionQuote> {
    const originChain = this.universalSigner.account.chain;
    if (
      originChain !== CHAIN.ETHEREUM_MAINNET &&
      originChain !== CHAIN.ETHEREUM_SEPOLIA
    ) {
      throw new Error(
        'Exact-output quoting is only supported on Ethereum Mainnet and Sepolia for now'
      );
    }

    if (!from) {
      throw new Error('from token is required');
    }
    if (!to) {
      throw new Error('to token is required');
    }

    const rpcUrls =
      this.getRpcUrls()[originChain] || CHAIN_INFO[originChain].defaultRPC;
    const evm = new EvmClient({ rpcUrls });

    const factoryFromConfig = CHAIN_INFO[originChain].dex?.uniV3Factory;
    const quoterFromConfig = CHAIN_INFO[originChain].dex?.uniV3QuoterV2;
    if (!factoryFromConfig || !quoterFromConfig) {
      throw new Error('Uniswap V3 addresses not configured for this chain');
    }
    const UNISWAP_V3_FACTORY = factoryFromConfig as `0x${string}`;
    const UNISWAP_V3_QUOTER_V2 = quoterFromConfig as `0x${string}`;

    const factoryAbi: Abi = parseAbi([
      'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)',
    ]);
    const quoterAbi: Abi = parseAbi([
      'function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
    ]);
    const poolAbi: Abi = parseAbi([
      'function liquidity() view returns (uint128)',
    ]);

    const feeTiers: number[] = [100, 500, 3000, 10000];

    let bestAmountIn: bigint | null = null;
    let bestFee: number | null = null;

    for (const fee of feeTiers) {
      // Find pool address for this fee tier
      const poolAddress = await evm.readContract<string>({
        abi: factoryAbi,
        address: UNISWAP_V3_FACTORY,
        functionName: 'getPool',
        args: [from.address as `0x${string}`, to.address as `0x${string}`, fee],
      });

      const isZero =
        !poolAddress ||
        poolAddress.toLowerCase() ===
          '0x0000000000000000000000000000000000000000';
      if (isZero) continue;

      // Skip uninitialized/empty pools to avoid Quoter reverts
      try {
        const liquidity = await evm.readContract<bigint>({
          abi: poolAbi,
          address: poolAddress as `0x${string}`,
          functionName: 'liquidity',
          args: [],
        });
        if (!liquidity || liquidity === BigInt(0)) continue;
      } catch {
        continue;
      }

      // Quote exact output single for this fee tier
      try {
        const result = await evm.readContract<[bigint, bigint, number, bigint]>(
          {
            abi: quoterAbi,
            address: UNISWAP_V3_QUOTER_V2,
            functionName: 'quoteExactOutputSingle',
            args: [
              {
                tokenIn: from.address as `0x${string}`,
                tokenOut: to.address as `0x${string}`,
                amount: amountOut,
                fee,
                sqrtPriceLimitX96: BigInt(0),
              },
            ],
          }
        );
        const amountIn = result?.[0] ?? BigInt(0);
        if (amountIn === BigInt(0)) continue;
        if (bestAmountIn === null || amountIn < bestAmountIn) {
          bestAmountIn = amountIn;
          bestFee = fee;
        }
      } catch {
        // try next fee
      }
    }

    if (bestAmountIn === null || bestFee === null) {
      throw new Error(
        'No direct Uniswap V3 pool found for the given token pair on common fee tiers'
      );
    }

    const amountInBig = BigInt(bestAmountIn);
    const amountInHuman = parseFloat(
      PushChain.utils.helpers.formatUnits(amountInBig, {
        decimals: from.decimals,
      })
    );
    const amountOutHuman = parseFloat(
      PushChain.utils.helpers.formatUnits(amountOut, { decimals: to.decimals })
    );
    const rate = amountInHuman > 0 ? amountOutHuman / amountInHuman : 0;

    return {
      amountIn: bestAmountIn.toString(),
      amountOut: amountOut.toString(),
      rate,
      route: [from.symbol, to.symbol],
      timestamp: Date.now(),
    };
  }

  private async ensureErc20Allowance(
    evmClient: EvmClient,
    tokenAddress: `0x${string}`,
    spender: `0x${string}`,
    requiredAmount: bigint
  ): Promise<void> {
    const chain = this.universalSigner.account.chain;
    const owner = this.universalSigner.account.address as `0x${string}`;

    const currentAllowance = await evmClient.readContract<bigint>({
      abi: ERC20_EVM as Abi,
      address: tokenAddress,
      functionName: 'allowance',
      args: [owner, spender],
    });

    if (currentAllowance >= requiredAmount) return;

    // Some ERC-20s like USDT require setting allowance to 0 before changing
    // an existing non-zero allowance to a different non-zero value.
    if (currentAllowance > BigInt(0)) {
      this.printLog(
        `Resetting existing allowance from ${currentAllowance.toString()} to 0 for spender ${spender}`
      );
      const resetTxHash = await evmClient.writeContract({
        abi: ERC20_EVM as Abi,
        address: tokenAddress,
        functionName: 'approve',
        args: [spender, BigInt(0)],
        signer: this.universalSigner,
      });
      await evmClient.waitForConfirmations({
        txHash: resetTxHash,
        confirmations: 1,
        timeoutMs: CHAIN_INFO[chain].timeout,
      });
    }

    const setTxHash = await evmClient.writeContract({
      abi: ERC20_EVM as Abi,
      address: tokenAddress,
      functionName: 'approve',
      args: [spender, requiredAmount],
      signer: this.universalSigner,
    });

    await evmClient.waitForConfirmations({
      txHash: setTxHash,
      confirmations: 1,
      timeoutMs: CHAIN_INFO[chain].timeout,
    });

    try {
      const updated = await evmClient.readContract<bigint>({
        abi: ERC20_EVM as Abi,
        address: tokenAddress,
        functionName: 'allowance',
        args: [owner, spender],
      });
      if (updated < requiredAmount) {
        this.printLog('Warning: allowance not updated yet; proceeding');
      }
    } catch {
      // ignore
    }
  }

  /**
   * Ensures we're on Sepolia, returns EVM client and gateway address.
   */
  private getOriginGatewayContext(): {
    chain: CHAIN;
    evmClient?: EvmClient;
    gatewayAddress?: `0x${string}`;
  } {
    const chain = this.universalSigner.account.chain;
    if (
      chain !== CHAIN.ETHEREUM_SEPOLIA &&
      chain !== CHAIN.ARBITRUM_SEPOLIA &&
      chain !== CHAIN.BASE_SEPOLIA &&
      chain !== CHAIN.BNB_TESTNET &&
      chain !== CHAIN.SOLANA_DEVNET
    ) {
      throw new Error(
        'Funds + payload bridging is only supported on Ethereum Sepolia, Arbitrum Sepolia, Base Sepolia, BNB Testnet, and Solana Devnet for now'
      );
    }

    // For EVM (Sepolia), return client and gateway address. For SVM (Solana Devnet), only chain is needed here.
    if (CHAIN_INFO[chain].vm === VM.EVM) {
      const { defaultRPC, lockerContract } = CHAIN_INFO[chain];
      const rpcUrls: string[] = this.rpcUrls[chain] || defaultRPC;
      const evmClient = new EvmClient({ rpcUrls });
      const gatewayAddress = lockerContract as `0x${string}`;
      if (!gatewayAddress) {
        throw new Error('Universal Gateway address not configured');
      }
      return { chain, evmClient, gatewayAddress };
    }

    // SVM path (Solana Devnet) does not require evmClient/gatewayAddress
    return { chain };
  }

  /**
   * Computes UEA and fetches its nonce if deployed; returns 0 otherwise.
   */
  private async getUeaNonceForExecution(): Promise<bigint> {
    const UEA = this.computeUEAOffchain();
    const [code] = await Promise.all([
      this.pushClient.publicClient.getCode({ address: UEA }),
    ]);
    return code !== undefined ? await this.getUEANonce(UEA) : BigInt(0);
  }

  /**
   * Returns UEA deployment status and nonce (0 if not deployed).
   */
  private async getUeaStatusAndNonce(): Promise<{
    deployed: boolean;
    nonce: bigint;
  }> {
    const UEA = this.computeUEAOffchain();
    const [code] = await Promise.all([
      this.pushClient.publicClient.getCode({ address: UEA }),
    ]);
    const deployed = code !== undefined;
    const nonce = deployed ? await this.getUEANonce(UEA) : BigInt(0);
    return { deployed, nonce };
  }

  /**
   * Builds UniversalPayload for the gateway and computes the native gas deposit.
   */
  private async buildGatewayPayloadAndGas(
    execute: ExecuteParams,
    nonce: bigint
  ): Promise<{ payload: never; gasAmount: bigint }> {
    const gasEstimate = execute.gasLimit || BigInt(1e7);
    const payloadValue = execute.value ?? BigInt(0);
    const gasAmount = execute.value ?? BigInt(0);

    const universalPayload = {
      to: execute.to,
      value: payloadValue,
      data: execute.data || '0x',
      gasLimit: gasEstimate,
      maxFeePerGas: execute.maxFeePerGas || BigInt(1e10),
      maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(0),
      nonce,
      deadline: execute.deadline || BigInt(9999999999),
      vType: VerificationType.signedVerification,
    } as unknown as never;

    return { payload: universalPayload, gasAmount };
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

  // Derive the SVM gateway log index from a Solana transaction's log messages
  private getSvmGatewayLogIndexFromTx(txResp: any): number {
    const logs: string[] = (txResp?.meta?.logMessages || []) as string[];
    if (!Array.isArray(logs) || logs.length === 0) return 0;

    const prefix = 'Program data: ';
    for (let i = 0; i < logs.length; i++) {
      const log = logs[i] || '';
      if (!log.startsWith(prefix)) continue;

      const base64Data = log.slice(prefix.length).trim();
      let decoded: Uint8Array | null = null;
      try {
        decoded = new Uint8Array(Buffer.from(base64Data, 'base64'));
      } catch {
        continue;
      }

      if (!decoded || decoded.length < 8) continue;
      const discriminatorHex = bytesToHex(decoded.slice(0, 8)).slice(2);

      // Skip add_funds discriminator; return the first other Program data event
      if (discriminatorHex === '7f1f6cffbb134644') continue;
      return i;
    }

    // Fallback to first log
    return 0;
  }

  // Query Push Chain for UniversalTx status given an origin gateway tx (EVM or SVM)
  private async queryUniversalTxStatusFromGatewayTx(
    evmClient: EvmClient | undefined,
    gatewayAddress: `0x${string}` | undefined,
    txHash: string,
    fromBranch: 'sendFunds' | 'sendTxWithFunds'
  ): Promise<any | undefined> {
    try {
      const chain = this.universalSigner.account.chain;
      const { vm } = CHAIN_INFO[chain];

      let logIndexStr = '0';
      let txHashHex: `0x${string}` | string = txHash;

      if (vm === VM.EVM) {
        if (!evmClient || !gatewayAddress)
          throw new Error('Missing EVM context');
        const receipt = await evmClient.publicClient.getTransactionReceipt({
          hash: txHash as `0x${string}`,
        });
        const gatewayLogs = (receipt.logs || []).filter(
          (l: any) =>
            (l.address || '').toLowerCase() === gatewayAddress.toLowerCase()
        );
        const logIndexToUse = fromBranch === 'sendTxWithFunds' ? 1 : 0;
        const firstLog = (gatewayLogs[logIndexToUse] ||
          receipt.logs?.[logIndexToUse]) as any;
        const logIndexVal = firstLog?.logIndex ?? 0;
        logIndexStr =
          typeof logIndexVal === 'bigint'
            ? logIndexVal.toString()
            : String(logIndexVal);
      } else if (vm === VM.SVM) {
        // Normalize Solana signature to 0x-hex for ID composition
        let txSignature = txHash;
        if (!txHash.startsWith('0x')) {
          const decoded = utils.bytes.bs58.decode(txHash);
          txHashHex = bytesToHex(new Uint8Array(decoded));
        } else {
          // When provided as hex, convert to base58 for RPC
          const hex = txHash.slice(2);
          const bytes = Uint8Array.from(Buffer.from(hex, 'hex'));
          txSignature = utils.bytes.bs58.encode(bytes);
        }

        // Fetch transaction by initializing a Connection and calling Solana RPC
        const rpcUrls: string[] =
          this.rpcUrls[chain] || CHAIN_INFO[chain].defaultRPC;
        const connection = new Connection(rpcUrls[0], 'confirmed');
        const txResp = await connection.getTransaction(txSignature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
        } as any);
        // Derive proper log index using discriminator matching
        const svmLogIndex = this.getSvmGatewayLogIndexFromTx(txResp);
        logIndexStr = String(svmLogIndex);
      }

      const sourceChain = `${VM_NAMESPACE[vm]}:${CHAIN_INFO[chain].chainId}`;

      // ID = sha256("${sourceChain}:${txHash}:${logIndex}") as hex string (no 0x)
      const idInput = `${sourceChain}:${txHashHex}:${logIndexStr}`;
      const idHex = sha256(stringToBytes(idInput)).slice(2);

      // Fetch UniversalTx via gRPC with a brief retry window
      let universalTxObj: any | undefined;
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const universalTxResp = await this.pushClient.getUniversalTxById(
            idHex
          );
          universalTxObj = universalTxResp?.universalTx;
          if (universalTxObj) break;
        } catch (error) {
          // ignore and retry
          // console.log(error);
        }
        await new Promise((r) => setTimeout(r, 1500));
      }

      this.executeProgressHook(
        PROGRESS_HOOK.SEND_TX_06_06,
        universalTxObj?.universalStatus || universalTxObj?.universal_status
      );
      // this.printLog(
      //   `UniversalTx fetched via gRPC: ${JSON.stringify(
      //     {
      //       gatewayTx: txHashHex,
      //       id: idHex,
      //       status:
      //         universalTxObj?.universalStatus ||
      //         universalTxObj?.universal_status,
      //     },
      //     this.bigintReplacer,
      //     2
      //   )}`
      // );
      return universalTxObj;
    } catch {
      // Best-effort; do not fail flow if PC query is unavailable
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_06_06);
      return undefined;
    }
  }

  // Emit countdown updates while waiting for EVM confirmations
  private async waitForEvmConfirmationsWithCountdown(
    evmClient: EvmClient,
    txHash: `0x${string}`,
    confirmations: number,
    timeoutMs: number
  ): Promise<void> {
    // initial emit
    this.executeProgressHook(PROGRESS_HOOK.SEND_TX_06_03, confirmations);
    const start = Date.now();

    // Wait for receipt to get included block
    const receipt = await evmClient.publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    const targetBlock = receipt.blockNumber + BigInt(confirmations);

    // Poll blocks and emit remaining confirmations
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const currentBlock = await evmClient.publicClient.getBlockNumber();
      if (currentBlock >= targetBlock) return;

      const remaining = Number(targetBlock - currentBlock);
      const completed = Math.max(1, confirmations - remaining + 1);
      this.executeProgressHook(
        PROGRESS_HOOK.SEND_TX_06_04,
        completed,
        confirmations
      );

      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `Timeout: transaction ${txHash} not confirmed with ${confirmations} confirmations within ${timeoutMs} ms`
        );
      }

      await new Promise((r) => setTimeout(r, 12000));
    }
  }

  // Fetch and cache UEA version from the contract on Push Chain
  private async fetchUEAVersion(): Promise<string> {
    if (this.ueaVersionCache) return this.ueaVersionCache;
    const chain = this.universalSigner.account.chain;
    const { vm } = CHAIN_INFO[chain];
    const abi: Abi =
      vm === VM.EVM ? (UEA_EVM as unknown as Abi) : (UEA_SVM as unknown as Abi);
    const predictedUEA = this.computeUEAOffchain();
    // Only attempt to read VERSION if UEA is deployed; otherwise default to 0.1.0
    const code = await this.pushClient.publicClient.getCode({
      address: predictedUEA,
    });
    if (code === undefined) {
      this.ueaVersionCache = '0.1.0';
      return '0.1.0';
    }
    const version = await this.pushClient.readContract<string>({
      address: predictedUEA,
      abi,
      functionName: 'VERSION',
    });
    this.ueaVersionCache = version;
    return version;
  }

  // Build EVM gas payment parameters when paying gas with an ERC-20 token
  private async calculateGasAmountFromAmountOutMinETH(
    gasTokenAddress: `0x${string}`,
    amountOutMinETH: bigint | string
  ): Promise<{
    gasAmount: bigint;
  }> {
    const originChain = this.universalSigner.account.chain;
    if (
      originChain !== CHAIN.ETHEREUM_SEPOLIA &&
      originChain !== CHAIN.ARBITRUM_SEPOLIA &&
      originChain !== CHAIN.BASE_SEPOLIA
    ) {
      throw new Error(
        'Gas payment in ERC-20 is supported only on Ethereum Sepolia, Arbitrum Sepolia, and Base Sepolia for now'
      );
    }

    // Resolve WETH: prefer chain config, fallback to registry
    const WETH = CHAIN_INFO[originChain].dex?.weth;
    if (!WETH) throw new Error('WETH address not configured for this chain');

    let gasAmount: bigint;
    if (gasTokenAddress.toLowerCase() === WETH.toLowerCase()) {
      gasAmount = BigInt(amountOutMinETH);
    } else {
      // Resolve token objects from registries
      const fromList = PAYABLE_TOKENS[originChain] ?? [];
      const fromToken: PayableToken | undefined = fromList.find(
        (t) => (t.address || '').toLowerCase() === gasTokenAddress.toLowerCase()
      );
      const toList = (MOVEABLE_TOKENS[originChain] ?? []) as MoveableToken[];
      const toToken: MoveableToken | undefined = toList.find(
        (t) =>
          t.symbol === 'WETH' ||
          (t.address || '').toLowerCase() === (WETH || '').toLowerCase()
      );

      if (!fromToken || !toToken) {
        throw new Error('Token not supported for quoting');
      }

      const targetOut = BigInt(amountOutMinETH);
      const exactOutQuote = await this._quoteExactOutput(targetOut, {
        from: fromToken,
        to: toToken,
      });
      const requiredIn = BigInt(exactOutQuote.amountIn);
      gasAmount = (requiredIn * BigInt(101)) / BigInt(100); // 1% safety margin
    }

    return { gasAmount };
  }
}
