import {
  createPublicClient,
  fallback,
  hexToBytes,
  http,
  keccak256,
  PublicClient,
  TransactionReceipt,
} from 'viem';
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
import { TxResponse } from '../vm-client/vm-client.types';
import { CHAIN_INFO, getPushViemChain, PUSH_CHAIN_INFO } from '../constants/chain';
import { CHAIN, PUSH_NETWORK } from '../constants/enums';

function pushNetworkToChain(
  network: PUSH_NETWORK
): CHAIN.PUSH_MAINNET | CHAIN.PUSH_TESTNET_DONUT | CHAIN.PUSH_LOCALNET {
  if (network === PUSH_NETWORK.MAINNET) return CHAIN.PUSH_MAINNET;
  if (
    network === PUSH_NETWORK.TESTNET_DONUT ||
    network === PUSH_NETWORK.TESTNET
  )
    return CHAIN.PUSH_TESTNET_DONUT;
  return CHAIN.PUSH_LOCALNET;
}

export class PushClient extends EvmClient {
  /** Gas limit for Cosmos transactions on Push Chain */
  private static readonly COSMOS_GAS_LIMIT = 100000000000;

  public pushChainInfo;
  private readonly ephemeralKey;
  private readonly ephemeralAccount;
  private currentRpcIndex = 0;

  /**
   * Archive (full-history) endpoints. History-sensitive reads fall back from
   * the prune RPC to these on a pruned-history miss. Resolved from the chain's
   * configured archive endpoints — empty/undefined for chains without one
   * (mainnet/localnet), where the fallback is a no-op (prune-only behaviour).
   */
  private readonly archiveTendermintRpc: string[];
  private readonly archivePublicClient?: PublicClient;

