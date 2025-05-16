import { getContractAddress, hexToBytes, keccak256, toBytes } from 'viem';
import {
  MsgDeployNMSC,
  MsgExecutePayload,
  MsgMintPush,
} from '../generated/v1/tx';
import { Any } from 'cosmjs-types/google/protobuf/any';
import { SignDoc, TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { Writer } from 'protobufjs';
import { makeAuthInfoBytes, makeSignDoc } from '@cosmjs/proto-signing';
import {
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
import { PushClientConfig as cfg } from './push-client.config';
import { PushClientOptions } from './push-client.types';

export class PushClient extends EvmClient {
  private tendermintRpcUrl: string;
  constructor(clientOptions: PushClientOptions) {
    super(clientOptions);
    this.tendermintRpcUrl = clientOptions.tendermintRpcUrl;
  }

  /**
   * Computes the CREATE2-derived smart wallet address on Push Chain.
   */
  async getNMSCAddress(caipAddress: string): Promise<`0x${string}`> {
    return getContractAddress({
      bytecode: cfg.scWalletBytecode,
      from: cfg.factoryAddress,
      opcode: 'CREATE2',
      salt: toBytes(caipAddress),
    });
  }

  /**
   * Converts nPUSH (1e18) to USDC (1e8), fixed rate: 1 PUSH = 0.1 USDC
   */
  pushToUSDC(amount: bigint): bigint {
    return (amount * cfg.pushToUsdcNumerator) / cfg.pushToUsdcDenominator;
  }

  /**
   * Converts USDC (1e8) to nPUSH (1e18), fixed rate: 1 PUSH = 0.1 USDC
   */
  usdcToPush(amount: bigint): bigint {
    return (amount * cfg.pushToUsdcDenominator) / cfg.pushToUsdcNumerator;
  }

  // --- Msg Creators ---

  createMsgDeployNMSC(input: MsgDeployNMSC): Any {
    return {
      typeUrl: '/crosschain.v1.MsgDeployNMSC',
      value: MsgDeployNMSC.encode(MsgDeployNMSC.fromPartial(input)).finish(),
    };
  }

  createMsgMintPush(input: MsgMintPush): Any {
    return {
      typeUrl: '/crosschain.v1.MsgMintPush',
      value: MsgMintPush.encode(MsgMintPush.fromPartial(input)).finish(),
    };
  }

  createMsgExecutePayload(input: MsgExecutePayload): Any {
    return {
      typeUrl: '/crosschain.v1.MsgExecutePayload',
      value: MsgExecutePayload.encode(
        MsgExecutePayload.fromPartial(input)
      ).finish(),
    };
  }

  // --- Tx Builder ---

  async createCosmosTxBody(messages: Any[], memo?: string): Promise<TxBody> {
    return TxBody.fromPartial({ messages, memo });
  }

  /**
   * Signs a Cosmos tx using a temporary account.
   * In prod, signer should be passed in instead.
   */
  async signCosmosTx(txBody: TxBody): Promise<TxRaw> {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const sender = toBech32(cfg.bech32Prefix, hexToBytes(account.address));

    // 🔍 Get on-chain account info
    const tmClient = await Tendermint34Client.connect(this.tendermintRpcUrl);
    const status = await tmClient.status();
    const chainId = status.nodeInfo.network;
    const queryClient = QueryClient.withExtensions(
      tmClient,
      setupAuthExtension
    );
    const accountResp = await queryClient.auth.account(sender);
    const baseAccount = BaseAccount.decode(accountResp!.value);

    // 📦 Encode pubkey
    const uncompressedPubKey = hexToBytes(account.publicKey);
    const compressedPubKey = Secp256k1.compressPubkey(uncompressedPubKey);
    const pubkeyEncoded = {
      typeUrl: '/os.crypto.v1.ethsecp256k1.PubKey',
      value: Writer.create().uint32(10).bytes(compressedPubKey).finish(),
    };

    const authInfoBytes = makeAuthInfoBytes(
      [{ pubkey: pubkeyEncoded, sequence: Number(baseAccount.sequence) }],
      [],
      200000, // gas
      undefined,
      undefined
    );

    const txBodyBytes = TxBody.encode(txBody).finish();
    const signDoc = makeSignDoc(
      txBodyBytes,
      authInfoBytes,
      chainId,
      Number(baseAccount.accountNumber)
    );

    const digest = keccak256(SignDoc.encode(signDoc).finish());
    const signature = await account.sign({ hash: digest });

    return TxRaw.fromPartial({
      bodyBytes: txBodyBytes,
      authInfoBytes,
      signatures: [hexToBytes(signature)],
    });
  }

  async broadcastCosmosTx(txRaw: TxRaw): Promise<string> {
    const client = await StargateClient.connect(this.tendermintRpcUrl);
    const result = await client.broadcastTx(TxRaw.encode(txRaw).finish());
    return result.transactionHash;
  }
}
