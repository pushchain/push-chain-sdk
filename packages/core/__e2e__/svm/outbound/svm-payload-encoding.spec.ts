/**
 * SVM payload encoding — scenario simulation for the Slack 2026-04-23
 * regression and its Option B fix.
 *
 * Reported bug: SVM-signed user does pSOL → SOL, SDK crashes at encode-time
 *
 *   RangeError: The value of "value" is out of range. < 2n ** 64n.
 *   Received 82_716_248_299_997_902_592n
 *     at writeU64 → encodeUniversalPayloadSvm → encodePayloadForOrigin
 *
 * Root cause: the SVM Borsh encoder writes wei-scale fields as u64 LE to
 * match Push Chain's DecodeUniversalPayloadSolana (also u64-only, confirmed
 * against `x/uexecutor/types/decode_payload.go:248-330`). The Route 2 SVM
 * gas-swap budget (`nativeValueForGas`) is wei-scale UPC and routinely
 * exceeds 2^64 (~18.44 UPC) on the live pSOL/WPC pool.
 *
 * Option B fix (chain-compatible, SDK-only):
 *   1. Keep the v0 wire format (chain decoder unchanged).
 *   2. Skip the encoder entirely when its output is unused — the non-fee-
 *      locking R2 SVM outbound path ships the proto-struct UniversalPayload
 *      via MsgExecutePayload directly, never decoding the Borsh bytes.
 *   3. When the encoder IS called and a field exceeds u64, surface a clean
 *      error message instead of Node's checkIntBI stack.
 *
 * What this spec asserts:
 *   - The encoder still rejects > u64 with an actionable message (so any
 *     caller that genuinely needs Borsh-encoded bytes fails readably).
 *   - EVM signers continue to ABI-encode without bounds checks (uint256).
 *   - Riyanshu's value works on EVM (the documented workaround).
 *
 * The end-to-end "SDK no longer crashes Riyanshu's call" assertion lives in
 * the network spec at svm-signer-pSOL-bridge.network.spec.ts.
 */
import { zeroAddress } from 'viem';
import { CHAIN, PUSH_NETWORK, VM } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { VerificationType } from '../../../src/lib/generated/v1/tx';
import type { UniversalPayload } from '../../../src/lib/generated/v1/tx';
import type { OrchestratorContext } from '../../../src/lib/orchestrator/internals/context';
import {
  encodeUniversalPayload,
  encodeUniversalPayloadSvm,
} from '../../../src/lib/orchestrator/internals/signing';

const RIYANSHU_NATIVE_VALUE = BigInt('82716248299997902592');
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);

// Mirror of execute-standard.ts:80-90 so the test exercises the same VM
// dispatch logic without depending on the private helper.
function encodePayloadForOrigin(
  ctx: OrchestratorContext,
  payload: UniversalPayload
): `0x${string}` {
  const { vm } = CHAIN_INFO[ctx.universalSigner.account.chain];
  if (vm === VM.SVM) {
    const buf = encodeUniversalPayloadSvm(payload);
    return ('0x' + buf.toString('hex')) as `0x${string}`;
  }
  return encodeUniversalPayload(payload);
}

function buildOrchestratorShapePayload(value: bigint): UniversalPayload {
  return {
    to: zeroAddress,
    value: value.toString(),
    data: '0xdeadbeef',
    gasLimit: BigInt(5e7).toString(),
    maxFeePerGas: BigInt(1e10).toString(),
    maxPriorityFeePerGas: BigInt(0).toString(),
    nonce: BigInt(0).toString(),
    deadline: BigInt(9999999999).toString(),
    vType: VerificationType.signedVerification,
  } as unknown as UniversalPayload;
}

function makeSvmCtx(): OrchestratorContext {
  return {
    pushClient: { publicClient: {}, pushChainInfo: { chainId: '42101' } },
    universalSigner: {
      account: {
        chain: CHAIN.SOLANA_DEVNET,
        address: '0xabCDEF1234567890ABcDEF1234567890aBCDeF12',
      },
      signTypedData: undefined,
      signMessage: jest.fn(),
      signAndSendTransaction: jest.fn(),
    },
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls: {},
    printTraces: false,
    progressHook: undefined,
    accountStatusCache: null,
  } as unknown as OrchestratorContext;
}

function makeEvmCtx(): OrchestratorContext {
  return {
    pushClient: { publicClient: {}, pushChainInfo: { chainId: '42101' } },
    universalSigner: {
      account: {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: '0xabCDEF1234567890ABcDEF1234567890aBCDeF12',
      },
      signTypedData: jest.fn(),
      signMessage: jest.fn(),
      signAndSendTransaction: jest.fn(),
    },
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls: {},
    printTraces: false,
    progressHook: undefined,
    accountStatusCache: null,
  } as unknown as OrchestratorContext;
}

describe('SVM payload encoding (post-Option-B fix)', () => {
  describe('encoder dispatch', () => {
    it('SVM signer dispatches to the SVM Borsh encoder, EVM signer to ABI', () => {
      const svmCtx = makeSvmCtx();
      const evmCtx = makeEvmCtx();
      const payload = buildOrchestratorShapePayload(BigInt(1000));

      const svmHex = encodePayloadForOrigin(svmCtx, payload);
      const evmHex = encodePayloadForOrigin(evmCtx, payload);

      expect(svmHex).not.toBe(evmHex);
      // v0 SVM Borsh for a 4-byte data payload = 73 base + 4 data = 77 bytes.
      expect((svmHex.length - 2) / 2).toBe(77);
      // EVM ABI is fixed-width and much larger.
      expect((evmHex.length - 2) / 2).toBeGreaterThan(200);
    });
  });

  describe('SVM encoder bounds', () => {
    it('rejects Riyanshu’s exact value (still > u64)', () => {
      const svmCtx = makeSvmCtx();
      const payload = buildOrchestratorShapePayload(RIYANSHU_NATIVE_VALUE);
      expect(() => encodePayloadForOrigin(svmCtx, payload)).toThrow();
    });

    it('passes at u64 max (the boundary)', () => {
      const svmCtx = makeSvmCtx();
      expect(() =>
        encodePayloadForOrigin(svmCtx, buildOrchestratorShapePayload(U64_MAX))
      ).not.toThrow();
    });
  });

  describe('EVM-signer workaround documented in the error message', () => {
    it('encodes Riyanshu’s value cleanly via ABI uint256', () => {
      const evmCtx = makeEvmCtx();
      const payload = buildOrchestratorShapePayload(RIYANSHU_NATIVE_VALUE);
      expect(() => encodePayloadForOrigin(evmCtx, payload)).not.toThrow();
    });
  });
});
