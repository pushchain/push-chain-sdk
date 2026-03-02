/**
 * Unit tests for payload-builders.ts
 *
 * Tests all pure functions used for building multicall payloads,
 * outbound requests, and cascade composition helpers.
 */
import { decodeAbiParameters, decodeFunctionData } from 'viem';
import { ERC20_EVM, UNIVERSAL_GATEWAY_V0, UNIVERSAL_GATEWAY_PC } from '../../constants/abi';
import { ZERO_ADDRESS } from '../../constants/selectors';
import type { MultiCall, UniversalOutboundTxRequest } from '../orchestrator.types';
import {
  buildCeaMulticallPayload,
  buildSingleCeaCall,
  buildApproveAndInteract,
  buildSendUniversalTxFromCEA,
  buildOutboundRequest,
  buildNativeTransfer,
  buildErc20Transfer,
  isZeroAddress,
  buildOutboundApprovalAndCall,
} from '../payload-builders';

// Use checksummed addresses (viem validates checksums)
const ALICE = '0xabCDEF1234567890ABcDEF1234567890aBCDeF12' as `0x${string}`;
const BOB = '0x1111111111111111111111111111111111111111' as `0x${string}`;
const TOKEN_A = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as `0x${string}`;
const TOKEN_B = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' as `0x${string}`;
const GATEWAY = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' as `0x${string}`;

const MULTICALL_TUPLE_TYPE = {
  type: 'tuple[]' as const,
  components: [
    { name: 'to' as const, type: 'address' as const },
    { name: 'value' as const, type: 'uint256' as const },
    { name: 'data' as const, type: 'bytes' as const },
  ],
};

// ============================================================================
// buildCeaMulticallPayload
// ============================================================================
describe('buildCeaMulticallPayload', () => {
  it('should return 0x for empty array', () => {
    expect(buildCeaMulticallPayload([])).toBe('0x');
  });

  it('should encode a single multicall entry', () => {
    const calls: MultiCall[] = [{ to: ALICE, value: BigInt(100), data: '0x' }];
    const encoded = buildCeaMulticallPayload(calls);

    expect(encoded).toMatch(/^0x/);
    expect(encoded.length).toBeGreaterThan(2);

    // Decode and verify roundtrip
    const [decoded] = decodeAbiParameters([MULTICALL_TUPLE_TYPE], encoded);
    expect(decoded).toHaveLength(1);
    expect((decoded[0] as { to: string }).to.toLowerCase()).toBe(ALICE.toLowerCase());
    expect((decoded[0] as { value: bigint }).value).toBe(BigInt(100));
  });

  it('should encode multiple multicall entries', () => {
    const calls: MultiCall[] = [
      { to: ALICE, value: BigInt(100), data: '0x' },
      { to: BOB, value: BigInt(0), data: '0xdeadbeef' },
    ];
    const encoded = buildCeaMulticallPayload(calls);

    const [decoded] = decodeAbiParameters([MULTICALL_TUPLE_TYPE], encoded);
    expect(decoded).toHaveLength(2);
    expect((decoded[1] as { to: string }).to.toLowerCase()).toBe(BOB.toLowerCase());
  });
});

// ============================================================================
// buildSingleCeaCall
// ============================================================================
describe('buildSingleCeaCall', () => {
  it('should encode a single call using buildCeaMulticallPayload', () => {
    const encoded = buildSingleCeaCall(ALICE, BigInt(50), '0xabcd');
    const [decoded] = decodeAbiParameters([MULTICALL_TUPLE_TYPE], encoded);
    expect(decoded).toHaveLength(1);
    expect((decoded[0] as { to: string }).to.toLowerCase()).toBe(ALICE.toLowerCase());
    expect((decoded[0] as { value: bigint }).value).toBe(BigInt(50));
  });
});

// ============================================================================
// buildApproveAndInteract
// ============================================================================
describe('buildApproveAndInteract', () => {
  it('should return approve call followed by interaction call', () => {
    const interactCall: MultiCall = {
      to: BOB,
      value: BigInt(0),
      data: '0x12345678',
    };
    const result = buildApproveAndInteract(TOKEN_A, BOB, BigInt(1000), interactCall);

    expect(result).toHaveLength(2);

    // First call: approve
    expect(result[0].to).toBe(TOKEN_A);
    expect(result[0].value).toBe(BigInt(0));
    // Verify it's an approve call
    const decoded = decodeFunctionData({ abi: ERC20_EVM, data: result[0].data as `0x${string}` });
    expect(decoded.functionName).toBe('approve');
    expect(decoded.args![0]).toBe(BOB); // spender
    expect(decoded.args![1]).toBe(BigInt(1000)); // amount

    // Second call: the interaction
    expect(result[1]).toBe(interactCall);
  });
});

