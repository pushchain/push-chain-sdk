/**
 * Unit coverage for SVM Route 3 payload/request construction.
 */
import { PushChain } from '../../push-chain/push-chain';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { MOVEABLE_TOKEN_CONSTANTS } from '../../constants/tokens';
import { UEA_MULTICALL_SELECTOR, ZERO_ADDRESS } from '../../constants/selectors';
import type { OrchestratorContext } from '../internals/context';
import { buildPayloadForRoute } from '../internals/route-handlers';
import type { ChainSource, UniversalExecuteParams, UniversalOutboundTxRequest } from '../orchestrator.types';
import { TransactionRoute } from '../route-detector';

const PUSH_EOA = '0xBa8F52487b31d3c212373da7C44bf855DeBf2283' as const;

function makeCtx(): OrchestratorContext {
  return {
    rpcUrls: {},
    printTraces: false,
    progressHook: () => undefined,
    pushClient: {} as never,
    universalSigner: {
      account: {
        address: PUSH_EOA,
        chain: CHAIN.PUSH_TESTNET_DONUT,
      },
    } as never,
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
    accountStatusCache: null,
  } as unknown as OrchestratorContext;
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const clean = hex.slice(2);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function extractSendToUeaArgs(svmPayload: `0x${string}`): {
  amount: bigint;
  payload: `0x${string}`;
} {
  const bytes = hexToBytes(svmPayload);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // encodeSvmExecutePayload layout:
  // u32 accounts_count BE, accounts, u32 ix_data_len BE, ix_data, u8 instruction_id, pubkey.
  const accountCount = view.getUint32(0, false);
  const ixLenOffset = 4 + accountCount * 33;
  const ixDataOffset = ixLenOffset + 4;

  // send_universal_tx_to_uea ix_data layout:
  // 8-byte discriminator, 32-byte token, u64 amount LE, u32 payload_len LE, payload, revert pubkey.
  const amountOffset = ixDataOffset + 8 + 32;
  const amount = view.getBigUint64(amountOffset, true);
  const payloadLenOffset = amountOffset + 8;
  const payloadLen = view.getUint32(payloadLenOffset, true);
  const payloadOffset = payloadLenOffset + 4;
  const payloadBytes = bytes.slice(payloadOffset, payloadOffset + payloadLen);

  return {
    amount,
    payload: `0x${Buffer.from(payloadBytes).toString('hex')}`,
  };
}

function extractSendToUeaPayload(svmPayload: `0x${string}`): `0x${string}` {
  return extractSendToUeaArgs(svmPayload).payload;
}

function decodeSvmInboundUniversalPayload(payload: `0x${string}`): {
  data: `0x${string}`;
  nonce: bigint;
} {
  const bytes = hexToBytes(payload);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataLenOffset = 20 + 8;
  const dataLen = view.getUint32(dataLenOffset, true);
  const dataOffset = dataLenOffset + 4;
  const data = bytes.slice(dataOffset, dataOffset + dataLen);
  const nonceOffset = dataOffset + dataLen + 8 + 8 + 8;
  const nonce = view.getBigUint64(nonceOffset, true);

  return {
    data: `0x${Buffer.from(data).toString('hex')}`,
    nonce,
  };
}

describe('buildPayloadForRoute — SVM Route 3', () => {
  it('keeps native SOL drains payload-only on Push while ixData carries the drain amount', async () => {
    const params: UniversalExecuteParams = {
      from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
      to: PUSH_EOA,
      value: BigInt(5_000_000),
    };

    const { payload, gatewayRequest } = await buildPayloadForRoute(
      makeCtx(),
      params,
      TransactionRoute.CEA_TO_PUSH,
      BigInt(0)
    );

    const outbound = gatewayRequest as UniversalOutboundTxRequest;
    const sendToUea = extractSendToUeaArgs(payload);

    expect(outbound.amount).toBe(BigInt(0));
    expect(sendToUea.amount).toBe(BigInt(5_000_000));
  });

  it('keeps SPL drains payload-only on Push while ixData carries the drain amount', async () => {
    const token = MOVEABLE_TOKEN_CONSTANTS.SOLANA_DEVNET.USDT;
    const expectedPrc20 = PushChain.utils.tokens.getPRC20Address(token).address;

    const params: UniversalExecuteParams = {
      from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
      to: PUSH_EOA,
      funds: {
        amount: BigInt(8_000),
        token,
      },
    };

    const { payload, gatewayRequest } = await buildPayloadForRoute(
      makeCtx(),
      params,
      TransactionRoute.CEA_TO_PUSH,
      BigInt(0)
    );

    const outbound = gatewayRequest as UniversalOutboundTxRequest;
    const sendToUea = extractSendToUeaArgs(payload);

    expect(outbound.token).toBe(expectedPrc20);
    expect(outbound.amount).toBe(BigInt(0));
    expect(sendToUea.amount).toBe(BigInt(8_000));
  });

  it('wraps array data in an inbound UniversalPayload carrying a Push multicall', async () => {
    const params: UniversalExecuteParams = {
      from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
      to: ZERO_ADDRESS,
      data: [
        { to: PUSH_EOA, value: BigInt(0), data: '0x12345678' },
      ],
    };

    const { payload, gatewayRequest } = await buildPayloadForRoute(
      makeCtx(),
      params,
      TransactionRoute.CEA_TO_PUSH,
      BigInt(0)
    );

    const outbound = gatewayRequest as UniversalOutboundTxRequest;
    const sendToUeaPayload = extractSendToUeaPayload(payload);
    const inboundPayload = decodeSvmInboundUniversalPayload(sendToUeaPayload);

    expect(outbound.amount).toBe(BigInt(0));
    expect(sendToUeaPayload).toMatch(/^0x[0-9a-f]+$/);
    expect(sendToUeaPayload.length).toBeGreaterThan(2);
    expect(inboundPayload.data.startsWith(UEA_MULTICALL_SELECTOR)).toBe(true);
    expect(inboundPayload.nonce).toBe(BigInt(1));
  });

  it('wraps single calldata in an inbound UniversalPayload instead of sending raw calldata', async () => {
    const params: UniversalExecuteParams = {
      from: { chain: CHAIN.SOLANA_DEVNET } as ChainSource,
      to: PUSH_EOA,
      value: BigInt(5_000),
      data: '0x12345678',
    };

    const { payload, gatewayRequest } = await buildPayloadForRoute(
      makeCtx(),
      params,
      TransactionRoute.CEA_TO_PUSH,
      BigInt(0)
    );

    const sendToUeaArgs = extractSendToUeaArgs(payload);
    const sendToUeaPayload = sendToUeaArgs.payload;
    const inboundPayload = decodeSvmInboundUniversalPayload(sendToUeaPayload);
    const outbound = gatewayRequest as UniversalOutboundTxRequest;

    expect(sendToUeaPayload.startsWith('0x12345678')).toBe(false);
    expect(outbound.amount).toBe(BigInt(0));
    expect(sendToUeaArgs.amount).toBe(BigInt(5_000));
    expect(inboundPayload.data.startsWith(UEA_MULTICALL_SELECTOR)).toBe(true);
    expect(inboundPayload.nonce).toBe(BigInt(1));
  });
});
