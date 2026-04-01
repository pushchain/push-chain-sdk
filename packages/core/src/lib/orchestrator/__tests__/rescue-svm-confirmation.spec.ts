/**
 * Unit tests for rescue.ts, svm-helpers.ts, and confirmation.ts
 *
 * Covers:
 * - rescueFunds() validation, balance-capping, and multicall construction
 * - buildSvmUniversalTxRequest() hex/buffer conversion
 * - buildSvmUniversalTxRequestFromReq() request adaptation
 * - getSvmGatewayLogIndexFromTx() log parsing
 * - waitForLockerFeeConfirmation() EVM/SVM routing
 */

import { PublicKey } from '@solana/web3.js';
import { bytesToHex, hexToBytes, zeroAddress } from 'viem';
import { ZERO_ADDRESS } from '../../constants/selectors';
import { VM } from '../../constants/enums';
import type { ExecuteParams, UniversalTxRequest } from '../orchestrator.types';

// ============================================================================
// Mocks — declared before imports that use them
// ============================================================================

// --- rescue.ts dependencies ---
const mockComputeUEAOffchain = jest.fn();
const mockGetUniversalGatewayPCAddress = jest.fn();
const mockGetUEANonce = jest.fn();
const mockQueryRescueGasFee = jest.fn();

jest.mock('../internals/uea-manager', () => ({
  computeUEAOffchain: (...args: any[]) => mockComputeUEAOffchain(...args),
  getUEANonce: (...args: any[]) => mockGetUEANonce(...args),
}));

jest.mock('../internals/helpers', () => ({
  getUniversalGatewayPCAddress: (...args: any[]) =>
    mockGetUniversalGatewayPCAddress(...args),
}));

jest.mock('../internals/gas-calculator', () => ({
  queryRescueGasFee: (...args: any[]) => mockQueryRescueGasFee(...args),
}));

// --- confirmation.ts dependencies ---
const mockEvmConfirmations = jest.fn();
const mockSvmConfirmations = jest.fn();

jest.mock('../../vm-client/evm-client', () => ({
  EvmClient: jest.fn().mockImplementation(() => ({ _tag: 'evm' })),
}));

jest.mock('../../vm-client/svm-client', () => ({
  SvmClient: jest.fn().mockImplementation(() => ({ _tag: 'svm' })),
}));

jest.mock('../../constants/chain', () => {
  const actual = jest.requireActual('../../constants/chain');
  const { VM } = jest.requireActual('../../constants/enums');
  return {
    ...actual,
    CHAIN_INFO: {
      ...actual.CHAIN_INFO,
      'eip155:11155111': {
        ...actual.CHAIN_INFO['eip155:11155111'],
        vm: VM.EVM,
        defaultRPC: ['https://rpc.sepolia.example'],
        fastConfirmations: 3,
        timeout: 60000,
      },
      'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': {
        ...actual.CHAIN_INFO['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'],
        vm: VM.SVM,
        defaultRPC: ['https://api.devnet.solana.com'],
        fastConfirmations: 1,
        timeout: 120000,
      },
      'eip155:42101': {
        ...actual.CHAIN_INFO['eip155:42101'],
        vm: VM.EVM,
        defaultRPC: ['https://evm.donut.rpc.push.org/'],
        fastConfirmations: 0,
        timeout: 30000,
      },
    },
  };
});

// --- import after mocks ---
import { rescueFunds } from '../internals/rescue';
import {
  buildSvmUniversalTxRequest,
  buildSvmUniversalTxRequestFromReq,
  getSvmGatewayLogIndexFromTx,
} from '../internals/svm-helpers';

// We import the inner confirmation helpers directly so we can spy on them.
// waitForLockerFeeConfirmation is tested via its module export.
import * as confirmationModule from '../internals/confirmation';

import type { OrchestratorContext } from '../internals/context';
import type { CHAIN } from '../../constants/enums';

// ============================================================================
// Helpers — fake context builder
// ============================================================================