// ============================================================================
// buildSendUniversalTxFromCEA
// ============================================================================
describe('buildSendUniversalTxFromCEA', () => {
  it('should encode sendUniversalTxFromCEA function call', () => {
    const result = buildSendUniversalTxFromCEA(
      GATEWAY,
      ALICE, // recipient
      TOKEN_A, // token
      BigInt(500),
      '0xdeadbeef',
      BOB, // revertRecipient
    );

    expect(result.to).toBe(GATEWAY);
    expect(result.value).toBe(BigInt(0)); // default nativeValue
    expect(result.data).toMatch(/^0x/);

    // Decode the function call
    const decoded = decodeFunctionData({
      abi: UNIVERSAL_GATEWAY_V0,
      data: result.data as `0x${string}`,
    });
    expect(decoded.functionName).toBe('sendUniversalTxFromCEA');
  });

  it('should pass nativeValue as MultiCall value', () => {
    const result = buildSendUniversalTxFromCEA(
      GATEWAY,
      ALICE,
      ZERO_ADDRESS as `0x${string}`,
      BigInt(1000),
      '0x',
      BOB,
      '0x',
      BigInt(999),
    );

    expect(result.value).toBe(BigInt(999));
  });
});

// ============================================================================
// buildOutboundRequest
// ============================================================================
describe('buildOutboundRequest', () => {
  it('should build correct UniversalOutboundTxRequest struct', () => {
    const result = buildOutboundRequest(
      ALICE, // target (legacy)
      TOKEN_A, // prc20Token
      BigInt(1000),
      BigInt(200000),
      '0xabcdef',
      BOB, // revertRecipient
    );

    expect(result.target).toBe(ALICE);
    expect(result.token).toBe(TOKEN_A);
    expect(result.amount).toBe(BigInt(1000));
    expect(result.gasLimit).toBe(BigInt(200000));
    expect(result.payload).toBe('0xabcdef');
    expect(result.revertRecipient).toBe(BOB);
  });

  it('should handle zero address token', () => {
    const result = buildOutboundRequest(
      ALICE,
      ZERO_ADDRESS as `0x${string}`,
      BigInt(0),
      BigInt(100000),
      '0x',
      BOB,
    );

    expect(result.token).toBe(ZERO_ADDRESS);
    expect(result.amount).toBe(BigInt(0));
  });
});

// ============================================================================
// buildNativeTransfer
// ============================================================================
describe('buildNativeTransfer', () => {
  it('should create a MultiCall with 0x data', () => {
    const result = buildNativeTransfer(ALICE, BigInt(1000));

    expect(result.to).toBe(ALICE);
    expect(result.value).toBe(BigInt(1000));
    expect(result.data).toBe('0x');
  });
});

// ============================================================================
// buildErc20Transfer
// ============================================================================
describe('buildErc20Transfer', () => {
  it('should encode ERC20 transfer call', () => {
    const result = buildErc20Transfer(TOKEN_A, ALICE, BigInt(5000));

    expect(result.to).toBe(TOKEN_A);
    expect(result.value).toBe(BigInt(0));

    // Decode the transfer call
    const decoded = decodeFunctionData({
      abi: ERC20_EVM,
      data: result.data as `0x${string}`,
    });
    expect(decoded.functionName).toBe('transfer');
    expect(decoded.args![0]).toBe(ALICE); // to
    expect(decoded.args![1]).toBe(BigInt(5000)); // amount
  });
});

// ============================================================================
// isZeroAddress
// ============================================================================
describe('isZeroAddress', () => {
  it('should return true for zero address', () => {
    expect(isZeroAddress(ZERO_ADDRESS as `0x${string}`)).toBe(true);
  });

  it('should return true for zero address with mixed case', () => {
    expect(isZeroAddress('0x0000000000000000000000000000000000000000')).toBe(true);
  });

  it('should return false for non-zero address', () => {
    expect(isZeroAddress(ALICE)).toBe(false);
  });
});

