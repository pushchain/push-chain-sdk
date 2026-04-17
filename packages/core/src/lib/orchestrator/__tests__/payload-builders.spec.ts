/**
 * Unit tests for payload-builders.ts
 *
 * Tests all pure functions used for building multicall payloads,
 * outbound requests, and cascade composition helpers.
 */
import { decodeAbiParameters, decodeFunctionData, keccak256, toBytes } from 'viem';
import { ERC20_EVM } from '../../constants/abi/erc20.evm';
import { CEA_EVM } from '../../constants/abi/cea.evm';
import { UNIVERSAL_GATEWAY_V0 } from '../../constants/abi/universalGatewayV0.evm';
import { UNIVERSAL_GATEWAY_PC } from '../../constants/abi/universalGatewayPC.evm';
import { ZERO_ADDRESS, MIGRATION_SELECTOR, MULTICALL_SELECTOR, UEA_MULTICALL_SELECTOR } from '../../constants/selectors';
import type { MultiCall, UniversalOutboundTxRequest } from '../orchestrator.types';
import {
  buildCeaMulticallPayload,
  buildSingleCeaCall,
  buildApproveAndInteract,
  buildSendUniversalTxFromCEA,
  buildSendUniversalTxToUEA,
  buildOutboundRequest,
  buildNativeTransfer,
  buildErc20Transfer,
  buildErc20WithdrawalMulticall,
  buildMigrationPayload,
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

  it('should include UEA_MULTICALL_SELECTOR prefix', () => {
    const calls: MultiCall[] = [{ to: ALICE, value: BigInt(100), data: '0x' }];
    const encoded = buildCeaMulticallPayload(calls);
    expect(encoded.startsWith('0x')).toBe(true);
    // Should have UEA_MULTICALL_SELECTOR prefix (0x8f6f1c5e) for CEA to recognize it
    expect(encoded.startsWith(UEA_MULTICALL_SELECTOR)).toBe(true);
  });

  it('should encode a single multicall entry', () => {
    const calls: MultiCall[] = [{ to: ALICE, value: BigInt(100), data: '0x' }];
    const encoded = buildCeaMulticallPayload(calls);

    expect(encoded).toMatch(/^0x/);
    expect(encoded.length).toBeGreaterThan(2);

    // Strip selector (first 4 bytes after 0x) and decode
    const dataWithoutSelector = `0x${encoded.slice(10)}` as `0x${string}`;
    const [decoded] = decodeAbiParameters([MULTICALL_TUPLE_TYPE], dataWithoutSelector);
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

    // Strip selector (first 4 bytes after 0x) and decode
    const dataWithoutSelector = `0x${encoded.slice(10)}` as `0x${string}`;
    const [decoded] = decodeAbiParameters([MULTICALL_TUPLE_TYPE], dataWithoutSelector);
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
    expect(encoded.startsWith('0x')).toBe(true);
    expect(encoded.startsWith(UEA_MULTICALL_SELECTOR)).toBe(true);
    // Strip selector (first 4 bytes after 0x) and decode
    const dataWithoutSelector = `0x${encoded.slice(10)}` as `0x${string}`;
    const [decoded] = decodeAbiParameters([MULTICALL_TUPLE_TYPE], dataWithoutSelector);
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

    expect(result).toHaveLength(3);

    // First call: approve to zero (USDT safety)
    expect(result[0].to).toBe(TOKEN_A);
    const decodedZero = decodeFunctionData({ abi: ERC20_EVM, data: result[0].data as `0x${string}` });
    expect(decodedZero.functionName).toBe('approve');
    expect(decodedZero.args![1]).toBe(BigInt(0));

    // Second call: approve actual amount
    expect(result[1].to).toBe(TOKEN_A);
    expect(result[1].value).toBe(BigInt(0));
    const decoded = decodeFunctionData({ abi: ERC20_EVM, data: result[1].data as `0x${string}` });
    expect(decoded.functionName).toBe('approve');
    expect(decoded.args![0]).toBe(BOB); // spender
    expect(decoded.args![1]).toBe(BigInt(1000)); // amount

    // Third call: the interaction
    expect(result[2]).toBe(interactCall);
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

  it('should produce burn approval + outbound call with pre-computed native value', () => {
    const result = buildOutboundApprovalAndCall({
      prc20Token: TOKEN_A,
      gasToken: TOKEN_A,
      burnAmount: BigInt(1000),
      gasFee: BigInt(500),
      nativeValueForGas: BigInt(2600),
      gatewayPcAddress: GATEWAY,
      outboundRequest,
    });

    // 1 approve-zero + 1 approve (burn) + 1 outbound = 3 calls
    expect(result).toHaveLength(3);

    // First: approve to zero (USDT safety)
    const approveZeroDecoded = decodeFunctionData({
      abi: ERC20_EVM,
      data: result[0].data as `0x${string}`,
    });
    expect(approveZeroDecoded.functionName).toBe('approve');
    expect(approveZeroDecoded.args![1]).toBe(BigInt(0));

    // Second: approve burnAmount on prc20Token
    const approveDecoded = decodeFunctionData({
      abi: ERC20_EVM,
      data: result[1].data as `0x${string}`,
    });
    expect(approveDecoded.functionName).toBe('approve');
    expect(approveDecoded.args![0]).toBe(GATEWAY);
    expect(approveDecoded.args![1]).toBe(BigInt(1000)); // only burnAmount
    expect(result[1].to).toBe(TOKEN_A);

    // Third: sendUniversalTxOutbound with pre-computed native value
    const outboundDecoded = decodeFunctionData({
      abi: UNIVERSAL_GATEWAY_PC,
      data: result[2].data as `0x${string}`,
    });
    expect(outboundDecoded.functionName).toBe('sendUniversalTxOutbound');
    expect(result[2].to).toBe(GATEWAY);
    expect(result[2].value).toBe(BigInt(2600));
  });

  it('should skip burn approval when zero address token', () => {
    const result = buildOutboundApprovalAndCall({
      prc20Token: ZERO_ADDRESS as `0x${string}`,
      gasToken: ZERO_ADDRESS as `0x${string}`,
      burnAmount: BigInt(1000),
      gasFee: BigInt(500),
      gatewayPcAddress: GATEWAY,
      outboundRequest: { ...outboundRequest, token: ZERO_ADDRESS as `0x${string}` },
    });

    // Only outbound call (no approval for zero address)
    expect(result).toHaveLength(1);
    const outboundDecoded = decodeFunctionData({
      abi: UNIVERSAL_GATEWAY_PC,
      data: result[0].data as `0x${string}`,
    });
    expect(outboundDecoded.functionName).toBe('sendUniversalTxOutbound');
    // fallback: gasFee * 5 = 2500 (no nativeValueForGas passed)
    expect(result[0].value).toBe(BigInt(2500));
  });

  it('should skip burn approval when burnAmount is zero', () => {
    const result = buildOutboundApprovalAndCall({
      prc20Token: TOKEN_A,
      gasToken: TOKEN_A,
      burnAmount: BigInt(0),
      gasFee: BigInt(500),
      nativeValueForGas: BigInt(2550),
      gatewayPcAddress: GATEWAY,
      outboundRequest,
    });

    // Only outbound call (no approval for zero burn)
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(BigInt(2550));
  });

  it('should fallback to 5x gasFee when nativeValueForGas not provided', () => {
    const result = buildOutboundApprovalAndCall({
      prc20Token: TOKEN_A,
      gasToken: TOKEN_B,
      burnAmount: BigInt(100),
      gasFee: BigInt(50),
      gatewayPcAddress: GATEWAY,
      outboundRequest,
    });

    // approve-zero + approve + outbound
    expect(result).toHaveLength(3);
    // fallback: gasFee * 5 = 250
    expect(result[2].value).toBe(BigInt(250));
  });

  it('Case C: prepends bridgeSwapEntries and bumps burnAmount by extraBurnAmount', () => {
    // Simulate three bridge-swap entries that would come from buildBridgeSwapEntries.
    const wrap: MultiCall = {
      to: '0x1111111111111111111111111111111111111111',
      value: BigInt(500),
      data: '0xdeadbeef',
    };
    const approveRouter: MultiCall = {
      to: '0x2222222222222222222222222222222222222222',
      value: BigInt(0),
      data: '0xcafebabe',
    };
    const swap: MultiCall = {
      to: '0x3333333333333333333333333333333333333333',
      value: BigInt(0),
      data: '0xfacefeed',
    };

    const result = buildOutboundApprovalAndCall({
      prc20Token: TOKEN_A,
      gasToken: TOKEN_A,
      burnAmount: BigInt(1000),
      gasFee: BigInt(500),
      nativeValueForGas: BigInt(2600),
      gatewayPcAddress: GATEWAY,
      outboundRequest,
      bridgeSwapEntries: [wrap, approveRouter, swap],
      extraBurnAmount: BigInt(400),
    });

    // 3 bridge entries + approve-zero + approve-total + outbound = 6 calls
    expect(result).toHaveLength(6);

    // First three are the bridge-swap entries, untouched, in order.
    expect(result[0]).toEqual(wrap);
    expect(result[1]).toEqual(approveRouter);
    expect(result[2]).toEqual(swap);

    // Next: approve-zero
    const approveZero = decodeFunctionData({
      abi: ERC20_EVM,
      data: result[3].data as `0x${string}`,
    });
    expect(approveZero.functionName).toBe('approve');
    expect(approveZero.args![1]).toBe(BigInt(0));

    // Next: approve-total (burnAmount + extraBurnAmount = 1400)
    const approveTotal = decodeFunctionData({
      abi: ERC20_EVM,
      data: result[4].data as `0x${string}`,
    });
    expect(approveTotal.functionName).toBe('approve');
    expect(approveTotal.args![1]).toBe(BigInt(1400));

    // Final: sendUniversalTxOutbound with bumped amount (1400) and msg.value = nativeValueForGas
    const outbound = decodeFunctionData({
      abi: UNIVERSAL_GATEWAY_PC,
      data: result[5].data as `0x${string}`,
    });
    expect(outbound.functionName).toBe('sendUniversalTxOutbound');
    expect(result[5].value).toBe(BigInt(2600));
    // burnAmount bumped inside the request struct
    const req = outbound.args![0] as any;
    expect(req.amount).toBe(BigInt(1400));
  });

  it('no bridgeSwapEntries → existing Cases A/B emission unchanged', () => {
    const result = buildOutboundApprovalAndCall({
      prc20Token: TOKEN_A,
      gasToken: TOKEN_A,
      burnAmount: BigInt(1000),
      gasFee: BigInt(500),
      nativeValueForGas: BigInt(2600),
      gatewayPcAddress: GATEWAY,
      outboundRequest,
    });
    // Same 3-entry shape as before (approve-zero, approve, outbound)
    expect(result).toHaveLength(3);
  });
});

// ============================================================================
// MIGRATION_SELECTOR constant
// ============================================================================
describe('MIGRATION_SELECTOR', () => {
  it('should equal bytes4(keccak256("UEA_MIGRATION"))', () => {
    const expected = keccak256(toBytes('UEA_MIGRATION')).slice(0, 10);
    expect(MIGRATION_SELECTOR).toBe(expected);
  });

  it('should be exactly 10 hex characters (4 bytes)', () => {
    expect(MIGRATION_SELECTOR).toMatch(/^0x[0-9a-f]{8}$/);
    expect(MIGRATION_SELECTOR.length).toBe(10);
  });
});

// ============================================================================
// buildMigrationPayload
// ============================================================================
describe('buildMigrationPayload', () => {
  it('should return the MIGRATION_SELECTOR value', () => {
    expect(buildMigrationPayload()).toBe(MIGRATION_SELECTOR);
  });

  it('should return 0xcac656d6', () => {
    expect(buildMigrationPayload()).toBe('0xcac656d6');
  });

  it('should return exactly 4 bytes (10 hex chars)', () => {
    const payload = buildMigrationPayload();
    expect(payload.length).toBe(10);
    expect(payload).toMatch(/^0x[0-9a-f]{8}$/);
  });
});

// ============================================================================
// buildErc20WithdrawalMulticall
// ============================================================================
describe('buildErc20WithdrawalMulticall', () => {
  it('should return a single-element MultiCall array', () => {
    const result = buildErc20WithdrawalMulticall(TOKEN_A, ALICE, BigInt(5000));
    expect(result).toHaveLength(1);
  });

  it('should target the token address', () => {
    const result = buildErc20WithdrawalMulticall(TOKEN_A, ALICE, BigInt(5000));
    expect(result[0].to).toBe(TOKEN_A);
  });

  it('should have value 0', () => {
    const result = buildErc20WithdrawalMulticall(TOKEN_A, ALICE, BigInt(5000));
    expect(result[0].value).toBe(BigInt(0));
  });

  it('should encode an ERC20 transfer call', () => {
    const result = buildErc20WithdrawalMulticall(TOKEN_A, ALICE, BigInt(5000));
    const decoded = decodeFunctionData({
      abi: ERC20_EVM,
      data: result[0].data as `0x${string}`,
    });
    expect(decoded.functionName).toBe('transfer');
    expect(decoded.args![0]).toBe(ALICE);
    expect(decoded.args![1]).toBe(BigInt(5000));
  });

  it('should produce output matching buildErc20Transfer wrapped in array', () => {
    const result = buildErc20WithdrawalMulticall(TOKEN_A, BOB, BigInt(999));
    const direct = buildErc20Transfer(TOKEN_A, BOB, BigInt(999));
    expect(result).toEqual([direct]);
  });
});

// ============================================================================
// buildSendUniversalTxToUEA
// ============================================================================
describe('buildSendUniversalTxToUEA', () => {
  const CEA_ADDRESS = '0xDDdDddDdDdddDDddDDddDDDDdDdDDdDDdDDDDDDd' as `0x${string}`;

  it('should encode sendUniversalTxToUEA function call on CEA_EVM ABI', () => {
    const result = buildSendUniversalTxToUEA(
      CEA_ADDRESS,
      TOKEN_A,
      BigInt(1000),
      '0xdeadbeef',
      CEA_ADDRESS
    );

    const decoded = decodeFunctionData({
      abi: CEA_EVM,
      data: result.data as `0x${string}`,
    });
    expect(decoded.functionName).toBe('sendUniversalTxToUEA');
  });

  it('should return MultiCall with to = ceaAddress and value = 0', () => {
    const result = buildSendUniversalTxToUEA(
      CEA_ADDRESS,
      TOKEN_A,
      BigInt(500),
      '0xabcd',
      CEA_ADDRESS
    );

    expect(result.to).toBe(CEA_ADDRESS);
    expect(result.value).toBe(BigInt(0));
  });

  it('should encode correct args (token, amount, payload, revertRecipient)', () => {
    const result = buildSendUniversalTxToUEA(
      CEA_ADDRESS,
      TOKEN_A,
      BigInt(2000),
      '0x12345678',
      CEA_ADDRESS
    );

    const decoded = decodeFunctionData({
      abi: CEA_EVM,
      data: result.data as `0x${string}`,
    });
    expect(decoded.args![0]).toBe(TOKEN_A); // token
    expect(decoded.args![1]).toBe(BigInt(2000)); // amount
    expect(decoded.args![2]).toBe('0x12345678'); // payload
    expect(decoded.args![3]).toBe(CEA_ADDRESS); // revertRecipient
  });

  it('should work with native token (ZERO_ADDRESS)', () => {
    const result = buildSendUniversalTxToUEA(
      CEA_ADDRESS,
      ZERO_ADDRESS as `0x${string}`,
      BigInt(1000),
      '0x',
      CEA_ADDRESS
    );

    const decoded = decodeFunctionData({
      abi: CEA_EVM,
      data: result.data as `0x${string}`,
    });
    expect(decoded.functionName).toBe('sendUniversalTxToUEA');
    expect(decoded.args![0]).toBe(ZERO_ADDRESS);
    expect(decoded.args![1]).toBe(BigInt(1000));
  });

  it('should work with empty payload', () => {
    const result = buildSendUniversalTxToUEA(
      CEA_ADDRESS,
      TOKEN_A,
      BigInt(100),
      '0x',
      CEA_ADDRESS
    );

    expect(result.data).toMatch(/^0x/);
    expect(result.data.length).toBeGreaterThan(2);

    const decoded = decodeFunctionData({
      abi: CEA_EVM,
      data: result.data as `0x${string}`,
    });
    expect(decoded.functionName).toBe('sendUniversalTxToUEA');
    expect(decoded.args![2]).toBe('0x');
  });
});

// ============================================================================
// SVM Payload Builders
// ============================================================================
import {
  encodeSvmExecutePayload,
  encodeSvmCeaToUeaPayload,
  isSvmChain,
  isValidSolanaHexAddress,
} from '../payload-builders';
import { CHAIN } from '../../constants/enums';

// 32-byte Solana addresses as hex
const SOL_PROGRAM = '0x7673075a980bfd5d6b1dffe99c31f63e8938519cc1c2af009dda5e568a94460d' as `0x${string}`;
const SOL_GATEWAY = '0xaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd' as `0x${string}`;
const SOL_MINT = '0x1122334411223344112233441122334411223344112233441122334411223344' as `0x${string}`;

describe('isSvmChain', () => {
  it('should return true for Solana chains', () => {
    expect(isSvmChain(CHAIN.SOLANA_DEVNET)).toBe(true);
    expect(isSvmChain(CHAIN.SOLANA_TESTNET)).toBe(true);
    expect(isSvmChain(CHAIN.SOLANA_MAINNET)).toBe(true);
  });

  it('should return false for EVM chains', () => {
    expect(isSvmChain(CHAIN.ETHEREUM_SEPOLIA)).toBe(false);
  });
});

describe('isValidSolanaHexAddress', () => {
  it('should accept 32-byte hex addresses', () => {
    expect(isValidSolanaHexAddress(SOL_PROGRAM)).toBe(true);
  });

  it('should reject 20-byte EVM addresses', () => {
    expect(isValidSolanaHexAddress(ALICE)).toBe(false);
  });

  it('should reject addresses without 0x prefix', () => {
    expect(isValidSolanaHexAddress(SOL_PROGRAM.slice(2))).toBe(false);
  });
});

describe('encodeSvmExecutePayload', () => {
  it('should encode a payload with no accounts', () => {
    const ixData = new Uint8Array([1, 2, 3, 4]);
    const result = encodeSvmExecutePayload({
      targetProgram: SOL_PROGRAM,
      accounts: [],
      ixData,
      instructionId: 2,
    });
    expect(result).toMatch(/^0x/);
    // 4 (accounts_count=0) + 0 (no accounts) + 4 (ix_data_length) + 4 (ixData) + 1 (instruction_id) + 32 (target_program) = 45 bytes = 90 hex chars + "0x"
    expect(result.length).toBe(92);
  });

  it('should encode a payload with accounts', () => {
    const ixData = new Uint8Array([1, 2]);
    const result = encodeSvmExecutePayload({
      targetProgram: SOL_PROGRAM,
      accounts: [
        { pubkey: SOL_GATEWAY, isWritable: true },
        { pubkey: SOL_MINT, isWritable: false },
      ],
      ixData,
      instructionId: 2,
    });
    expect(result).toMatch(/^0x/);
    // 4 + 33*2 + 4 + 2 + 1 + 32 = 109 bytes = 218 hex chars + "0x"
    expect(result.length).toBe(220);
  });
});

// ============================================================================
// Route Validation — Unsupported Token (C-5)
// ============================================================================
import {
  validateRouteParams,
  RouteValidationError,
  findTokenChain,
} from '../route-detector';
import { MOVEABLE_TOKENS } from '../../constants/tokens';

describe('findTokenChain', () => {
  it('should find the chain for a chain-specific registered token', () => {
    // Use a token unique to BNB Testnet (BNB native or BNB-specific USDT address)
    const bnbTokens = MOVEABLE_TOKENS[CHAIN.BNB_TESTNET];
    if (bnbTokens && bnbTokens.length > 0) {
      // Find a token whose address is unique to BNB Testnet
      const sepoliaTokens = MOVEABLE_TOKENS[CHAIN.ETHEREUM_SEPOLIA] || [];
      const uniqueBnbToken = bnbTokens.find(
        t => !sepoliaTokens.some(st => st.address.toLowerCase() === t.address.toLowerCase() && st.symbol === t.symbol)
      );
      if (uniqueBnbToken) {
        const chain = findTokenChain(uniqueBnbToken);
        expect(chain).toBe(CHAIN.BNB_TESTNET);
      }
    }
  });

  it('should return undefined for an unregistered token', () => {
    const fakeToken = {
      symbol: 'FAKE',
      decimals: 18,
      address: '0xFAFAFAFAFAFAFAFAFAFAFAFAFAFAFAFAFAFAFAFA',
      mechanism: 'approve' as const,
    };
    expect(findTokenChain(fakeToken)).toBeUndefined();
  });
});

describe('validateRouteParams — unsupported token', () => {
  it('should throw RouteValidationError when token symbol is not available on target chain', () => {
    // SOL token exists on Solana Devnet but NOT on BNB Testnet
    const solTokens = MOVEABLE_TOKENS[CHAIN.SOLANA_DEVNET];
    if (!solTokens || solTokens.length === 0) {
      console.log('Skipping — no Solana Devnet tokens registered');
      return;
    }

    const solToken = solTokens.find(t => t.symbol === 'SOL');
    if (!solToken) {
      console.log('Skipping — SOL not found in Solana Devnet');
      return;
    }

    // Try to use SOL token with BNB Testnet target — BNB Testnet has no SOL, should fail
    expect(() => {
      validateRouteParams({
        to: {
          address: '0x1234567890123456789012345678901234567890',
          chain: CHAIN.BNB_TESTNET,
        },
        funds: {
          amount: BigInt(10000),
          token: solToken,
        },
      });
    }).toThrow(RouteValidationError);
  });

  it('should include token symbol and destination in error message', () => {
    const solTokens = MOVEABLE_TOKENS[CHAIN.SOLANA_DEVNET];
    if (!solTokens || solTokens.length === 0) return;

    const solToken = solTokens.find(t => t.symbol === 'SOL');
    if (!solToken) return;

    expect(() => {
      validateRouteParams({
        to: {
          address: '0x1234567890123456789012345678901234567890',
          chain: CHAIN.BNB_TESTNET,
        },
        funds: {
          amount: BigInt(10000),
          token: solToken,
        },
      });
    }).toThrow(/Unsupported moveable token[\s\S]*token=SOLANA_DEVNET\.SOL[\s\S]*destination=/);
  });

  it('should NOT throw when token symbol exists on target chain', () => {
    // USDT exists on both Sepolia and BNB Testnet, so using Sepolia USDT
    // with BNB target should pass (the symbol is available on BNB)
    const sepoliaTokens = MOVEABLE_TOKENS[CHAIN.ETHEREUM_SEPOLIA];
    if (!sepoliaTokens || sepoliaTokens.length === 0) return;

    const sepoliaUsdt = sepoliaTokens.find(t => t.symbol === 'USDT');
    if (!sepoliaUsdt) return;

    expect(() => {
      validateRouteParams({
        to: {
          address: '0x1234567890123456789012345678901234567890',
          chain: CHAIN.BNB_TESTNET,
        },
        funds: {
          amount: BigInt(10000),
          token: sepoliaUsdt,
        },
      });
    }).not.toThrow();
  });

  it('should NOT throw when target is Push Chain', () => {
    const solTokens = MOVEABLE_TOKENS[CHAIN.SOLANA_DEVNET];
    if (!solTokens || solTokens.length === 0) return;

    const solToken = solTokens.find(t => t.symbol === 'SOL');
    if (!solToken) return;

    // Push Chain target should allow any token
    expect(() => {
      validateRouteParams({
        to: {
          address: '0x1234567890123456789012345678901234567890',
          chain: CHAIN.PUSH_TESTNET_DONUT,
        },
        funds: {
          amount: BigInt(10000),
          token: solToken,
        },
      });
    }).not.toThrow();
  });
});

describe('encodeSvmCeaToUeaPayload', () => {
  const REVERT_RECIPIENT = SOL_PROGRAM; // dummy 32-byte revert recipient

  it('should encode SOL drain (no token mint, no extra payload)', () => {
    const result = encodeSvmCeaToUeaPayload({
      gatewayProgramHex: SOL_GATEWAY,
      drainAmount: BigInt(50_000_000),
      revertRecipientHex: REVERT_RECIPIENT,
    });
    expect(result).toMatch(/^0x/);
    expect(result.length).toBeGreaterThan(10);
  });

  it('should encode SPL drain (with token mint)', () => {
    const result = encodeSvmCeaToUeaPayload({
      gatewayProgramHex: SOL_GATEWAY,
      drainAmount: BigInt(1_000_000),
      tokenMintHex: SOL_MINT,
      revertRecipientHex: REVERT_RECIPIENT,
    });
    expect(result).toMatch(/^0x/);
    expect(result.length).toBeGreaterThan(10);
  });

  it('should encode with extraPayload', () => {
    const extraPayload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const withPayload = encodeSvmCeaToUeaPayload({
      gatewayProgramHex: SOL_GATEWAY,
      drainAmount: BigInt(50_000_000),
      extraPayload,
      revertRecipientHex: REVERT_RECIPIENT,
    });
    const withoutPayload = encodeSvmCeaToUeaPayload({
      gatewayProgramHex: SOL_GATEWAY,
      drainAmount: BigInt(50_000_000),
      revertRecipientHex: REVERT_RECIPIENT,
    });
    // The payload with extraPayload should be longer (extra 4 bytes in ixData)
    expect(withPayload.length).toBeGreaterThan(withoutPayload.length);
  });

  it('should produce different output with vs without extraPayload', () => {
    const extraPayload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const withPayload = encodeSvmCeaToUeaPayload({
      gatewayProgramHex: SOL_GATEWAY,
      drainAmount: BigInt(50_000_000),
      extraPayload,
      revertRecipientHex: REVERT_RECIPIENT,
    });
    const withoutPayload = encodeSvmCeaToUeaPayload({
      gatewayProgramHex: SOL_GATEWAY,
      drainAmount: BigInt(50_000_000),
      revertRecipientHex: REVERT_RECIPIENT,
    });
    expect(withPayload).not.toBe(withoutPayload);
  });

  it('should produce same output for empty extraPayload and no extraPayload', () => {
    const emptyPayload = encodeSvmCeaToUeaPayload({
      gatewayProgramHex: SOL_GATEWAY,
      drainAmount: BigInt(50_000_000),
      extraPayload: new Uint8Array(0),
      revertRecipientHex: REVERT_RECIPIENT,
    });
    const noPayload = encodeSvmCeaToUeaPayload({
      gatewayProgramHex: SOL_GATEWAY,
      drainAmount: BigInt(50_000_000),
      revertRecipientHex: REVERT_RECIPIENT,
    });
    expect(emptyPayload).toBe(noPayload);
  });
});