const FAKE_UEA = '0xaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAA' as `0x${string}`;
const FAKE_GATEWAY = '0x00000000000000000000000000000000000000C1' as `0x${string}`;
const VALID_TX_ID =
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' as `0x${string}`;
const VALID_PRC20 =
  '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF' as `0x${string}`;

function makeCtx(overrides?: Partial<OrchestratorContext>): OrchestratorContext {
  return {
    pushClient: {
      publicClient: {
        getCode: jest.fn().mockResolvedValue('0x6001'),
      },
      getBalance: jest.fn().mockResolvedValue(BigInt(300e18)),
      readContract: jest.fn(),
    } as any,
    universalSigner: {
      account: {
        chain: 'eip155:11155111' as CHAIN,
        address: '0x1111111111111111111111111111111111111111',
      },
    } as any,
    pushNetwork: 'TESTNET_DONUT' as any,
    rpcUrls: {},
    printTraces: false,
    accountStatusCache: null,
    ...overrides,
  };
}

// ============================================================================
// rescueFunds
// ============================================================================
describe('rescueFunds', () => {
  let executeFn: jest.Mock<Promise<any>, [ExecuteParams]>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockComputeUEAOffchain.mockReturnValue(FAKE_UEA);
    mockGetUniversalGatewayPCAddress.mockReturnValue(FAKE_GATEWAY);
    mockGetUEANonce.mockResolvedValue(BigInt(5));
    mockQueryRescueGasFee.mockResolvedValue({
      gasFee: BigInt(1e16),
      gasToken: ZERO_ADDRESS,
      nativeValueForGas: BigInt(5e16),
    });
    executeFn = jest.fn().mockResolvedValue({ hash: '0xresult' });
  });

  // ---------- universalTxId validation ----------

  describe('universalTxId validation', () => {
    it('should reject empty string', async () => {
      const ctx = makeCtx();
      await expect(
        rescueFunds(ctx, { universalTxId: '' as any, prc20: VALID_PRC20 }, executeFn)
      ).rejects.toThrow(/Invalid universalTxId/);
    });

    it('should reject id without 0x prefix', async () => {
      const ctx = makeCtx();
      const noPrefix = VALID_TX_ID.slice(2) as any;
      await expect(
        rescueFunds(ctx, { universalTxId: noPrefix, prc20: VALID_PRC20 }, executeFn)
      ).rejects.toThrow(/Invalid universalTxId/);
    });

    it('should reject id that is too short (< 66 chars)', async () => {
      const ctx = makeCtx();
      await expect(
        rescueFunds(ctx, { universalTxId: '0xabcd' as any, prc20: VALID_PRC20 }, executeFn)
      ).rejects.toThrow(/Invalid universalTxId/);
    });

    it('should reject id that is too long (> 66 chars)', async () => {
      const ctx = makeCtx();
      const tooLong = (VALID_TX_ID + 'ff') as any;
      await expect(
        rescueFunds(ctx, { universalTxId: tooLong, prc20: VALID_PRC20 }, executeFn)
      ).rejects.toThrow(/Invalid universalTxId/);
    });

    it('should reject id with non-hex characters', async () => {
      const ctx = makeCtx();
      const nonHex =
        '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG' as any;
      await expect(
        rescueFunds(ctx, { universalTxId: nonHex, prc20: VALID_PRC20 }, executeFn)
      ).rejects.toThrow(/Invalid universalTxId/);
    });

    it('should reject undefined/null universalTxId', async () => {
      const ctx = makeCtx();
      await expect(
        rescueFunds(ctx, { universalTxId: undefined as any, prc20: VALID_PRC20 }, executeFn)
      ).rejects.toThrow(/Invalid universalTxId/);

      await expect(
        rescueFunds(ctx, { universalTxId: null as any, prc20: VALID_PRC20 }, executeFn)
      ).rejects.toThrow(/Invalid universalTxId/);
    });
  });

  // ---------- prc20 validation ----------

  describe('prc20 validation', () => {
    it('should reject zero address prc20', async () => {
      const ctx = makeCtx();
      await expect(
        rescueFunds(
          ctx,
          { universalTxId: VALID_TX_ID, prc20: ZERO_ADDRESS as `0x${string}` },
          executeFn
        )
      ).rejects.toThrow(/prc20 token address cannot be zero address/);
    });

    it('should reject empty/undefined prc20', async () => {
      const ctx = makeCtx();
      await expect(
        rescueFunds(
          ctx,
          { universalTxId: VALID_TX_ID, prc20: '' as any },
          executeFn
        )
      ).rejects.toThrow(/prc20 token address cannot be zero address/);

      await expect(
        rescueFunds(
          ctx,
          { universalTxId: VALID_TX_ID, prc20: undefined as any },
          executeFn
        )
      ).rejects.toThrow(/prc20 token address cannot be zero address/);
    });
  });

  // ---------- gas fee query failure ----------

  describe('gas fee query failure', () => {
    it('should propagate queryRescueGasFee errors', async () => {
      mockQueryRescueGasFee.mockRejectedValueOnce(new Error('RPC timeout'));
      const ctx = makeCtx();
      await expect(
        rescueFunds(ctx, { universalTxId: VALID_TX_ID, prc20: VALID_PRC20 }, executeFn)
      ).rejects.toThrow(/Failed to query rescue gas fee.*RPC timeout/);
    });
  });

  // ---------- balance-capping logic ----------

  describe('nativeValueForGas balance capping', () => {
    it('should cap at EVM_NATIVE_VALUE_TARGET when balance > target + reserve', async () => {
      const ctx = makeCtx();
      // balance = 300e18, target = 200e18, reserve = 3e18 => 300 > 203, so adjustedValue = 200e18
      (ctx.pushClient.getBalance as jest.Mock).mockResolvedValue(BigInt(300e18));
      mockQueryRescueGasFee.mockResolvedValue({
        gasFee: BigInt(1e16),
        gasToken: ZERO_ADDRESS,
        nativeValueForGas: BigInt(5e16),
      });

      await rescueFunds(ctx, { universalTxId: VALID_TX_ID, prc20: VALID_PRC20 }, executeFn);

      expect(executeFn).toHaveBeenCalledTimes(1);
      const params = executeFn.mock.calls[0][0];
      // multicall value = adjusted nativeValueForGas = 200e18
      expect(params.value).toBe(BigInt(200e18));
    });

    it('should use balance - reserve when balance <= target + reserve but > reserve', async () => {
      const ctx = makeCtx();
      // balance = 100e18, target = 200e18, reserve = 3e18 => 100 <= 203 && 100 > 3
      (ctx.pushClient.getBalance as jest.Mock).mockResolvedValue(BigInt(100e18));

      await rescueFunds(ctx, { universalTxId: VALID_TX_ID, prc20: VALID_PRC20 }, executeFn);

      const params = executeFn.mock.calls[0][0];
      expect(params.value).toBe(BigInt(100e18) - BigInt(3e18));
    });

    it('should fall back to nativeValueForGas when balance <= reserve', async () => {
      const ctx = makeCtx();
      // balance = 1e18, reserve = 3e18 => 1 <= 3
      (ctx.pushClient.getBalance as jest.Mock).mockResolvedValue(BigInt(1e18));
      mockQueryRescueGasFee.mockResolvedValue({
        gasFee: BigInt(1e16),
        gasToken: ZERO_ADDRESS,
        nativeValueForGas: BigInt(5e16),
      });

      await rescueFunds(ctx, { universalTxId: VALID_TX_ID, prc20: VALID_PRC20 }, executeFn);

      const params = executeFn.mock.calls[0][0];
      expect(params.value).toBe(BigInt(5e16));
    });
  });

  // ---------- correct ExecuteParams construction ----------

  describe('ExecuteParams construction', () => {
    it('should call executeFn with correctly structured params', async () => {
      const ctx = makeCtx();
      (ctx.pushClient.getBalance as jest.Mock).mockResolvedValue(BigInt(300e18));

      await rescueFunds(ctx, { universalTxId: VALID_TX_ID, prc20: VALID_PRC20 }, executeFn);

      expect(executeFn).toHaveBeenCalledTimes(1);
      const params = executeFn.mock.calls[0][0];

      // to = UEA address
      expect(params.to).toBe(FAKE_UEA);
      // data = MultiCall array with exactly 1 entry
      expect(Array.isArray(params.data)).toBe(true);
      expect((params.data as any[]).length).toBe(1);
      // multicall target = gateway address
      expect((params.data as any[])[0].to).toBe(FAKE_GATEWAY);
      // multicall data is 0x-prefixed (rescueFundsOnSourceChain encoded)
      expect((params.data as any[])[0].data).toMatch(/^0x/);
      // _skipFeeLocking = true
      expect(params._skipFeeLocking).toBe(true);
      // _ueaStatus populated
      expect(params._ueaStatus).toBeDefined();
      expect(params._ueaStatus!.isDeployed).toBe(true);
      expect(params._ueaStatus!.nonce).toBe(BigInt(5));
    });

    it('should set isDeployed=false and nonce=0 when UEA has no code', async () => {
      const ctx = makeCtx();
      (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue(undefined);

      await rescueFunds(ctx, { universalTxId: VALID_TX_ID, prc20: VALID_PRC20 }, executeFn);

      const params = executeFn.mock.calls[0][0];
      expect(params._ueaStatus!.isDeployed).toBe(false);
      expect(params._ueaStatus!.nonce).toBe(BigInt(0));
      // getUEANonce should NOT be called when UEA is not deployed
      expect(mockGetUEANonce).not.toHaveBeenCalled();
    });

    it('should return the result of executeFn', async () => {
      const ctx = makeCtx();
      const fakeResult = { hash: '0xdeadbeef' } as any;
      executeFn.mockResolvedValueOnce(fakeResult);

      const result = await rescueFunds(
        ctx,
        { universalTxId: VALID_TX_ID, prc20: VALID_PRC20 },
        executeFn
      );
      expect(result).toBe(fakeResult);
    });
  });
});