// ============================================================================
// buildOutboundApprovalAndCall
// ============================================================================
describe('buildOutboundApprovalAndCall', () => {
  const outboundRequest: UniversalOutboundTxRequest = {
    target: ALICE,
    token: TOKEN_A,
    amount: BigInt(1000),
    gasLimit: BigInt(200000),
    payload: '0x',
    revertRecipient: BOB,
  };

  describe('same token for gas and burn', () => {
    it('should produce single approval + outbound call', () => {
      const result = buildOutboundApprovalAndCall({
        prc20Token: TOKEN_A,
        gasToken: TOKEN_A,
        burnAmount: BigInt(1000),
        gasFee: BigInt(500),
        gatewayPcAddress: GATEWAY,
        outboundRequest,
      });

      // 1 approve + 1 outbound = 2 calls
      expect(result).toHaveLength(2);

      // First: approve for burnAmount + gasFee
      const approveDecoded = decodeFunctionData({
        abi: ERC20_EVM,
        data: result[0].data as `0x${string}`,
      });
      expect(approveDecoded.functionName).toBe('approve');
      expect(approveDecoded.args![0]).toBe(GATEWAY);
      expect(approveDecoded.args![1]).toBe(BigInt(1500)); // 1000 + 500
      expect(result[0].to).toBe(TOKEN_A);

      // Second: sendUniversalTxOutbound
      const outboundDecoded = decodeFunctionData({
        abi: UNIVERSAL_GATEWAY_PC,
        data: result[1].data as `0x${string}`,
      });
      expect(outboundDecoded.functionName).toBe('sendUniversalTxOutbound');
      expect(result[1].to).toBe(GATEWAY);
    });

    it('should skip approval when zero address token', () => {
      const result = buildOutboundApprovalAndCall({
        prc20Token: ZERO_ADDRESS as `0x${string}`,
        gasToken: ZERO_ADDRESS as `0x${string}`,
        burnAmount: BigInt(1000),
        gasFee: BigInt(500),
        gatewayPcAddress: GATEWAY,
        outboundRequest: { ...outboundRequest, token: ZERO_ADDRESS as `0x${string}` },
      });

      // Only the outbound call (no approval for zero address)
      expect(result).toHaveLength(1);
      const outboundDecoded = decodeFunctionData({
        abi: UNIVERSAL_GATEWAY_PC,
        data: result[0].data as `0x${string}`,
      });
      expect(outboundDecoded.functionName).toBe('sendUniversalTxOutbound');
    });

    it('should skip approval when amounts are zero', () => {
      const result = buildOutboundApprovalAndCall({
        prc20Token: TOKEN_A,
        gasToken: TOKEN_A,
        burnAmount: BigInt(0),
        gasFee: BigInt(0),
        gatewayPcAddress: GATEWAY,
        outboundRequest,
      });

      // Only the outbound call
      expect(result).toHaveLength(1);
    });
  });

  describe('different tokens for gas and burn', () => {
    it('should produce two separate approvals + outbound call', () => {
      const result = buildOutboundApprovalAndCall({
        prc20Token: TOKEN_A,
        gasToken: TOKEN_B,
        burnAmount: BigInt(1000),
        gasFee: BigInt(500),
        gatewayPcAddress: GATEWAY,
        outboundRequest,
      });

      // 2 approves + 1 outbound = 3 calls
      expect(result).toHaveLength(3);

      // First: approve gasFee on gasToken
      expect(result[0].to).toBe(TOKEN_B);
      const gasApprove = decodeFunctionData({
        abi: ERC20_EVM,
        data: result[0].data as `0x${string}`,
      });
      expect(gasApprove.functionName).toBe('approve');
      expect(gasApprove.args![1]).toBe(BigInt(500));

      // Second: approve burnAmount on prc20Token
      expect(result[1].to).toBe(TOKEN_A);
      const burnApprove = decodeFunctionData({
        abi: ERC20_EVM,
        data: result[1].data as `0x${string}`,
      });
      expect(burnApprove.functionName).toBe('approve');
      expect(burnApprove.args![1]).toBe(BigInt(1000));

      // Third: sendUniversalTxOutbound
      expect(result[2].to).toBe(GATEWAY);
    });

    it('should skip gas approval when gas token is zero address', () => {
      const result = buildOutboundApprovalAndCall({
        prc20Token: TOKEN_A,
        gasToken: ZERO_ADDRESS as `0x${string}`,
        burnAmount: BigInt(1000),
        gasFee: BigInt(500),
        gatewayPcAddress: GATEWAY,
        outboundRequest,
      });

      // 1 burn approve + 1 outbound = 2 calls
      expect(result).toHaveLength(2);
      expect(result[0].to).toBe(TOKEN_A); // burn approval
    });

    it('should skip burn approval when burn token is zero address', () => {
      const result = buildOutboundApprovalAndCall({
        prc20Token: ZERO_ADDRESS as `0x${string}`,
        gasToken: TOKEN_B,
        burnAmount: BigInt(1000),
        gasFee: BigInt(500),
        gatewayPcAddress: GATEWAY,
        outboundRequest: { ...outboundRequest, token: ZERO_ADDRESS as `0x${string}` },
      });

      // 1 gas approve + 1 outbound = 2 calls
      expect(result).toHaveLength(2);
      expect(result[0].to).toBe(TOKEN_B); // gas approval
    });

    it('should skip both approvals when both are zero address', () => {
      const result = buildOutboundApprovalAndCall({
        prc20Token: ZERO_ADDRESS as `0x${string}`,
        gasToken: ZERO_ADDRESS as `0x${string}`,
        burnAmount: BigInt(1000),
        gasFee: BigInt(500),
        gatewayPcAddress: GATEWAY,
        outboundRequest: { ...outboundRequest, token: ZERO_ADDRESS as `0x${string}` },
      });

      // Only outbound call
      expect(result).toHaveLength(1);
    });
  });
});
