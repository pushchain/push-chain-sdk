import { hexToBytes, keccak256 } from 'viem';
import { rpcLog, rpcLogDone } from '../__debug_rpc_tracker';
import { MsgDeployUEA, MsgExecutePayload, MsgMintPC, MsgMigrateUEA } from '../generated/v1/tx';
import { Any } from 'cosmjs-types/google/protobuf/any';
import { SignDoc, TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { makeAuthInfoBytes, makeSignDoc } from '@cosmjs/proto-signing';
import {
  DeliverTxResponse,
  QueryClient,
  setupAuthExtension,
  StargateClient,
  createProtobufRpcClient,
} from '@cosmjs/stargate';
import {
  QueryGetUniversalTxRequest,
  QueryGetUniversalTxResponse,
} from '../generated/uexecutor/v1/query';
import {
  QueryGetUniversalTxRequestV2,
  QueryGetUniversalTxResponseV2,
} from '../generated/uexecutor/v2/query';
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
  /** Gas limit for Cosmos transactions on Push Chain */
  private static readonly COSMOS_GAS_LIMIT = 100000000000;

  public pushChainInfo;
  private readonly ephemeralKey;
  private readonly ephemeralAccount;
  private currentRpcIndex = 0;
  constructor(clientOptions: PushClientOptions) {
    super(clientOptions);

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

    this.ephemeralKey = generatePrivateKey();
    this.ephemeralAccount = privateKeyToAccount(this.ephemeralKey);
  }

  /**
   * Executes an operation with automatic fallback to next RPC endpoint on failure.
   * Follows the same pattern as SvmClient.executeWithFallback().
   */
  private async executeWithRpcFallback<T>(
    operation: (rpcUrl: string) => Promise<T>,
    operationName = 'operation'
  ): Promise<T> {
    const rpcUrls = this.pushChainInfo.tendermintRpc;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < rpcUrls.length; attempt++) {
      const rpcIndex = (this.currentRpcIndex + attempt) % rpcUrls.length;
      const rpcUrl = rpcUrls[rpcIndex];

      try {
        const result = await operation(rpcUrl);
        if (rpcIndex !== this.currentRpcIndex) {
          this.currentRpcIndex = rpcIndex;
        }
        return result;
      } catch (error) {
        lastError = error as Error;
        if (attempt === rpcUrls.length - 1) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    throw new Error(
      `All RPC endpoints failed for ${operationName}. Last error: ${lastError?.message}`
    );
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
      typeUrl: '/uexecutor.v1.MsgDeployUEA',
      value: MsgDeployUEA.encode(MsgDeployUEA.fromPartial(input)).finish(),
    };
  }

  createMsgMintPC(input: MsgMintPC): Any {
    return {
      typeUrl: '/uexecutor.v1.MsgMintPC',
      value: MsgMintPC.encode(MsgMintPC.fromPartial(input)).finish(),
    };
  }

  createMsgExecutePayload(input: MsgExecutePayload): Any {
    return {
      typeUrl: '/uexecutor.v1.MsgExecutePayload',
      value: MsgExecutePayload.encode(
        MsgExecutePayload.fromPartial(input)
      ).finish(),
    };
  }

  createMsgMigrateUEA(input: MsgMigrateUEA): Any {
    return {
      typeUrl: '/uexecutor.v1.MsgMigrateUEA',
      value: MsgMigrateUEA.encode(MsgMigrateUEA.fromPartial(input)).finish(),
    };
  }

  // --- Tx Builder ---

  async createCosmosTxBody(messages: Any[], memo?: string): Promise<TxBody> {
    return TxBody.fromPartial({ messages, memo });
  }

  // --- Tx Signer ---
  getSignerAddress() {
    return {
      evmAddress: this.ephemeralAccount.address,
      cosmosAddress: toBech32(
        this.pushChainInfo.prefix,
        hexToBytes(this.ephemeralAccount.address)
      ),
    };
  }

  /**
   * Signs a Cosmos tx using a temporary account.
   * In prod, signer should be passed in instead.
   */
  async signCosmosTx(txBody: TxBody): Promise<TxRaw> {
    const _id = rpcLog('PushClient', 'signCosmosTx', 'connect+status+account');
    const sender = toBech32(
      this.pushChainInfo.prefix,
      hexToBytes(this.ephemeralAccount.address)
    );

    return this.executeWithRpcFallback(async (rpcUrl) => {
      const tmClient = await Tendermint34Client.connect(rpcUrl);
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
        // Account may not exist on-chain yet; default to sequence=0 / accountNumber=0
        console.warn(`[PushClient:signCosmosTx] Account lookup failed for ${sender}, defaulting to sequence=0:`, err);
      }

      // 📦 Encode pubkey
      const uncompressedPubKey = hexToBytes(this.ephemeralAccount.publicKey);
      const compressedPubKey = Secp256k1.compressPubkey(uncompressedPubKey);
      // Manual protobuf encode: field 1 (tag=10), length-delimited bytes
      const keyLen = compressedPubKey.length;
      const pubkeyValue = new Uint8Array(2 + keyLen);
      pubkeyValue[0] = 10; // field 1, wire type 2 (length-delimited)
      pubkeyValue[1] = keyLen;
      pubkeyValue.set(compressedPubKey, 2);

      const pubkeyEncoded = {
        typeUrl: '/cosmos.evm.crypto.v1.ethsecp256k1.PubKey',
        value: pubkeyValue,
      };

      const authInfoBytes = makeAuthInfoBytes(
        [
          {
            pubkey: pubkeyEncoded,
            sequence: baseAccount ? Number(baseAccount.sequence) : 0,
          },
        ],
        [],
        PushClient.COSMOS_GAS_LIMIT,
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
      const signature = await this.ephemeralAccount.sign({ hash: digest });

      rpcLogDone(_id);
      return TxRaw.fromPartial({
        bodyBytes: txBodyBytes,
        authInfoBytes,
        signatures: [hexToBytes(signature)],
      });
    }, 'signCosmosTx');
  }

  async broadcastCosmosTx(txRaw: TxRaw): Promise<DeliverTxResponse> {
    const _id = rpcLog('PushClient', 'broadcastCosmosTx');
    return this.executeWithRpcFallback(async (rpcUrl) => {
      const client = await StargateClient.connect(rpcUrl);
      const result = await client.broadcastTx(TxRaw.encode(txRaw).finish());
      rpcLogDone(_id, `code=${result.code} hash=${result.transactionHash?.slice(0,14)}`);
      return result;
    }, 'broadcastCosmosTx');
  }

  /**
   * Queries Push Chain's uexecutor gRPC service for a UniversalTx by its ID.
   */
  public async getUniversalTxById(
    id: string
  ): Promise<QueryGetUniversalTxResponse> {
    const _id = rpcLog('PushClient', 'getUniversalTxById(v1)', `id=${id.slice(0,16)}..`);
    return this.executeWithRpcFallback(async (rpcUrl) => {
      const tmClient = await Tendermint34Client.connect(rpcUrl);
      const queryClient = new QueryClient(tmClient);
      const rpc = createProtobufRpcClient(queryClient);

      const request = QueryGetUniversalTxRequest.fromPartial({ id });
      const responseBytes = await rpc.request(
        'uexecutor.v1.Query',
        'GetUniversalTx',
        QueryGetUniversalTxRequest.encode(request).finish()
      );
      const response = QueryGetUniversalTxResponse.decode(responseBytes);
      rpcLogDone(_id, response.universalTx ? 'FOUND' : 'NOT_FOUND');
      return response;
    }, 'getUniversalTxById');
  }

  /**
   * Queries Push Chain's uexecutor v2 gRPC service for a UniversalTx by its ID.
   * V2 returns expanded OutboundTx fields and repeated outbound_tx array.
   */
  public async getUniversalTxByIdV2(
    id: string
  ): Promise<QueryGetUniversalTxResponseV2> {
    const _id = rpcLog('PushClient', 'getUniversalTxByIdV2', `id=${id.slice(0,16)}..`);
    return this.executeWithRpcFallback(async (rpcUrl) => {
      const tmClient = await Tendermint34Client.connect(rpcUrl);
      const queryClient = new QueryClient(tmClient);
      const rpc = createProtobufRpcClient(queryClient);

      const request = QueryGetUniversalTxRequestV2.fromPartial({ id });
      const responseBytes = await rpc.request(
        'uexecutor.v2.Query',
        'GetUniversalTx',
        QueryGetUniversalTxRequestV2.encode(request).finish()
      );
      const response = QueryGetUniversalTxResponseV2.decode(responseBytes);
      rpcLogDone(_id, response.universalTx ? 'FOUND' : 'NOT_FOUND');
      return response;
    }, 'getUniversalTxByIdV2');
  }

  /**
   * Fetches a Cosmos transaction by its hash.
   * @param txHash The hex‐encoded transaction hash (without "0x" or with—both work).
   * @returns The indexed transaction (height, logs, events, etc.).
   * @throws If the tx isn't found.
   */
  public async getCosmosTx(txHash: string): Promise<DeliverTxResponse> {
    const _id = rpcLog('PushClient', 'getCosmosTx', txHash.slice(0,14));
    return this.executeWithRpcFallback(async (rpcUrl) => {
      const client = await StargateClient.connect(rpcUrl);

      const query = `ethereum_tx.ethereumTxHash='${txHash}'`;

      const results = await client.searchTx(query);

      // Convert bigint values to strings in the results. This is done to avoid JSON.stringify()
      // from converting bigint to string when on the client side.
      // On documentation, one thing very common was to use JSON.stringify() to log the results, then we would get an error.
      const convertedResults = results.map((result) =>
        JSON.parse(
          JSON.stringify(result, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
          )
        )
      );

      if (convertedResults.length === 0) {
        throw new Error(`No Cosmos-indexed tx for EVM hash ${txHash}`);
      }
      rpcLogDone(_id);
      return { ...convertedResults[0], transactionHash: txHash };
    }, 'getCosmosTx');
  }
}
