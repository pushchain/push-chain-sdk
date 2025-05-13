import {
  coins,
  StargateClient,
  QueryClient,
  setupAuthExtension,
} from '@cosmjs/stargate';
import { toBech32, toBase64 } from '@cosmjs/encoding';
import { Secp256k1 } from '@cosmjs/crypto';
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx';
import { SignDoc, TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { makeAuthInfoBytes, makeSignDoc } from '@cosmjs/proto-signing';
import { Tendermint34Client } from '@cosmjs/tendermint-rpc';
import { BaseAccount } from 'cosmjs-types/cosmos/auth/v1beta1/auth';
import { Writer } from 'protobufjs';
import { mnemonicToAccount } from 'viem/accounts';
import { hexToBytes, keccak256 } from 'viem';
import { Any } from 'cosmjs-types/google/protobuf/any';

describe('Push Chain Custom MsgSend Tx Test', () => {
  const rpc = 'http://localhost:26657';
  const prefix = 'push';
  const denom = 'npush';
  const chainId = 'localchain_9000-1';
  const gas = 200000;

  const mnemonic =
    'surface task term spring horse impact tortoise often session cable off catch harvest rain able jealous coral cargo portion surge spring genre mix avoid';

  it('bank.MsgSend tx', async () => {
    const ethAcc = mnemonicToAccount(mnemonic);
    const sender = toBech32(prefix, hexToBytes(ethAcc.address));
    const recipient = 'push1f5th78lzntc2h0krzqn5yldvwg43lcrgkqxtsv';
    const amount = coins(1000, denom);

    // Prepare Tx
    const msgSend: MsgSend = {
      fromAddress: sender,
      toAddress: recipient,
      amount,
    };

    const typeUrl = '/cosmos.bank.v1beta1.MsgSend';

    const msgAny: Any = {
      typeUrl,
      value: MsgSend.encode(MsgSend.fromPartial(msgSend)).finish(),
    };

    const txBodyBytes = TxBody.encode(
      TxBody.fromPartial({
        messages: [msgAny],
        memo: '',
      })
    ).finish();

    // ************************VERIFY ENCODING********************************
    const txBody = TxBody.decode(txBodyBytes);
    const firstMsg = txBody.messages[0];
    const msgDecoded = MsgSend.decode(firstMsg.value);
    expect(msgDecoded.fromAddress).toBe(msgSend.fromAddress);
    expect(msgDecoded.toAddress).toBe(msgSend.toAddress);
    expect(msgDecoded.amount[0].amount).toBe(msgSend.amount[0].amount);
    expect(msgDecoded.amount[0].denom).toBe(msgSend.amount[0].denom);
    // ***********************************************************************

    // Fetch account details
    const tmClient = await Tendermint34Client.connect(rpc);
    const queryClient = QueryClient.withExtensions(
      tmClient,
      setupAuthExtension
    );
    const accountResp = await queryClient.auth.account(sender);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const baseAccount = BaseAccount.decode(accountResp!.value);

    // Compress pubkey
    const uncompressedPubKey = hexToBytes(ethAcc.publicKey);
    const compressedPubKey = Secp256k1.compressPubkey(uncompressedPubKey);

    const pubkeyEncoded = {
      typeUrl: '/os.crypto.v1.ethsecp256k1.PubKey',
      value: Writer.create().uint32(10).bytes(compressedPubKey).finish(),
    };

    const authInfoBytes = makeAuthInfoBytes(
      [
        {
          pubkey: pubkeyEncoded,
          sequence: Number(baseAccount.sequence),
        },
      ],
      [],
      gas,
      undefined,
      undefined
    );

    // Sign
    const signDoc = makeSignDoc(
      txBodyBytes,
      authInfoBytes,
      chainId,
      Number(baseAccount.accountNumber)
    );
    const signDocBytes = SignDoc.encode(signDoc).finish();
    const digest = keccak256(signDocBytes);
    const sig = await ethAcc.sign({ hash: digest });

    const txRaw = TxRaw.fromPartial({
      bodyBytes: txBodyBytes,
      authInfoBytes,
      signatures: [hexToBytes(sig)],
    });

    console.log(toBase64(TxRaw.encode(txRaw).finish()));

    const client = await StargateClient.connect(rpc);
    const result = await client.broadcastTx(TxRaw.encode(txRaw).finish());
    console.log('✅ MsgSend Tx hash:', result.transactionHash);
  }, 20000);
});

/** CLI COMMANDS
 
TO GENERATE UNSIGNED TX
  pchaind tx bank send acc1 push1f5th78lzntc2h0krzqn5yldvwg43lcrgkqxtsv 1000npush \
  --generate-only --output json > unsigned.json

TO SIGN THE TX & GENERATE SIGNED TX ( VIA ACC 1 )
  pchaind tx sign unsigned.json \
  --from acc1 --chain-id localchain_9000-1 \
  --keyring-backend test \
  --output-document signed.json

TO ENCODE TX
  pchaind tx encode signed.json

TO DECODE TX
  pchaind tx decode base64EncodedString

 */