// ============================================================================
// svm-helpers — buildSvmUniversalTxRequest
// ============================================================================
describe('buildSvmUniversalTxRequest', () => {
  const baseArgs = {
    recipient: Array.from({ length: 20 }, (_, i) => i + 1),
    token: PublicKey.default,
    amount: BigInt(1000),
    revertRecipient: PublicKey.default,
  };

  it('should convert hex payload (0x-prefixed) to Buffer', () => {
    const result = buildSvmUniversalTxRequest({
      ...baseArgs,
      payload: '0xdeadbeef' as `0x${string}`,
    });
    expect(Buffer.isBuffer(result.payload)).toBe(true);
    expect(result.payload.length).toBe(4);
    expect(result.payload[0]).toBe(0xde);
    expect(result.payload[3]).toBe(0xef);
  });

  it('should handle empty hex payload (0x)', () => {
    const result = buildSvmUniversalTxRequest({
      ...baseArgs,
      payload: '0x' as `0x${string}`,
    });
    expect(Buffer.isBuffer(result.payload)).toBe(true);
    expect(result.payload.length).toBe(0);
  });

  it('should handle odd-length hex payload by zero-padding', () => {
    const result = buildSvmUniversalTxRequest({
      ...baseArgs,
      payload: '0xabc' as `0x${string}`,
    });
    expect(Buffer.isBuffer(result.payload)).toBe(true);
    // '0xabc' => normalized to '0abc' => 2 bytes
    expect(result.payload.length).toBe(2);
    expect(result.payload[0]).toBe(0x0a);
    expect(result.payload[1]).toBe(0xbc);
  });

  it('should convert Uint8Array payload to Buffer', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const result = buildSvmUniversalTxRequest({
      ...baseArgs,
      payload: bytes as any,
    });
    expect(Buffer.isBuffer(result.payload)).toBe(true);
    expect(result.payload.length).toBe(3);
  });

  it('should handle hex signatureData', () => {
    const result = buildSvmUniversalTxRequest({
      ...baseArgs,
      payload: '0x' as `0x${string}`,
      signatureData: '0xcafe' as `0x${string}`,
    });
    expect(Buffer.isBuffer(result.signatureData)).toBe(true);
    expect(result.signatureData.length).toBe(2);
    expect(result.signatureData[0]).toBe(0xca);
  });

  it('should produce empty signatureData buffer when undefined', () => {
    const result = buildSvmUniversalTxRequest({
      ...baseArgs,
      payload: '0x' as `0x${string}`,
    });
    expect(result.signatureData.length).toBe(0);
  });

  it('should handle empty hex signatureData (0x)', () => {
    const result = buildSvmUniversalTxRequest({
      ...baseArgs,
      payload: '0x' as `0x${string}`,
      signatureData: '0x' as `0x${string}`,
    });
    expect(result.signatureData.length).toBe(0);
  });

  it('should handle Uint8Array signatureData', () => {
    const sig = new Uint8Array([0xff, 0x01]);
    const result = buildSvmUniversalTxRequest({
      ...baseArgs,
      payload: '0x' as `0x${string}`,
      signatureData: sig,
    });
    expect(result.signatureData.length).toBe(2);
    expect(result.signatureData[0]).toBe(0xff);
  });

  it('should pass through recipient, token, amount, revertRecipient', () => {
    const result = buildSvmUniversalTxRequest({
      ...baseArgs,
      payload: '0x' as `0x${string}`,
    });
    expect(result.recipient).toEqual(baseArgs.recipient);
    expect(result.token).toBe(baseArgs.token);
    expect(result.amount).toBe(BigInt(1000));
    expect(result.revertRecipient).toBe(baseArgs.revertRecipient);
  });
});

