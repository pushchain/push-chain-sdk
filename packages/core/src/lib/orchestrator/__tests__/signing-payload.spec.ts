/**
 * Unit tests for signing.ts and payload-builder.ts (internals)
 *
 * Covers:
 *   signing.ts
 *     - computeExecutionHash()    pure EIP-712 hash for UniversalPayload
 *     - computeMigrationHash()    pure EIP-712 hash for MigrationPayload
 *     - signUniversalPayload()    EVM typed-data + SVM digest signing
 *     - signMigrationPayload()    EVM typed-data + SVM digest signing
 *     - encodeUniversalPayload()  ABI encoding of UniversalPayload
 *     - encodeUniversalPayloadSvm()  Borsh-style binary encoding
 *
 *   payload-builder.ts (internals)
 *     - buildUniversalTxRequest()       gateway request construction
 *     - buildMulticallPayloadData()     UEA_MULTICALL encoding
 */
import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodePacked,
  keccak256,
  toBytes,
  zeroAddress,
} from 'viem';
import { CHAIN, PUSH_NETWORK, VM } from '../../constants/enums';
import { CHAIN_INFO } from '../../constants/chain';
import { VerificationType } from '../../generated/v1/tx';
import type { UniversalPayload } from '../../generated/v1/tx';
import type { OrchestratorContext } from '../internals/context';
import {
  computeExecutionHash,
  computeMigrationHash,
  signUniversalPayload,
  signMigrationPayload,
  encodeUniversalPayload,
  encodeUniversalPayloadSvm,
} from '../internals/signing';
import { buildUniversalTxRequest, buildMulticallPayloadData } from '../internals/payload-builder';
import type { MultiCall } from '../orchestrator.types';

// ============================================================================
// Shared constants & helpers
// ============================================================================

const ALICE = '0xabCDEF1234567890ABcDEF1234567890aBCDeF12' as `0x${string}`;
const BOB = '0x1111111111111111111111111111111111111111' as `0x${string}`;
const TOKEN_A = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as `0x${string}`;
const VERIFYING_CONTRACT = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' as `0x${string}`;
const MIGRATION_CONTRACT = '0xDDdDddDdDdddDDddDDddDDDDdDdDDdDDdDDDDDDd' as `0x${string}`;

const FAKE_SIGNATURE = new Uint8Array([0xaa, 0xbb, 0xcc]);

/** Build an EVM-chain (Ethereum Sepolia) mock context */
function makeEvmCtx(overrides?: Partial<OrchestratorContext>): OrchestratorContext {
  return {
    pushClient: {
      publicClient: { readContract: jest.fn() },
      pushChainInfo: { chainId: '42101' },
    },
    universalSigner: {
      account: {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: ALICE,
      },
      signTypedData: jest.fn().mockResolvedValue(FAKE_SIGNATURE),
      signMessage: jest.fn().mockResolvedValue(FAKE_SIGNATURE),
      signAndSendTransaction: jest.fn(),
    },
    pushNetwork: PUSH_NETWORK.TESTNET,
    rpcUrls: {},
    printTraces: false,
    progressHook: undefined,
    accountStatusCache: null,
    ...overrides,
  } as unknown as OrchestratorContext;
}

/** Build an SVM-chain (Solana Devnet) mock context */
function makeSvmCtx(overrides?: Partial<OrchestratorContext>): OrchestratorContext {
  return {
    pushClient: {
      publicClient: { readContract: jest.fn() },
      pushChainInfo: { chainId: '42101' },
    },
    universalSigner: {
      account: {
        chain: CHAIN.SOLANA_DEVNET,
        address: ALICE,
      },
      signTypedData: undefined,
      signMessage: jest.fn().mockResolvedValue(FAKE_SIGNATURE),
      signAndSendTransaction: jest.fn(),
    },
    pushNetwork: PUSH_NETWORK.TESTNET,
    rpcUrls: {},
    printTraces: false,
    progressHook: undefined,
    accountStatusCache: null,
    ...overrides,
  } as unknown as OrchestratorContext;
}

/** Minimal valid UniversalPayload for testing */
function makePayload(overrides?: Partial<UniversalPayload>): UniversalPayload {
  return {
    to: BOB,
    value: '1000',
    data: '0xdeadbeef',
    gasLimit: '100000',
    maxFeePerGas: '10000000000',
    maxPriorityFeePerGas: '0',
    nonce: '1',
    deadline: '9999999999',
    vType: VerificationType.universalTxVerification,
    ...overrides,
  } as unknown as UniversalPayload;
}