  constructor(clientOptions: PushClientOptions) {
    const pushChainKey = pushNetworkToChain(clientOptions.network);
    const chain = clientOptions.chain ?? getPushViemChain(pushChainKey);
    super({
      ...clientOptions,
      chain,
    });

    this.pushChainInfo = PUSH_CHAIN_INFO[pushChainKey];

    // Archive fallback is always set up; it's inert for chains without an
    // archive endpoint (mainnet/localnet → empty lists), and otherwise lets
    // history-sensitive reads recover a pruned tx from the archive node.
    this.archiveTendermintRpc = this.pushChainInfo.archiveTendermintRpc ?? [];
    const archiveEvmUrls = CHAIN_INFO[pushChainKey].archiveRPC ?? [];
    if (archiveEvmUrls.length > 0) {
      this.archivePublicClient = createPublicClient({
        chain,
        transport: fallback(
          archiveEvmUrls.map((url) =>
            http(url, { retryCount: 5, retryDelay: 500 })
          )
        ),
      });
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
    operationName = 'operation',
    rpcUrls: string[] = this.pushChainInfo.tendermintRpc,
    // Sticky cursor (`currentRpcIndex`) is only meaningful for the primary
    // prune pool; the archive pass passes `sticky=false` so a single archive
    // URL can't pin the prune cursor.
    sticky = true
  ): Promise<T> {
    let lastError: Error | null = null;

    // Cycle the RPC URLs, but also RETRY transient failures (5xx / network /
    // "HTTP request failed") with backoff — otherwise a single 502 on a
    // single-endpoint chain (e.g. Donut) aborts a tx mid status-poll. Total
    // attempts = urls × (RETRIES_PER_URL + 1).
    const RETRIES_PER_URL = 4;
    const totalAttempts = rpcUrls.length * (RETRIES_PER_URL + 1);

    const isTransient = (e: Error | null): boolean => {
      const m = `${e?.message ?? ''}`.toLowerCase();
      return (
        /\b(502|503|504|429)\b/.test(m) ||
        m.includes('http request failed') ||
        m.includes('server error') ||
        m.includes('timeout') ||
        m.includes('timed out') ||
        m.includes('econnreset') ||
        m.includes('socket hang up') ||
        m.includes('fetch failed')
      );
    };

    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      const baseIndex = sticky ? this.currentRpcIndex : 0;
      const rpcIndex = (baseIndex + attempt) % rpcUrls.length;
      const rpcUrl = rpcUrls[rpcIndex];

      try {
        const result = await operation(rpcUrl);
        if (sticky && rpcIndex !== this.currentRpcIndex) {
          this.currentRpcIndex = rpcIndex;
        }
        return result;
      } catch (error) {
        lastError = error as Error;
        if (attempt === totalAttempts - 1) {
          break;
        }
        // Non-transient errors: move to the next URL quickly. Transient ones:
        // back off (200ms → 400 → 800 …, capped) so a flaky RPC can recover.
        const cycle = Math.floor(attempt / rpcUrls.length);
        const delay = isTransient(lastError)
          ? Math.min(2000, 200 * 2 ** cycle)
          : 100;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error(
      `All RPC endpoints failed for ${operationName}. Last error: ${lastError?.message}`
    );
  }

  /**
   * Runs a history-sensitive Tendermint operation over the prune pool first and,
   * only when prune can't serve it (the op threw on all prune attempts, or
   * returned an `isEmpty` result), re-queries the archive pool. This is the
   * explicit "prune miss → archive" fallback the existing per-URL machinery
   * can't do on its own, because a pruned tx comes back as a *successful*
   * empty/not-found rather than a transport error.
   *
   * When no archive is configured (mainnet/localnet, or `enableArchiveFallback`
   * off) this is a pass-through: the original throw or empty result is returned
   * unchanged — behaviour identical to before.
   */
  private async executeWithArchiveFallback<T>(
    operation: (rpcUrl: string) => Promise<T>,
    operationName: string,
    isEmpty: (result: T) => boolean
  ): Promise<T> {
    let pruneResult: T | undefined;
    let pruneError: unknown;
    try {
      pruneResult = await this.executeWithRpcFallback(operation, operationName);
    } catch (error) {
      pruneError = error;
    }

    const pruneMissed =
      pruneError !== undefined ||
      (pruneResult !== undefined && isEmpty(pruneResult));

    if (!pruneMissed) {
      return pruneResult as T;
    }
    if (this.archiveTendermintRpc.length === 0) {
      // No archive: preserve original behaviour (re-throw, or return empty).
      if (pruneError !== undefined) throw pruneError;
      return pruneResult as T;
    }
    // Prune missed + archive available → re-query archive (non-sticky).
    return this.executeWithRpcFallback(
      operation,
      `${operationName} (archive)`,
      this.archiveTendermintRpc,
      false
    );
  }

  /** True when this client has a usable archive EVM endpoint configured. */
  private get hasArchiveEvm(): boolean {
    return this.archivePublicClient !== undefined;
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
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('NotFound') && !msg.includes('not found')) {
          console.warn(`[PushClient:signCosmosTx] Account lookup failed for ${sender}:`, err);
        }
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

      return TxRaw.fromPartial({
        bodyBytes: txBodyBytes,
        authInfoBytes,
        signatures: [hexToBytes(signature)],
      });
    }, 'signCosmosTx');
  }

  async broadcastCosmosTx(txRaw: TxRaw): Promise<DeliverTxResponse> {
    return this.executeWithRpcFallback(async (rpcUrl) => {
      const client = await StargateClient.connect(rpcUrl);
      return client.broadcastTx(TxRaw.encode(txRaw).finish());
    }, 'broadcastCosmosTx');
  }

  /**
   * Queries Push Chain's uexecutor gRPC service for a UniversalTx by its ID.
   */
  public async getUniversalTxById(
    id: string
  ): Promise<QueryGetUniversalTxResponse> {
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
      return QueryGetUniversalTxResponse.decode(responseBytes);
    }, 'getUniversalTxById');
  }

  /**
   * Queries Push Chain's uexecutor v2 gRPC service for a UniversalTx by its ID.
   * V2 returns expanded OutboundTx fields and repeated outbound_tx array.
   */
  public async getUniversalTxByIdV2(
    id: string
  ): Promise<QueryGetUniversalTxResponseV2> {
    const operation = async (rpcUrl: string) => {
      const tmClient = await Tendermint34Client.connect(rpcUrl);
      const queryClient = new QueryClient(tmClient);
      const rpc = createProtobufRpcClient(queryClient);

      const request = QueryGetUniversalTxRequestV2.fromPartial({ id });
      const responseBytes = await rpc.request(
        'uexecutor.v2.Query',
        'GetUniversalTx',
        QueryGetUniversalTxRequestV2.encode(request).finish()
      );
      return QueryGetUniversalTxResponseV2.decode(responseBytes);
    };
    // This is a current-STATE query (abci_query), so prune is always
    // authoritative — an empty `universalTx` is a real "doesn't exist", not a
    // pruned-history miss. Only fall back to archive on a hard error (all prune
    // attempts failed); never on an empty result (would double-load on polls).
    try {
      return await this.executeWithRpcFallback(operation, 'getUniversalTxByIdV2');
    } catch (error) {
      if (this.archiveTendermintRpc.length === 0) throw error;
      return this.executeWithRpcFallback(
        operation,
        'getUniversalTxByIdV2 (archive)',
        this.archiveTendermintRpc,
        false
      );
    }
  }

  /**
   * Generic Cosmos searchTx — returns the raw indexed results so callers can
   * walk events themselves. Used by the inbound-tracker to find a child UTX
   * created from an external tx hash (`universal_tx_created.inbound_tx_hash`).
   */
  public async searchCosmosByQuery(
    query: string
  ): Promise<DeliverTxResponse[]> {
    const operation = async (rpcUrl: string) => {
      const client = await StargateClient.connect(rpcUrl);
      const results = await client.searchTx(query);
      return results.map((result) =>
        JSON.parse(
          JSON.stringify(result, (_key, value) =>
            typeof value === 'bigint' ? value.toString() : value
          )
        )
      ) as DeliverTxResponse[];
    };
    // History-sensitive (tx_search): an empty result on prune may just mean the
    // matching tx is outside the prune window → retry archive.
    return this.executeWithArchiveFallback(
      operation,
      'searchCosmosByQuery',
      (results) => results.length === 0
    );
  }

  /**
   * Fetches a Cosmos transaction by its hash.
   * @param txHash The hex‐encoded transaction hash (without "0x" or with—both work).
   * @returns The indexed transaction (height, logs, events, etc.).
   * @throws If the tx isn't found.
   */
  public async getCosmosTx(txHash: string): Promise<DeliverTxResponse> {
    const operation = async (rpcUrl: string): Promise<DeliverTxResponse> => {
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
      return { ...convertedResults[0], transactionHash: txHash };
    };
    // History-sensitive (tx_search). The op throws on an empty result, so the
    // pruned-history miss surfaces as a thrown error — `isEmpty` stays false and
    // the wrapper retries archive via its caught-error path.
    return this.executeWithArchiveFallback(operation, 'getCosmosTx', () => false);
  }

  /**
   * EVM `getTransaction` with archive fallback. Prune first; on a not-found
   * (pruned, or not yet indexed) and an archive EVM endpoint configured, retry
   * the archive client. Without archive this is exactly `super.getTransaction`.
   */
  public override async getTransaction(
    txHash: `0x${string}`
  ): Promise<TxResponse> {
    try {
      return await super.getTransaction(txHash);
    } catch (error) {
      if (!this.hasArchiveEvm) throw error;
      const archiveClient = this.archivePublicClient as PublicClient;
      const tx = await archiveClient.getTransaction({ hash: txHash });
      const wait = async (confirmations = 1): Promise<TransactionReceipt> =>
        archiveClient.waitForTransactionReceipt({ hash: txHash, confirmations });
      return { ...tx, wait };
    }
  }

  /**
   * EVM `getTransactionReceipt` with archive fallback. Used by the inbound
   * tracker to fetch a Push-leg receipt that may predate the prune window.
   * Prune first; on not-found, retry the archive EVM client if configured.
   */
  public async getTransactionReceiptWithArchiveFallback(
    txHash: `0x${string}`
  ): Promise<TransactionReceipt> {
    try {
      return await this.publicClient.getTransactionReceipt({ hash: txHash });
    } catch (error) {
      if (!this.hasArchiveEvm) throw error;
      return (this.archivePublicClient as PublicClient).getTransactionReceipt({
        hash: txHash,
      });
    }
  }
}