// ============================================================================
// svm-helpers — buildSvmUniversalTxRequestFromReq
// ============================================================================
describe('buildSvmUniversalTxRequestFromReq', () => {
  const RECIPIENT_HEX =
    '0x000000000000000000000000aabbccddaabbccddaabbccddaabbccddaabbccdd' as `0x${string}`;
  const revertRecipient = PublicKey.default;

  it('should extract first 20 bytes of recipient as number array', () => {
    const req: UniversalTxRequest = {
      recipient: RECIPIENT_HEX,
      token: zeroAddress as `0x${string}`,
      amount: BigInt(100),
      payload: '0x' as `0x${string}`,
      revertInstruction: {
        fundRecipient: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        revertMsg: '0x' as `0x${string}`,
      },
      signatureData: '0x' as `0x${string}`,
    };

    const result = buildSvmUniversalTxRequestFromReq(req, revertRecipient);
    expect(result.recipient).toHaveLength(20);
    // First 20 bytes of RECIPIENT_HEX = 0x00000000000000000000 0000aabbccddaabbccdd
    // subarray(0, 20) => first 20 bytes
    expect(result.recipient[0]).toBe(0);
  });

  it('should map zero address token to PublicKey.default', () => {
    const req: UniversalTxRequest = {
      recipient: RECIPIENT_HEX,
      token: zeroAddress as `0x${string}`,
      amount: BigInt(0),
      payload: '0x' as `0x${string}`,
      revertInstruction: {
        fundRecipient: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        revertMsg: '0x' as `0x${string}`,
      },
      signatureData: '0x' as `0x${string}`,
    };

    const result = buildSvmUniversalTxRequestFromReq(req, revertRecipient);
    expect(result.token.equals(PublicKey.default)).toBe(true);
  });

  it('should convert 0x-prefixed token to a 32-byte PublicKey (zero-padded at left)', () => {
    // A 20-byte EVM address as hex
    const evmToken =
      '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF' as `0x${string}`;
    const req: UniversalTxRequest = {
      recipient: RECIPIENT_HEX,
      token: evmToken,
      amount: BigInt(500),
      payload: '0xab' as `0x${string}`,
      revertInstruction: {
        fundRecipient: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        revertMsg: '0x' as `0x${string}`,
      },
      signatureData: '0x' as `0x${string}`,
    };

    const result = buildSvmUniversalTxRequestFromReq(req, revertRecipient);
    // The PublicKey should be 32 bytes with the 20-byte address right-aligned at offset 12
    const pkBytes = result.token.toBytes();
    expect(pkBytes.length).toBe(32);
    // First 12 bytes should be zero
    for (let i = 0; i < 12; i++) {
      expect(pkBytes[i]).toBe(0);
    }
  });

  it('should throw for non-0x, non-special token format', () => {
    const req: UniversalTxRequest = {
      recipient: RECIPIENT_HEX,
      token: 'SoMeRaNdOmBase58Address' as any,
      amount: BigInt(0),
      payload: '0x' as `0x${string}`,
      revertInstruction: {
        fundRecipient: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        revertMsg: '0x' as `0x${string}`,
      },
      signatureData: '0x' as `0x${string}`,
    };

    expect(() =>
      buildSvmUniversalTxRequestFromReq(req, revertRecipient)
    ).toThrow(/Unsupported token format/);
  });

  it('should use signatureDataOverride when provided', () => {
    const req: UniversalTxRequest = {
      recipient: RECIPIENT_HEX,
      token: zeroAddress as `0x${string}`,
      amount: BigInt(0),
      payload: '0x' as `0x${string}`,
      revertInstruction: {
        fundRecipient: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        revertMsg: '0x' as `0x${string}`,
      },
      signatureData: '0xaaaa' as `0x${string}`,
    };

    const override = '0xbbbb' as `0x${string}`;
    const result = buildSvmUniversalTxRequestFromReq(req, revertRecipient, override);
    // signatureData buffer should come from override, not req.signatureData
    expect(result.signatureData[0]).toBe(0xbb);
  });
});