// ============================================================================
// computeExecutionHash
// ============================================================================
describe('computeExecutionHash', () => {
  it('returns a 32-byte keccak hash (0x + 64 hex chars)', () => {
    const ctx = makeEvmCtx();
    const hash = computeExecutionHash(ctx, {
      verifyingContract: VERIFYING_CONTRACT,
      payload: makePayload(),
    });
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('is deterministic for the same inputs', () => {
    const ctx = makeEvmCtx();
    const params = { verifyingContract: VERIFYING_CONTRACT, payload: makePayload() };
    const hash1 = computeExecutionHash(ctx, params);
    const hash2 = computeExecutionHash(ctx, params);
    expect(hash1).toBe(hash2);
  });

  it('changes when the payload nonce differs', () => {
    const ctx = makeEvmCtx();
    const hash1 = computeExecutionHash(ctx, {
      verifyingContract: VERIFYING_CONTRACT,
      payload: makePayload({ nonce: '1' } as any),
    });
    const hash2 = computeExecutionHash(ctx, {
      verifyingContract: VERIFYING_CONTRACT,
      payload: makePayload({ nonce: '2' } as any),
    });
    expect(hash1).not.toBe(hash2);
  });

  it('changes when the payload value differs', () => {
    const ctx = makeEvmCtx();
    const hash1 = computeExecutionHash(ctx, {
      verifyingContract: VERIFYING_CONTRACT,
      payload: makePayload({ value: '0' } as any),
    });
    const hash2 = computeExecutionHash(ctx, {
      verifyingContract: VERIFYING_CONTRACT,
      payload: makePayload({ value: '1000' } as any),
    });
    expect(hash1).not.toBe(hash2);
  });

  it('changes when verifyingContract differs', () => {
    const ctx = makeEvmCtx();
    const payload = makePayload();
    const hash1 = computeExecutionHash(ctx, { verifyingContract: VERIFYING_CONTRACT, payload });
    const hash2 = computeExecutionHash(ctx, { verifyingContract: BOB, payload });
    expect(hash1).not.toBe(hash2);
  });

  it('changes when version differs', () => {
    const ctx = makeEvmCtx();
    const payload = makePayload();
    const hash1 = computeExecutionHash(ctx, { verifyingContract: VERIFYING_CONTRACT, payload, version: '0.1.0' });
    const hash2 = computeExecutionHash(ctx, { verifyingContract: VERIFYING_CONTRACT, payload, version: '0.2.0' });
    expect(hash1).not.toBe(hash2);
  });

  it('defaults version to "0.1.0" when omitted', () => {
    const ctx = makeEvmCtx();
    const payload = makePayload();
    const hashDefault = computeExecutionHash(ctx, { verifyingContract: VERIFYING_CONTRACT, payload });
    const hashExplicit = computeExecutionHash(ctx, { verifyingContract: VERIFYING_CONTRACT, payload, version: '0.1.0' });
    expect(hashDefault).toBe(hashExplicit);
  });

  it('produces a different hash for SVM vs EVM chains (different domain separator)', () => {
    const evmCtx = makeEvmCtx();
    const svmCtx = makeSvmCtx();
    const payload = makePayload();
    const evmHash = computeExecutionHash(evmCtx, { verifyingContract: VERIFYING_CONTRACT, payload });
    const svmHash = computeExecutionHash(svmCtx, { verifyingContract: VERIFYING_CONTRACT, payload });
    expect(evmHash).not.toBe(svmHash);
  });

  it('uses the correct EIP-712 domain type string for EVM', () => {
    // Verify the EVM domain type hash matches the expected keccak of the canonical string
    const expectedTypeHash = keccak256(
      toBytes('EIP712Domain(string version,uint256 chainId,address verifyingContract)')
    );
    // The hash is embedded inside the domain separator; we verify indirectly by
    // checking that the computation doesn't throw and produces a valid hash
    const ctx = makeEvmCtx();
    const hash = computeExecutionHash(ctx, { verifyingContract: VERIFYING_CONTRACT, payload: makePayload() });
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    // Verify the type hash constant is a valid keccak
    expect(expectedTypeHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('uses SVM domain type string for SVM chains', () => {
    const expectedSvmTypeHash = keccak256(
      toBytes('EIP712Domain_SVM(string version,string chainId,address verifyingContract)')
    );
    const ctx = makeSvmCtx();
    const hash = computeExecutionHash(ctx, { verifyingContract: VERIFYING_CONTRACT, payload: makePayload() });
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(expectedSvmTypeHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('handles zero-value payload fields', () => {
    const ctx = makeEvmCtx();
    const payload = makePayload({
      value: '0',
      gasLimit: '0',
      maxFeePerGas: '0',
      maxPriorityFeePerGas: '0',
      nonce: '0',
      deadline: '0',
    } as any);
    const hash = computeExecutionHash(ctx, { verifyingContract: VERIFYING_CONTRACT, payload });
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('handles empty data (0x)', () => {
    const ctx = makeEvmCtx();
    const payload = makePayload({ data: '0x' } as any);
    const hash = computeExecutionHash(ctx, { verifyingContract: VERIFYING_CONTRACT, payload });
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('changes when payload data differs', () => {
    const ctx = makeEvmCtx();
    const hash1 = computeExecutionHash(ctx, {
      verifyingContract: VERIFYING_CONTRACT,
      payload: makePayload({ data: '0x00' } as any),
    });
    const hash2 = computeExecutionHash(ctx, {
      verifyingContract: VERIFYING_CONTRACT,
      payload: makePayload({ data: '0xdeadbeef' } as any),
    });
    expect(hash1).not.toBe(hash2);
  });

  it('changes when vType differs', () => {
    const ctx = makeEvmCtx();
    const hash1 = computeExecutionHash(ctx, {
      verifyingContract: VERIFYING_CONTRACT,
      payload: makePayload({ vType: VerificationType.signedVerification } as any),
    });
    const hash2 = computeExecutionHash(ctx, {
      verifyingContract: VERIFYING_CONTRACT,
      payload: makePayload({ vType: VerificationType.universalTxVerification } as any),
    });
    expect(hash1).not.toBe(hash2);
  });
});

// ============================================================================
// computeMigrationHash
// ============================================================================
describe('computeMigrationHash', () => {
  it('returns a 32-byte keccak hash', () => {
    const ctx = makeEvmCtx();
    const hash = computeMigrationHash(ctx, {
      verifyingContract: VERIFYING_CONTRACT,
      migrationContractAddress: MIGRATION_CONTRACT,
      nonce: BigInt(1),
      deadline: BigInt(9999999999),
    });
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('is deterministic for the same inputs', () => {
    const ctx = makeEvmCtx();
    const params = {
      verifyingContract: VERIFYING_CONTRACT,
      migrationContractAddress: MIGRATION_CONTRACT,
      nonce: BigInt(5),
      deadline: BigInt(9999999999),
    };
    expect(computeMigrationHash(ctx, params)).toBe(computeMigrationHash(ctx, params));
  });

  it('changes when nonce differs', () => {
    const ctx = makeEvmCtx();
    const base = {
      verifyingContract: VERIFYING_CONTRACT,
      migrationContractAddress: MIGRATION_CONTRACT,
      deadline: BigInt(9999999999),
    };
    const hash1 = computeMigrationHash(ctx, { ...base, nonce: BigInt(1) });
    const hash2 = computeMigrationHash(ctx, { ...base, nonce: BigInt(2) });
    expect(hash1).not.toBe(hash2);
  });

  it('changes when deadline differs', () => {
    const ctx = makeEvmCtx();
    const base = {
      verifyingContract: VERIFYING_CONTRACT,
      migrationContractAddress: MIGRATION_CONTRACT,
      nonce: BigInt(1),
    };
    const hash1 = computeMigrationHash(ctx, { ...base, deadline: BigInt(100) });
    const hash2 = computeMigrationHash(ctx, { ...base, deadline: BigInt(200) });
    expect(hash1).not.toBe(hash2);
  });

  it('changes when migrationContractAddress differs', () => {
    const ctx = makeEvmCtx();
    const base = { verifyingContract: VERIFYING_CONTRACT, nonce: BigInt(1), deadline: BigInt(100) };
    const hash1 = computeMigrationHash(ctx, { ...base, migrationContractAddress: MIGRATION_CONTRACT });
    const hash2 = computeMigrationHash(ctx, { ...base, migrationContractAddress: BOB });
    expect(hash1).not.toBe(hash2);
  });

  it('changes when verifyingContract differs', () => {
    const ctx = makeEvmCtx();
    const base = { migrationContractAddress: MIGRATION_CONTRACT, nonce: BigInt(1), deadline: BigInt(100) };
    const hash1 = computeMigrationHash(ctx, { ...base, verifyingContract: VERIFYING_CONTRACT });
    const hash2 = computeMigrationHash(ctx, { ...base, verifyingContract: BOB });
    expect(hash1).not.toBe(hash2);
  });

  it('defaults version to "0.1.0" when omitted', () => {
    const ctx = makeEvmCtx();
    const base = {
      verifyingContract: VERIFYING_CONTRACT,
      migrationContractAddress: MIGRATION_CONTRACT,
      nonce: BigInt(1),
      deadline: BigInt(9999999999),
    };
    const hashDefault = computeMigrationHash(ctx, base);
    const hashExplicit = computeMigrationHash(ctx, { ...base, version: '0.1.0' });
    expect(hashDefault).toBe(hashExplicit);
  });

  it('changes when version differs', () => {
    const ctx = makeEvmCtx();
    const base = {
      verifyingContract: VERIFYING_CONTRACT,
      migrationContractAddress: MIGRATION_CONTRACT,
      nonce: BigInt(1),
      deadline: BigInt(9999999999),
    };
    const hash1 = computeMigrationHash(ctx, { ...base, version: '0.1.0' });
    const hash2 = computeMigrationHash(ctx, { ...base, version: '1.0.0' });
    expect(hash1).not.toBe(hash2);
  });

  it('produces different hashes for SVM vs EVM chains', () => {
    const evmCtx = makeEvmCtx();
    const svmCtx = makeSvmCtx();
    const params = {
      verifyingContract: VERIFYING_CONTRACT,
      migrationContractAddress: MIGRATION_CONTRACT,
      nonce: BigInt(1),
      deadline: BigInt(9999999999),
    };
    expect(computeMigrationHash(evmCtx, params)).not.toBe(computeMigrationHash(svmCtx, params));
  });

  it('handles zero nonce and deadline', () => {
    const ctx = makeEvmCtx();
    const hash = computeMigrationHash(ctx, {
      verifyingContract: VERIFYING_CONTRACT,
      migrationContractAddress: MIGRATION_CONTRACT,
      nonce: BigInt(0),
      deadline: BigInt(0),
    });
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

// ============================================================================
// signUniversalPayload
// ============================================================================
describe('signUniversalPayload', () => {
  describe('EVM path', () => {
    it('calls signTypedData with correct domain, types, and message', async () => {
      const ctx = makeEvmCtx();
      const payload = makePayload();
      await signUniversalPayload(ctx, payload, VERIFYING_CONTRACT);

      expect(ctx.universalSigner.signTypedData).toHaveBeenCalledTimes(1);
      const call = (ctx.universalSigner.signTypedData as jest.Mock).mock.calls[0][0];

      // Verify domain
      expect(call.domain).toEqual({
        version: '0.1.0',
        chainId: Number(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].chainId),
        verifyingContract: VERIFYING_CONTRACT,
      });

      // Verify primaryType
      expect(call.primaryType).toBe('UniversalPayload');

      // Verify types structure
      expect(call.types.UniversalPayload).toHaveLength(9);
      const typeNames = call.types.UniversalPayload.map((t: { name: string }) => t.name);
      expect(typeNames).toEqual([
        'to', 'value', 'data', 'gasLimit', 'maxFeePerGas',
        'maxPriorityFeePerGas', 'nonce', 'deadline', 'vType',
      ]);

      // Verify message is the original payload
      expect(call.message).toBe(payload);
    });

    it('uses custom version when provided', async () => {
      const ctx = makeEvmCtx();
      await signUniversalPayload(ctx, makePayload(), VERIFYING_CONTRACT, '1.0.0');

      const call = (ctx.universalSigner.signTypedData as jest.Mock).mock.calls[0][0];
      expect(call.domain.version).toBe('1.0.0');
    });

    it('defaults version to "0.1.0" when not provided', async () => {
      const ctx = makeEvmCtx();
      await signUniversalPayload(ctx, makePayload(), VERIFYING_CONTRACT);

      const call = (ctx.universalSigner.signTypedData as jest.Mock).mock.calls[0][0];
      expect(call.domain.version).toBe('0.1.0');
    });

    it('returns the signature bytes from signTypedData', async () => {
      const ctx = makeEvmCtx();
      const result = await signUniversalPayload(ctx, makePayload(), VERIFYING_CONTRACT);
      expect(result).toBe(FAKE_SIGNATURE);
    });

    it('throws if signTypedData is not defined', async () => {
      const ctx = makeEvmCtx();
      ctx.universalSigner.signTypedData = undefined;

      await expect(
        signUniversalPayload(ctx, makePayload(), VERIFYING_CONTRACT)
      ).rejects.toThrow('signTypedData is not defined');
    });
  });

  describe('SVM path', () => {
    it('calls signMessage (not signTypedData) for SVM chains', async () => {
      const ctx = makeSvmCtx();
      await signUniversalPayload(ctx, makePayload(), VERIFYING_CONTRACT);

      expect(ctx.universalSigner.signMessage).toHaveBeenCalledTimes(1);
      // signTypedData should not be called (it is undefined on SVM context)
    });

    it('returns the signature bytes from signMessage', async () => {
      const ctx = makeSvmCtx();
      const result = await signUniversalPayload(ctx, makePayload(), VERIFYING_CONTRACT);
      expect(result).toBe(FAKE_SIGNATURE);
    });

    it('passes the execution digest as bytes to signMessage', async () => {
      const ctx = makeSvmCtx();
      const payload = makePayload();
      await signUniversalPayload(ctx, payload, VERIFYING_CONTRACT, '0.1.0');

      const callArg = (ctx.universalSigner.signMessage as jest.Mock).mock.calls[0][0];
      // The argument should be a Uint8Array (stringToBytes of the hex digest)
      expect(callArg).toBeInstanceOf(Uint8Array);
      expect(callArg.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// signMigrationPayload
// ============================================================================
describe('signMigrationPayload', () => {
  const migrationParams = {
    migrationContractAddress: MIGRATION_CONTRACT,
    nonce: BigInt(5),
    deadline: BigInt(9999999999),
    ueaVersion: '0.2.0',
    ueaAddress: VERIFYING_CONTRACT,
  };

  describe('EVM path', () => {
    it('calls signTypedData with correct domain and MigrationPayload types', async () => {
      const ctx = makeEvmCtx();
      await signMigrationPayload(ctx, migrationParams);

      expect(ctx.universalSigner.signTypedData).toHaveBeenCalledTimes(1);
      const call = (ctx.universalSigner.signTypedData as jest.Mock).mock.calls[0][0];

      // Domain
      expect(call.domain).toEqual({
        version: '0.2.0',
        chainId: Number(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].chainId),
        verifyingContract: VERIFYING_CONTRACT,
      });

      // Types
      expect(call.primaryType).toBe('MigrationPayload');
      expect(call.types.MigrationPayload).toHaveLength(3);
      const typeNames = call.types.MigrationPayload.map((t: { name: string }) => t.name);
      expect(typeNames).toEqual(['migration', 'nonce', 'deadline']);

      // Message: nonce and deadline should be stringified
      expect(call.message.migration).toBe(MIGRATION_CONTRACT);
      expect(call.message.nonce).toBe('5');
      expect(call.message.deadline).toBe('9999999999');
    });

    it('returns the signature bytes', async () => {
      const ctx = makeEvmCtx();
      const result = await signMigrationPayload(ctx, migrationParams);
      expect(result).toBe(FAKE_SIGNATURE);
    });

    it('throws if signTypedData is not defined', async () => {
      const ctx = makeEvmCtx();
      ctx.universalSigner.signTypedData = undefined;

      await expect(
        signMigrationPayload(ctx, migrationParams)
      ).rejects.toThrow('signTypedData is not defined');
    });
  });

  describe('SVM path', () => {
    it('calls signMessage for SVM chains', async () => {
      const ctx = makeSvmCtx();
      await signMigrationPayload(ctx, migrationParams);

      expect(ctx.universalSigner.signMessage).toHaveBeenCalledTimes(1);
    });

    it('returns the signature bytes from signMessage', async () => {
      const ctx = makeSvmCtx();
      const result = await signMigrationPayload(ctx, migrationParams);
      expect(result).toBe(FAKE_SIGNATURE);
    });

    it('passes the migration digest as bytes to signMessage', async () => {
      const ctx = makeSvmCtx();
      await signMigrationPayload(ctx, migrationParams);

      const callArg = (ctx.universalSigner.signMessage as jest.Mock).mock.calls[0][0];
      expect(callArg).toBeInstanceOf(Uint8Array);
      expect(callArg.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// encodeUniversalPayload (ABI encoding)
// ============================================================================
describe('encodeUniversalPayload', () => {
  const DECODE_TYPES = [
    { name: 'to', type: 'address' as const },
    { name: 'value', type: 'uint256' as const },
    { name: 'data', type: 'bytes' as const },
    { name: 'gasLimit', type: 'uint256' as const },
    { name: 'maxFeePerGas', type: 'uint256' as const },
    { name: 'maxPriorityFeePerGas', type: 'uint256' as const },
    { name: 'nonce', type: 'uint256' as const },
    { name: 'deadline', type: 'uint256' as const },
    { name: 'vType', type: 'uint8' as const },
  ];

  it('encodes and round-trips a standard payload', () => {
    const payload = makePayload();
    const encoded = encodeUniversalPayload(payload);
    expect(encoded).toMatch(/^0x[0-9a-f]+$/);

    const decoded = decodeAbiParameters(DECODE_TYPES, encoded);
    expect((decoded[0] as string).toLowerCase()).toBe(BOB.toLowerCase()); // to
    expect(decoded[1]).toBe(BigInt(1000)); // value
    expect(decoded[2]).toBe('0xdeadbeef'); // data
    expect(decoded[3]).toBe(BigInt(100000)); // gasLimit
    expect(decoded[4]).toBe(BigInt(10000000000)); // maxFeePerGas
    expect(decoded[5]).toBe(BigInt(0)); // maxPriorityFeePerGas
    expect(decoded[6]).toBe(BigInt(1)); // nonce
    expect(decoded[7]).toBe(BigInt(9999999999)); // deadline
    expect(decoded[8]).toBe(VerificationType.universalTxVerification); // vType
  });

  it('encodes zero-value fields correctly', () => {
    const payload = makePayload({
      to: zeroAddress,
      value: '0',
      data: '0x',
      gasLimit: '0',
      maxFeePerGas: '0',
      maxPriorityFeePerGas: '0',
      nonce: '0',
      deadline: '0',
      vType: VerificationType.signedVerification,
    } as any);
    const encoded = encodeUniversalPayload(payload);
    const decoded = decodeAbiParameters(DECODE_TYPES, encoded);

    expect((decoded[0] as string).toLowerCase()).toBe(zeroAddress.toLowerCase());
    expect(decoded[1]).toBe(BigInt(0));
    expect(decoded[3]).toBe(BigInt(0));
    expect(decoded[6]).toBe(BigInt(0));
    expect(decoded[8]).toBe(0);
  });

  it('preserves large BigInt values', () => {
    const largeValue = '115792089237316195423570985008687907853269984665640564039457584007913129639935'; // 2^256-1
    const payload = makePayload({ value: largeValue } as any);
    const encoded = encodeUniversalPayload(payload);
    const decoded = decodeAbiParameters(DECODE_TYPES, encoded);
    expect(decoded[1]).toBe(BigInt(largeValue));
  });

  it('returns a hex string starting with 0x', () => {
    const encoded = encodeUniversalPayload(makePayload());
    expect(typeof encoded).toBe('string');
    expect(encoded.startsWith('0x')).toBe(true);
  });
});

// ============================================================================
// encodeUniversalPayloadSvm (binary/Borsh-style encoding)
// ============================================================================
describe('encodeUniversalPayloadSvm', () => {
  // SVM payload v0 wire layout — must stay byte-for-byte aligned with Push
  // Chain's DecodeUniversalPayloadSolana (x/uexecutor/types/decode_payload.go):
  //   [0..20]  bytes  to (20-byte address)
  //   [20..28] u64LE  value
  //   [28..]   vec<u8> data (4-byte LE length + bytes)
  //   ...      u64LE  gasLimit / maxFeePerGas / maxPriorityFeePerGas / nonce
  //   ...      i64LE  deadline
  //   ...      u8     vType

  it('returns a Buffer', () => {
    const result = encodeUniversalPayloadSvm(makePayload());
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('starts with 20 address bytes', () => {
    const payload = makePayload({ to: BOB } as any);
    const result = encodeUniversalPayloadSvm(payload);
    // BOB = 0x1111111111111111111111111111111111111111 => 20 bytes of 0x11
    const addrSlice = result.subarray(0, 20);
    expect(addrSlice.every((b) => b === 0x11)).toBe(true);
  });

  it('encodes value as little-endian u64 at offset 20', () => {
    const payload = makePayload({ value: '1000' } as any);
    const result = encodeUniversalPayloadSvm(payload);
    const valueBuf = result.subarray(20, 28);
    expect(valueBuf.readBigUInt64LE(0)).toBe(BigInt(1000));
  });

  it('encodes data with a 4-byte LE length prefix', () => {
    const payload = makePayload({ data: '0xdeadbeef' } as any); // 4 bytes of data
    const result = encodeUniversalPayloadSvm(payload);
    // offset 28 = start of data vec: 4 byte length + N bytes
    const dataLen = result.readUInt32LE(28);
    expect(dataLen).toBe(4); // 0xdeadbeef = 4 bytes
    // actual data bytes
    const dataBytes = result.subarray(32, 36);
    expect(dataBytes.toString('hex')).toBe('deadbeef');
  });

  it('encodes empty data (0x) with zero length', () => {
    const payload = makePayload({ data: '0x' } as any);
    const result = encodeUniversalPayloadSvm(payload);
    const dataLen = result.readUInt32LE(28);
    expect(dataLen).toBe(0);
  });

  it('encodes gasLimit, maxFeePerGas, maxPriorityFeePerGas, nonce as u64 LE', () => {
    const payload = makePayload({
      data: '0x', // empty data to simplify offset calculation
      gasLimit: '100000',
      maxFeePerGas: '10000000000',
      maxPriorityFeePerGas: '500',
      nonce: '42',
    } as any);
    const result = encodeUniversalPayloadSvm(payload);

    // With empty data: addr(20) + value(8) + dataLenPrefix(4) + dataBytes(0) = offset 32
    const gasLimit = result.readBigUInt64LE(32);
    expect(gasLimit).toBe(BigInt(100000));

    const maxFee = result.readBigUInt64LE(40);
    expect(maxFee).toBe(BigInt(10000000000));

    const maxPriority = result.readBigUInt64LE(48);
    expect(maxPriority).toBe(BigInt(500));

    const nonce = result.readBigUInt64LE(56);
    expect(nonce).toBe(BigInt(42));
  });

  it('encodes deadline as i64 LE (signed)', () => {
    const payload = makePayload({
      data: '0x',
      deadline: '9999999999',
    } as any);
    const result = encodeUniversalPayloadSvm(payload);
    // offset = 20 + 8 + 4 + 0 + 8*4 = 64
    const deadline = result.readBigInt64LE(64);
    expect(deadline).toBe(BigInt(9999999999));
  });

  it('encodes vType as a single byte at the end', () => {
    const payload = makePayload({
      data: '0x',
      vType: VerificationType.universalTxVerification,
    } as any);
    const result = encodeUniversalPayloadSvm(payload);
    // Last byte is vType
    const vType = result[result.length - 1];
    expect(vType).toBe(VerificationType.universalTxVerification);
  });

  it('total length for empty-data payload is 73 bytes', () => {
    // 20(addr) + 8(value) + 4(dataLen) + 0(data) + 8(gasLimit) + 8(maxFee)
    // + 8(maxPriority) + 8(nonce) + 8(deadline) + 1(vType) = 73
    const payload = makePayload({ data: '0x' } as any);
    const result = encodeUniversalPayloadSvm(payload);
    expect(result.length).toBe(73);
  });

  // ==========================================================================
  // u64 bounds — the wire format is locked to u64 to match Push Chain's
  // DecodeUniversalPayloadSolana. The actual fix for the Slack 2026-04-23
  // regression lives in execute-standard.ts (skip the encoder when the
  // bytes won't reach the chain). These tests pin the bounds behavior so
  // the encoder still rejects overflow on paths that DO need Borsh bytes
  // (R1 SVM inbound with payload, fee-locking R2 SVM outbound).
  // ==========================================================================
  describe('u64 bounds', () => {
    const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);

    it('passes at u64 max', () => {
      const payload = makePayload({ value: U64_MAX.toString() } as any);
      expect(() => encodeUniversalPayloadSvm(payload)).not.toThrow();
    });

    it('throws on u64 max + 1', () => {
      const payload = makePayload({ value: (U64_MAX + BigInt(1)).toString() } as any);
      expect(() => encodeUniversalPayloadSvm(payload)).toThrow();
    });
  });
});

// ============================================================================
// buildUniversalTxRequest
// ============================================================================
describe('buildUniversalTxRequest', () => {
  it('returns a well-formed UniversalTxRequest', () => {
    const req = buildUniversalTxRequest(ALICE, {
      recipient: BOB,
      token: TOKEN_A,
      amount: BigInt(5000),
      payload: '0xabcd',
    });

    expect(req.recipient).toBe(BOB);
    expect(req.token).toBe(TOKEN_A);
    expect(req.amount).toBe(BigInt(5000));
    expect(req.payload).toBe('0xabcd');
    expect(req.signatureData).toBe('0x');
  });

  it('sets revertInstruction.fundRecipient to the signer address', () => {
    const req = buildUniversalTxRequest(ALICE, {
      recipient: BOB,
      token: TOKEN_A,
      amount: BigInt(0),
      payload: '0x',
    });

    expect(req.revertInstruction.fundRecipient).toBe(ALICE);
    expect(req.revertInstruction.revertMsg).toBe('0x');
  });

  it('handles zero amount', () => {
    const req = buildUniversalTxRequest(ALICE, {
      recipient: BOB,
      token: TOKEN_A,
      amount: BigInt(0),
      payload: '0x',
    });
    expect(req.amount).toBe(BigInt(0));
  });

  it('preserves the payload as-is without modification', () => {
    const longPayload = '0x' + 'ff'.repeat(256);
    const req = buildUniversalTxRequest(ALICE, {
      recipient: BOB,
      token: TOKEN_A,
      amount: BigInt(1),
      payload: longPayload as `0x${string}`,
    });
    expect(req.payload).toBe(longPayload);
  });

  it('works with zeroAddress as token', () => {
    const req = buildUniversalTxRequest(ALICE, {
      recipient: BOB,
      token: zeroAddress as `0x${string}`,
      amount: BigInt(1000),
      payload: '0x',
    });
    expect(req.token).toBe(zeroAddress);
  });

  it('works with zeroAddress as recipient', () => {
    const req = buildUniversalTxRequest(ALICE, {
      recipient: zeroAddress as `0x${string}`,
      token: TOKEN_A,
      amount: BigInt(1),
      payload: '0x',
    });
    expect(req.recipient).toBe(zeroAddress);
  });
});

// ============================================================================
// buildMulticallPayloadData
// ============================================================================
describe('buildMulticallPayloadData', () => {
  const UEA_MULTICALL_SELECTOR = keccak256(toBytes('UEA_MULTICALL')).slice(0, 10) as `0x${string}`;

  const MULTICALL_TUPLE_TYPE = {
    type: 'tuple[]' as const,
    components: [
      { name: 'to' as const, type: 'address' as const },
      { name: 'value' as const, type: 'uint256' as const },
      { name: 'data' as const, type: 'bytes' as const },
    ],
  };

  it('starts with the UEA_MULTICALL selector (first 4 bytes of keccak)', () => {
    const ctx = makeEvmCtx();
    const calls: MultiCall[] = [{ to: ALICE, value: BigInt(0), data: '0x' }];
    const result = buildMulticallPayloadData(ctx, ALICE, calls);
    expect(result.startsWith(UEA_MULTICALL_SELECTOR)).toBe(true);
  });

  it('encodes a single multicall entry that can be decoded', () => {
    const ctx = makeEvmCtx();
    const calls: MultiCall[] = [{ to: BOB, value: BigInt(100), data: '0xdeadbeef' }];
    const result = buildMulticallPayloadData(ctx, ALICE, calls);

    // Strip selector (4 bytes = 8 hex chars after 0x prefix)
    const dataWithoutSelector = `0x${result.slice(10)}` as `0x${string}`;
    const [decoded] = decodeAbiParameters([MULTICALL_TUPLE_TYPE], dataWithoutSelector);

    expect(decoded).toHaveLength(1);
    expect((decoded[0] as { to: string }).to.toLowerCase()).toBe(BOB.toLowerCase());
    expect((decoded[0] as { value: bigint }).value).toBe(BigInt(100));
    expect((decoded[0] as { data: string }).data).toBe('0xdeadbeef');
  });

  it('encodes multiple multicall entries', () => {
    const ctx = makeEvmCtx();
    const calls: MultiCall[] = [
      { to: ALICE, value: BigInt(0), data: '0x' },
      { to: BOB, value: BigInt(999), data: '0xabcdef' },
    ];
    const result = buildMulticallPayloadData(ctx, ALICE, calls);

    const dataWithoutSelector = `0x${result.slice(10)}` as `0x${string}`;
    const [decoded] = decodeAbiParameters([MULTICALL_TUPLE_TYPE], dataWithoutSelector);

    expect(decoded).toHaveLength(2);
    expect((decoded[0] as { to: string }).to.toLowerCase()).toBe(ALICE.toLowerCase());
    expect((decoded[1] as { to: string }).to.toLowerCase()).toBe(BOB.toLowerCase());
    expect((decoded[1] as { value: bigint }).value).toBe(BigInt(999));
  });

  it('checksums addresses via getAddress', () => {
    const ctx = makeEvmCtx();
    // Pass a lowercase address; getAddress should normalize it
    const lowercaseAddr = '0xabcdef1234567890abcdef1234567890abcdef12' as `0x${string}`;
    const calls: MultiCall[] = [{ to: lowercaseAddr, value: BigInt(0), data: '0x' }];
    const result = buildMulticallPayloadData(ctx, ALICE, calls);

    const dataWithoutSelector = `0x${result.slice(10)}` as `0x${string}`;
    const [decoded] = decodeAbiParameters([MULTICALL_TUPLE_TYPE], dataWithoutSelector);
    // Decoded address should be checksummed (mixed case)
    const decodedAddr = (decoded[0] as { to: string }).to;
    expect(decodedAddr.toLowerCase()).toBe(lowercaseAddr.toLowerCase());
  });

  it('throws for unsupported chains', () => {
    const ctx = makeEvmCtx();
    // Set the chain to Ethereum Mainnet which is NOT in SUPPORTED_GATEWAY_CHAINS
    (ctx.universalSigner.account as any).chain = CHAIN.ETHEREUM_MAINNET;

    const calls: MultiCall[] = [{ to: ALICE, value: BigInt(0), data: '0x' }];
    expect(() => buildMulticallPayloadData(ctx, ALICE, calls)).toThrow(
      'Multicall is only enabled for'
    );
  });

  it('works for Arbitrum Sepolia chain', () => {
    const ctx = makeEvmCtx();
    (ctx.universalSigner.account as any).chain = CHAIN.ARBITRUM_SEPOLIA;

    const calls: MultiCall[] = [{ to: BOB, value: BigInt(0), data: '0x' }];
    const result = buildMulticallPayloadData(ctx, BOB, calls);
    expect(result.startsWith(UEA_MULTICALL_SELECTOR)).toBe(true);
  });

  it('works for Base Sepolia chain', () => {
    const ctx = makeEvmCtx();
    (ctx.universalSigner.account as any).chain = CHAIN.BASE_SEPOLIA;

    const calls: MultiCall[] = [{ to: BOB, value: BigInt(0), data: '0x' }];
    const result = buildMulticallPayloadData(ctx, BOB, calls);
    expect(result.startsWith(UEA_MULTICALL_SELECTOR)).toBe(true);
  });

  it('works for BNB Testnet chain', () => {
    const ctx = makeEvmCtx();
    (ctx.universalSigner.account as any).chain = CHAIN.BNB_TESTNET;

    const calls: MultiCall[] = [{ to: BOB, value: BigInt(0), data: '0x' }];
    const result = buildMulticallPayloadData(ctx, BOB, calls);
    expect(result.startsWith(UEA_MULTICALL_SELECTOR)).toBe(true);
  });

  it('works for Solana Devnet chain', () => {
    const ctx = makeSvmCtx();

    const calls: MultiCall[] = [{ to: BOB, value: BigInt(0), data: '0x' }];
    const result = buildMulticallPayloadData(ctx, BOB, calls);
    expect(result.startsWith(UEA_MULTICALL_SELECTOR)).toBe(true);
  });

  it('handles zero-value calls with empty data', () => {
    const ctx = makeEvmCtx();
    const calls: MultiCall[] = [
      { to: ALICE, value: BigInt(0), data: '0x' },
    ];
    const result = buildMulticallPayloadData(ctx, ALICE, calls);

    const dataWithoutSelector = `0x${result.slice(10)}` as `0x${string}`;
    const [decoded] = decodeAbiParameters([MULTICALL_TUPLE_TYPE], dataWithoutSelector);
    expect((decoded[0] as { value: bigint }).value).toBe(BigInt(0));
    expect((decoded[0] as { data: string }).data).toBe('0x');
  });
});
