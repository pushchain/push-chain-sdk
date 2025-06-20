import { hexToBytes, keccak256 } from 'viem';
import { MsgDeployUEA, MsgExecutePayload, MsgMintPC } from '../generated/v1/tx';
import { Any } from 'cosmjs-types/google/protobuf/any';
import { SignDoc, TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { Writer } from 'protobufjs';
import { makeAuthInfoBytes, makeSignDoc } from '@cosmjs/proto-signing';
import {
  DeliverTxResponse,
  QueryClient,
  setupAuthExtension,
  StargateClient,
} from '@cosmjs/stargate';
import { Secp256k1 } from '@cosmjs/crypto';
import { Tendermint34Client } from '@cosmjs/tendermint-rpc';
import { BaseAccount } from 'cosmjs-types/cosmos/auth/v1beta1/auth';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { toBech32 } from '@cosmjs/encoding';
import { EvmClient } from '../vm-client/evm-client';
import { PushClientOptions } from './push-client.types';
import { PUSH_CHAIN_INFO } from '../constants/chain';
import { CHAIN, PUSH_NETWORK } from '../constants/enums';

export class PushClient extends EvmClient {
  public pushChainInfo;
  // TODO: Check why this is needed.
  private readonly signerPrivateKey;
  constructor(clientOptions: PushClientOptions) {
    super(clientOptions);
    this.pushChainInfo =
      clientOptions.network === PUSH_NETWORK.MAINNET
        ? PUSH_CHAIN_INFO[CHAIN.PUSH_MAINNET]
        : clientOptions.network === PUSH_NETWORK.TESTNET_DONUT
        ? PUSH_CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT]
        : PUSH_CHAIN_INFO[CHAIN.PUSH_LOCALNET];

    if (clientOptions.network === PUSH_NETWORK.MAINNET) {
      this.pushChainInfo = PUSH_CHAIN_INFO[CHAIN.PUSH_MAINNET];
    } else if (
      clientOptions.network === PUSH_NETWORK.TESTNET_DONUT ||
      clientOptions.network === PUSH_NETWORK.TESTNET
    ) {
      this.pushChainInfo = PUSH_CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT];
    } else {
      this.pushChainInfo = PUSH_CHAIN_INFO[CHAIN.PUSH_LOCALNET];
    }

    this.signerPrivateKey = generatePrivateKey();
  }

  /**
   * Converts nPUSH (1e18) to USDC (1e8), fixed rate: 1 PUSH = 0.1 USDC
   */
  pushToUSDC(amount: bigint): bigint {
    return (
      (amount * this.pushChainInfo.pushToUsdcNumerator) /
      this.pushChainInfo.pushToUsdcDenominator
    );
  }

  /**
   * Converts USDC (1e8) to nPUSH (1e18), fixed rate: 1 PUSH = 0.1 USDC
   */
  usdcToPush(amount: bigint): bigint {
    return (
      (amount * this.pushChainInfo.pushToUsdcDenominator) /
      this.pushChainInfo.pushToUsdcNumerator
    );
  }

  // --- Msg Creators ---

  createMsgDeployUEA(input: MsgDeployUEA): Any {
    return {
      typeUrl: '/ue.v1.MsgDeployUEA',
      value: MsgDeployUEA.encode(MsgDeployUEA.fromPartial(input)).finish(),
    };
  }

  createMsgMintPC(input: MsgMintPC): Any {
    return {
      typeUrl: '/ue.v1.MsgMintPC',
      value: MsgMintPC.encode(MsgMintPC.fromPartial(input)).finish(),
    };
  }

  createMsgExecutePayload(input: MsgExecutePayload): Any {
    return {
      typeUrl: '/ue.v1.MsgExecutePayload',
      value: MsgExecutePayload.encode(
        MsgExecutePayload.fromPartial(input)
      ).finish(),
    };
  }

  // --- Tx Builder ---

  async createCosmosTxBody(messages: Any[], memo?: string): Promise<TxBody> {
    return TxBody.fromPartial({ messages, memo });
  }

  // --- Tx Signer ---
  getSignerAddress() {
    const account = privateKeyToAccount(this.signerPrivateKey);
    return {
      evmAddress: account.address,
      cosmosAddress: toBech32(
        this.pushChainInfo.prefix,
        hexToBytes(account.address)
      ),
    };
  }

  /**
   * Signs a Cosmos tx using a temporary account.
   * In prod, signer should be passed in instead.
   */
  async signCosmosTx(txBody: TxBody): Promise<TxRaw> {
    const account = privateKeyToAccount(this.signerPrivateKey);
    const sender = toBech32(
      this.pushChainInfo.prefix,
      hexToBytes(account.address)
    );

    // 🔍 Get on-chain account info
    const tmClient = await Tendermint34Client.connect(
      this.pushChainInfo.tendermintRpc
    );
    const status = await tmClient.status();
    const chainId = status.nodeInfo.network;

    const queryClient = QueryClient.withExtensions(
      tmClient,
      setupAuthExtension
    );
    let baseAccount: BaseAccount | null = null;
    try {
      const accountResp = await queryClient.auth.account(sender);
      baseAccount = BaseAccount.decode(accountResp!.value);
    } catch (err) {
      // Ignore
    }

    // 📦 Encode pubkey
    const uncompressedPubKey = hexToBytes(account.publicKey);
    const compressedPubKey = Secp256k1.compressPubkey(uncompressedPubKey);
    const pubkeyEncoded = {
      typeUrl: '/os.crypto.v1.ethsecp256k1.PubKey',
      value: Writer.create().uint32(10).bytes(compressedPubKey).finish(),
    };

    const authInfoBytes = makeAuthInfoBytes(
      [
        {
          pubkey: pubkeyEncoded,
          sequence: baseAccount ? Number(baseAccount.sequence) : 0,
        },
      ],
      [],
      100000000000, // gas
      undefined,
      undefined
    );

    const txBodyBytes = TxBody.encode(txBody).finish();
    const signDoc = makeSignDoc(
      txBodyBytes,
      authInfoBytes,
      chainId,
      baseAccount ? Number(baseAccount.accountNumber) : 0
    );

    const digest = keccak256(SignDoc.encode(signDoc).finish());
    const signature = await account.sign({ hash: digest });

    return TxRaw.fromPartial({
      bodyBytes: txBodyBytes,
      authInfoBytes,
      signatures: [hexToBytes(signature)],
    });
  }

  async broadcastCosmosTx(txRaw: TxRaw): Promise<DeliverTxResponse> {
    const client = await StargateClient.connect(
      this.pushChainInfo.tendermintRpc
    );
    const result = await client.broadcastTx(TxRaw.encode(txRaw).finish());
    return result;
  }

  /**
   * Fetches a Cosmos transaction by its hash.
   * @param txHash The hex‐encoded transaction hash (without “0x” or with—both work).
   * @returns The indexed transaction (height, logs, events, etc.).
   * @throws If the tx isn’t found.
   */
  public async getCosmosTx(txHash: string): Promise<DeliverTxResponse> {
    // 1. Connect to the Tendermint RPC
    const client = await StargateClient.connect(
      this.pushChainInfo.tendermintRpc
    );

    // Raw string query—must be one string, not a KV array:
    const query = `ethereum_tx.ethereumTxHash='${txHash}'`;

    const results = await client.searchTx(query);
    if (results.length === 0) {
      throw new Error(`No Cosmos-indexed tx for EVM hash ${txHash}`);
    }
    return { ...results[0], transactionHash: txHash };
  }
}