// ============================================================================
// svm-helpers — getSvmGatewayLogIndexFromTx
// ============================================================================
describe('getSvmGatewayLogIndexFromTx', () => {
  // The SVM gateway event discriminator is '6c9ad829b5ea1d7c' (8 bytes).
  // We need to produce base64 data whose first 8 bytes match this discriminator.
  const discriminatorBytes = Buffer.from('6c9ad829b5ea1d7c', 'hex');
  // Pad to at least 8 bytes
  const eventPayload = Buffer.concat([discriminatorBytes, Buffer.alloc(32)]);
  const eventBase64 = eventPayload.toString('base64');

  function makeLogs(entries: string[]): any {
    return { meta: { logMessages: entries } };
  }

  it('should return 0 when no logs exist', () => {
    expect(getSvmGatewayLogIndexFromTx(null)).toBe(0);
    expect(getSvmGatewayLogIndexFromTx({})).toBe(0);
    expect(getSvmGatewayLogIndexFromTx({ meta: {} })).toBe(0);
    expect(getSvmGatewayLogIndexFromTx({ meta: { logMessages: [] } })).toBe(0);
  });

  it('should return 0 when no matching discriminator found', () => {
    const tx = makeLogs([
      'Program log: something',
      'Program data: AAAAAAAAAA==', // non-matching base64
    ]);
    expect(getSvmGatewayLogIndexFromTx(tx)).toBe(0);
  });

  it('should return index of first match when only one match exists', () => {
    const tx = makeLogs([
      'Program log: invoke',
      'Program data: AAAAAAAAAA==',
      `Program data: ${eventBase64}`,
      'Program log: done',
    ]);
    // Single match at index 2 => lastMatchIndex = 2
    expect(getSvmGatewayLogIndexFromTx(tx)).toBe(2);
  });

  it('should return index of second match when two matches exist', () => {
    const tx = makeLogs([
      'Program log: start',
      `Program data: ${eventBase64}`,
      'Program log: middle',
      `Program data: ${eventBase64}`,
      'Program log: end',
    ]);
    // First match at index 1, second match at index 3 => returns 3
    expect(getSvmGatewayLogIndexFromTx(tx)).toBe(3);
  });

  it('should ignore log lines without "Program data: " prefix', () => {
    const tx = makeLogs([
      `Not a program data line: ${eventBase64}`,
      'Program log: something',
      `Program data: ${eventBase64}`,
    ]);
    expect(getSvmGatewayLogIndexFromTx(tx)).toBe(2);
  });

  it('should skip entries with invalid base64', () => {
    const tx = makeLogs([
      'Program data: !!!invalid-base64!!!',
      `Program data: ${eventBase64}`,
    ]);
    // Invalid base64 is skipped; match at index 1
    expect(getSvmGatewayLogIndexFromTx(tx)).toBe(1);
  });

  it('should skip entries where decoded data is less than 8 bytes', () => {
    const tinyData = Buffer.from([0x6c]).toString('base64'); // only 1 byte
    const tx = makeLogs([
      `Program data: ${tinyData}`,
      `Program data: ${eventBase64}`,
    ]);
    expect(getSvmGatewayLogIndexFromTx(tx)).toBe(1);
  });
});

