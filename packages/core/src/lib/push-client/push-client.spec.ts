import { PushClient } from './push-client';
import { CHAIN_INFO, PUSH_CHAIN_INFO, VM_NAMESPACE } from '../constants/chain';
import {
  MsgDeployUEA,
  MsgMintPC,
  MsgExecutePayload,
  VerificationType,
} from '../generated/v1/tx';
import { CHAIN, PUSH_NETWORK } from '../constants/enums';

describe('PushClient', () => {
  let client: PushClient;
  const MSG_DEPLOY_UEA: MsgDeployUEA = {
    signer: 'push1f5th78lzntc2h0krzqn5yldvwg43lcrgkqxtsv',
    universalAccountId: {
      chainNamespace: VM_NAMESPACE[CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].vm],
      chainId: CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].chainId,
      owner: '0x35B84d6848D16415177c64D64504663b998A6ab4',
    },
    txHash:
      '0x7faf47ef206f8aa356fe60a14d998cef6403ae8753948a5d8cddff7b23965be7',
  };

  const MSG_MINT_PC: MsgMintPC = {
    signer: 'push1f5th78lzntc2h0krzqn5yldvwg43lcrgkqxtsv',
    universalAccountId: {
      chainNamespace: VM_NAMESPACE[CHAIN_INFO[CHAIN.SOLANA_DEVNET].vm],
      chainId: CHAIN_INFO[CHAIN.SOLANA_DEVNET].chainId,
      owner:
        '0x30ea71869947818d27b718592ea44010b458903bd9bf0370f50eda79e87d9f69',
    },
    txHash: '0xbhcdfbjhv',
  };

  const MSG_EXECUTE_PAYLOAD: MsgExecutePayload = {
    signer: 'push1f5th78lzntc2h0krzqn5yldvwg43lcrgkqxtsv',
    universalAccountId: {
      chainNamespace: VM_NAMESPACE[CHAIN_INFO[CHAIN.SOLANA_DEVNET].vm],
      chainId: CHAIN_INFO[CHAIN.SOLANA_DEVNET].chainId,
      owner:
        '0x30ea71869947818d27b718592ea44010b458903bd9bf0370f50eda79e87d9f69',
    },
    universalPayload: {
      to: '0x527F3692F5C53CfA83F7689885995606F93b6164',
      value: '0',
      data: '0x2ba2ed980000000000000000000000000000000000000000000000000000000000000312',
      gasLimit: '21000000',
      maxFeePerGas: '1000000000',
      maxPriorityFeePerGas: '200000000',
      nonce: '1',
      deadline: '9999999999',
      vType: VerificationType.signedVerification,
    },
    signature:
      '0x911d4ee13db2ca041e52c0e77035e4c7c82705a77e59368740ef42edcdb813144aff65d2a3a6d03215f764a037a229170c69ffbaaad50fff690940a5ef458304',
  };

  beforeEach(() => {
    client = new PushClient({
      rpcUrls: PUSH_CHAIN_INFO[CHAIN.PUSH_TESTNET].defaultRPC,
      network: PUSH_NETWORK.TESTNET,
    });
  });

  describe('pushToUSDC', () => {
    it('converts 1 PUSH (1e18) to 0.1 USDC (1e7)', () => {
      const result = client.pushToUSDC(BigInt('1000000000000000000'));
      expect(result).toBe(BigInt(10000000));
    });

    it('returns 0 when input is 0', () => {
      expect(client.pushToUSDC(BigInt(0))).toBe(BigInt(0));
    });
  });

  describe('usdcToPush', () => {
    it('converts 0.1 USDC (1e7) to 1 PUSH (1e18)', () => {
      const result = client.usdcToPush(BigInt(10000000));
      expect(result).toBe(BigInt('1000000000000000000'));
    });

    it('returns 0 when input is 0', () => {
      expect(client.usdcToPush(BigInt(0))).toBe(BigInt(0));
    });
  });

  describe('PushClient Msg & Cosmos Tx Tests', () => {
    it('creates MsgDeployUEA', () => {
      const msg = client.createMsgDeployUEA(MSG_DEPLOY_UEA);
      expect(msg.typeUrl).toBe('/ue.v1.MsgDeployUEA');
      expect(msg.value.length).toBeGreaterThan(0);
    });

    it('creates MsgMintPC', () => {
      const msg = client.createMsgMintPC(MSG_MINT_PC);
      expect(msg.typeUrl).toBe('/ue.v1.MsgMintPC');
      expect(msg.value.length).toBeGreaterThan(0);
    });

    it('creates MsgExecutePayload', () => {
      const msg = client.createMsgExecutePayload(MSG_EXECUTE_PAYLOAD);
      expect(msg.typeUrl).toBe('/ue.v1.MsgExecutePayload');
      expect(msg.value.length).toBeGreaterThan(0);
    });

    it('creates TxBody from multiple messages', async () => {
      const msg1 = client.createMsgDeployUEA(MSG_DEPLOY_UEA);
      const msg2 = client.createMsgMintPC(MSG_MINT_PC);
      const txBody = await client.createCosmosTxBody([msg1, msg2], 'test memo');
      expect(txBody.messages.length).toBe(2);
      expect(txBody.memo).toBe('test memo');
    });

    it('signs tx', async () => {
      const msg1 = client.createMsgDeployUEA(MSG_DEPLOY_UEA);
      const msg2 = client.createMsgMintPC(MSG_MINT_PC);
      const msg3 = client.createMsgExecutePayload(MSG_EXECUTE_PAYLOAD);
      const txBody = await client.createCosmosTxBody([msg1, msg2, msg3]);
      await client.signCosmosTx(txBody);
    });

    it('get tx', async () => {
      const query =
        '0x7faf47ef206f8aa356fe60a14d998cef6403ae8753948a5d8cddff7b23965be7';
      const tx = await client.getCosmosTx(query);
      console.log(tx);
    });
  });
});