// ============================================================================
// confirmation — waitForLockerFeeConfirmation routing
// ============================================================================
describe('waitForLockerFeeConfirmation', () => {
  // Because waitForLockerFeeConfirmation calls the inner functions via direct
  // reference (not through module exports), jest.spyOn cannot intercept them.
  // Instead we rely on the mocked EvmClient/SvmClient constructors and use
  // fastConfirmations=0 so the inner functions return immediately (the <= 0
  // early-return path is verified separately below).

  const { EvmClient: MockEvmClient } = jest.requireMock('../../vm-client/evm-client');
  const { SvmClient: MockSvmClient } = jest.requireMock('../../vm-client/svm-client');

  beforeEach(() => {
    MockEvmClient.mockClear();
    MockSvmClient.mockClear();
  });

  function makeConfirmCtx(chain: string): OrchestratorContext {
    return {
      pushClient: {} as any,
      universalSigner: {
        account: { chain, address: '0x1111111111111111111111111111111111111111' },
      } as any,
      pushNetwork: 'TESTNET_DONUT' as any,
      rpcUrls: {},
      printTraces: false,
      accountStatusCache: null,
      progressHook: jest.fn(),
    };
  }

  it('should dispatch to EVM path (construct EvmClient) for EVM chain', async () => {
    // Use Push Chain testnet which has fastConfirmations=0 so inner fn returns immediately
    const ctx = makeConfirmCtx('eip155:42101');
    const txHash = new Uint8Array(32).fill(0xaa);

    await confirmationModule.waitForLockerFeeConfirmation(ctx, txHash);

    expect(MockEvmClient).toHaveBeenCalledTimes(1);
    expect(MockSvmClient).not.toHaveBeenCalled();
    // Verify the EvmClient was constructed with expected rpcUrls
    const constructorArg = MockEvmClient.mock.calls[0][0];
    expect(constructorArg.rpcUrls).toEqual(['https://evm.donut.rpc.push.org/']);
  });

  it('should dispatch to SVM path (construct SvmClient) for SVM chain', async () => {
    // Override CHAIN_INFO so fastConfirmations=0 for the SVM chain too
    const chainMod = jest.requireMock('../../constants/chain');
    const originalFast = chainMod.CHAIN_INFO['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'].fastConfirmations;
    chainMod.CHAIN_INFO['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'].fastConfirmations = 0;

    const ctx = makeConfirmCtx('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
    const txHash = new Uint8Array(32).fill(0xbb);

    await confirmationModule.waitForLockerFeeConfirmation(ctx, txHash);

    expect(MockSvmClient).toHaveBeenCalledTimes(1);
    expect(MockEvmClient).not.toHaveBeenCalled();
    const constructorArg = MockSvmClient.mock.calls[0][0];
    expect(constructorArg.rpcUrls).toEqual(['https://api.devnet.solana.com']);

    // Restore
    chainMod.CHAIN_INFO['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'].fastConfirmations = originalFast;
  });

  it('should use custom rpcUrls from context over defaults', async () => {
    const customRpc = ['https://custom-rpc.example'];
    const ctx = makeConfirmCtx('eip155:42101');
    (ctx as any).rpcUrls = { 'eip155:42101': customRpc } as any;
    const txHash = new Uint8Array(32).fill(0xcc);

    await confirmationModule.waitForLockerFeeConfirmation(ctx, txHash);

    expect(MockEvmClient).toHaveBeenCalledTimes(1);
    const constructorArg = MockEvmClient.mock.calls[0][0];
    expect(constructorArg.rpcUrls).toEqual(customRpc);
  });

  it('should throw for unsupported VM type', async () => {
    const chainMod = jest.requireMock('../../constants/chain');
    const fakeChain = 'cosmos:cosmoshub-4';
    chainMod.CHAIN_INFO[fakeChain] = {
      vm: 'COSMOS' as any,
      defaultRPC: [],
      fastConfirmations: 1,
      timeout: 30000,
    };

    const ctx = makeConfirmCtx(fakeChain);
    const txHash = new Uint8Array(32).fill(0xdd);

    await expect(
      confirmationModule.waitForLockerFeeConfirmation(ctx, txHash)
    ).rejects.toThrow(/Unsupported VM/);

    // Cleanup
    delete chainMod.CHAIN_INFO[fakeChain];
  });
});

// ============================================================================
// confirmation — waitForEvmConfirmationsWithCountdown edge cases
// ============================================================================
describe('waitForEvmConfirmationsWithCountdown', () => {
  it('should return immediately when confirmations <= 0', async () => {
    const ctx = makeConfirmCtx('eip155:42101');
    const mockEvmClient = {
      publicClient: {
        waitForTransactionReceipt: jest.fn(),
        getBlockNumber: jest.fn(),
      },
    } as any;

    await confirmationModule.waitForEvmConfirmationsWithCountdown(
      ctx,
      mockEvmClient,
      '0xabc' as `0x${string}`,
      0,
      30000
    );

    // Should not call waitForTransactionReceipt when confirmations = 0
    expect(mockEvmClient.publicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  function makeConfirmCtx(chain: string): OrchestratorContext {
    return {
      pushClient: {} as any,
      universalSigner: {
        account: { chain, address: '0x1111111111111111111111111111111111111111' },
      } as any,
      pushNetwork: 'TESTNET_DONUT' as any,
      rpcUrls: {},
      printTraces: false,
      accountStatusCache: null,
      progressHook: jest.fn(),
    };
  }
});

// ============================================================================
// confirmation — waitForSvmConfirmationsWithCountdown edge cases
// ============================================================================
describe('waitForSvmConfirmationsWithCountdown', () => {
  function makeConfirmCtx(chain: string): OrchestratorContext {
    return {
      pushClient: {} as any,
      universalSigner: {
        account: { chain, address: '0x1111111111111111111111111111111111111111' },
      } as any,
      pushNetwork: 'TESTNET_DONUT' as any,
      rpcUrls: {},
      printTraces: false,
      accountStatusCache: null,
      progressHook: jest.fn(),
    };
  }

  it('should return immediately when confirmations <= 0', async () => {
    const ctx = makeConfirmCtx('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
    const mockSvmClient = {
      connections: [{ getSignatureStatuses: jest.fn() }],
      currentConnectionIndex: 0,
    } as any;

    await confirmationModule.waitForSvmConfirmationsWithCountdown(
      ctx,
      mockSvmClient,
      'someSig',
      0,
      120000
    );

    // Should not poll for status when confirmations = 0
    expect(
      mockSvmClient.connections[0].getSignatureStatuses
    ).not.toHaveBeenCalled();
  });
});
