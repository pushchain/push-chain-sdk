/**
 * Signing and payload encoding functions extracted from Orchestrator.
 */

import {
  encodeAbiParameters,
  encodePacked,
  keccak256,
  stringToBytes,
  toBytes,
} from 'viem';
import { CHAIN_INFO } from '../../constants/chain';
import { VM } from '../../constants/enums';
import type { UniversalPayload } from '../../generated/v1/tx';
import type { OrchestratorContext } from './context';

// ============================================================================
// EIP-712 Hash Computation
// ============================================================================

export function computeExecutionHash(
  ctx: OrchestratorContext,
  {
    verifyingContract,
    payload,
    version = '0.1.0',
  }: {
    verifyingContract: `0x${string}`;
    version?: string;
    payload: UniversalPayload;
  }
): `0x${string}` {
  const chain = ctx.universalSigner.account.chain;
  const { vm, chainId } = CHAIN_INFO[chain];

  const typeHash = keccak256(
    toBytes(
      'UniversalPayload(address to,uint256 value,bytes data,uint256 gasLimit,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,uint256 nonce,uint256 deadline,uint8 vType)'
    )
  );

  const domainTypeHash = keccak256(
    toBytes(
      vm === VM.EVM
        ? 'EIP712Domain(string version,uint256 chainId,address verifyingContract)'
        : 'EIP712Domain_SVM(string version,string chainId,address verifyingContract)'
    )
  );

  const domainSeparator = keccak256(
    encodeAbiParameters(
      [
        { name: 'typeHash', type: 'bytes32' },
        { name: 'version', type: 'bytes32' },
        { name: 'chainId', type: vm === VM.EVM ? 'uint256' : 'string' },
        { name: 'verifyingContract', type: 'address' },
      ],
      [
        domainTypeHash,
        keccak256(toBytes(version)),
        vm === VM.EVM ? BigInt(chainId) : chainId,
        verifyingContract,
      ]
    )
  );

  const structHash = keccak256(
    encodeAbiParameters(
      [
        { name: 'typeHash', type: 'bytes32' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes32' },
        { name: 'gasLimit', type: 'uint256' },
        { name: 'maxFeePerGas', type: 'uint256' },
        { name: 'maxPriorityFeePerGas', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'vType', type: 'uint8' },
      ],
      [
        typeHash,
        payload.to as `0x${string}`,
        BigInt(payload.value),
        keccak256(payload.data as `0x${string}`),
        BigInt(payload.gasLimit),
        BigInt(payload.maxFeePerGas),
        BigInt(payload.maxPriorityFeePerGas),
        BigInt(payload.nonce),
        BigInt(payload.deadline),
        payload.vType,
      ]
    )
  );

  return keccak256(
    encodePacked(
      ['string', 'bytes32', 'bytes32'],
      ['\x19\x01', domainSeparator, structHash]
    )
  );
}

export function computeMigrationHash(
  ctx: OrchestratorContext,
  {
    verifyingContract,
    migrationContractAddress,
    nonce,
    deadline,
    version = '0.1.0',
  }: {
    verifyingContract: `0x${string}`;
    migrationContractAddress: `0x${string}`;
    nonce: bigint;
    deadline: bigint;
    version?: string;
  }
): `0x${string}` {
  const chain = ctx.universalSigner.account.chain;
  const { vm, chainId } = CHAIN_INFO[chain];

  const typeHash = keccak256(
    toBytes(
      'MigrationPayload(address migration,uint256 nonce,uint256 deadline)'
    )
  );

  const domainTypeHash = keccak256(
    toBytes(
      vm === VM.EVM
        ? 'EIP712Domain(string version,uint256 chainId,address verifyingContract)'
        : 'EIP712Domain_SVM(string version,string chainId,address verifyingContract)'
    )
  );

  const domainSeparator = keccak256(
    encodeAbiParameters(
      [
        { name: 'typeHash', type: 'bytes32' },
        { name: 'version', type: 'bytes32' },
        { name: 'chainId', type: vm === VM.EVM ? 'uint256' : 'string' },
        { name: 'verifyingContract', type: 'address' },
      ],
      [
        domainTypeHash,
        keccak256(toBytes(version)),
        vm === VM.EVM ? BigInt(chainId) : chainId,
        verifyingContract,
      ]
    )
  );

  const structHash = keccak256(
    encodeAbiParameters(
      [
        { name: 'typeHash', type: 'bytes32' },
        { name: 'migration', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
      [typeHash, migrationContractAddress, nonce, deadline]
    )
  );

  return keccak256(
    encodePacked(
      ['string', 'bytes32', 'bytes32'],
      ['\x19\x01', domainSeparator, structHash]
    )
  );
}

// ============================================================================
// Payload Signing
// ============================================================================

export async function signUniversalPayload(
  ctx: OrchestratorContext,
  universalPayload: UniversalPayload,
  verifyingContract: `0x${string}`,
  version?: string
): Promise<Uint8Array> {
  const chain = ctx.universalSigner.account.chain;
  const { vm, chainId } = CHAIN_INFO[chain];

  switch (vm) {
    case VM.EVM: {
      if (!ctx.universalSigner.signTypedData) {
        throw new Error('signTypedData is not defined');
      }
      return ctx.universalSigner.signTypedData({
        domain: {
          version: version || '0.1.0',
          chainId: Number(chainId),
          verifyingContract,
        },
        types: {
          UniversalPayload: [
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' },
            { name: 'gasLimit', type: 'uint256' },
            { name: 'maxFeePerGas', type: 'uint256' },
            { name: 'maxPriorityFeePerGas', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
            { name: 'vType', type: 'uint8' },
          ],
        },
        primaryType: 'UniversalPayload',
        message: universalPayload,
      });
    }

    case VM.SVM: {
      const digest = computeExecutionHash(ctx, {
        verifyingContract,
        payload: universalPayload,
        version: version || '0.1.0',
      });
      return ctx.universalSigner.signMessage(stringToBytes(digest));
    }

    default:
      throw new Error(`Unsupported VM type: ${vm}`);
  }
}

export async function signMigrationPayload(
  ctx: OrchestratorContext,
  {
    migrationContractAddress,
    nonce,
    deadline,
    ueaVersion,
    ueaAddress,
  }: {
    migrationContractAddress: `0x${string}`;
    nonce: bigint;
    deadline: bigint;
    ueaVersion: string;
    ueaAddress: `0x${string}`;
  }
): Promise<Uint8Array> {
  const chain = ctx.universalSigner.account.chain;
  const { vm, chainId } = CHAIN_INFO[chain];

  switch (vm) {
    case VM.EVM: {
      if (!ctx.universalSigner.signTypedData) {
        throw new Error('signTypedData is not defined');
      }
      return ctx.universalSigner.signTypedData({
        domain: {
          version: ueaVersion,
          chainId: Number(chainId),
          verifyingContract: ueaAddress,
        },
        types: {
          MigrationPayload: [
            { name: 'migration', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'MigrationPayload',
        message: {
          migration: migrationContractAddress,
          nonce: nonce.toString(),
          deadline: deadline.toString(),
        },
      });
    }

    case VM.SVM: {
      const digest = computeMigrationHash(ctx, {
        verifyingContract: ueaAddress,
        migrationContractAddress,
        nonce,
        deadline,
        version: ueaVersion,
      });
      return ctx.universalSigner.signMessage(stringToBytes(digest));
    }

    default:
      throw new Error(`Unsupported VM type for migration: ${vm}`);
  }
}

// ============================================================================
// Payload Encoding
// ============================================================================

export function encodeUniversalPayload(payload: UniversalPayload): `0x${string}` {
  return encodeAbiParameters(
    [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'gasLimit', type: 'uint256' },
      { name: 'maxFeePerGas', type: 'uint256' },
      { name: 'maxPriorityFeePerGas', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'vType', type: 'uint8' },
    ],
    [
      payload.to as `0x${string}`,
      BigInt(payload.value as unknown as bigint | string),
      payload.data as `0x${string}`,
      BigInt(payload.gasLimit as unknown as bigint | string),
      BigInt(payload.maxFeePerGas as unknown as bigint | string),
      BigInt(payload.maxPriorityFeePerGas as unknown as bigint | string),
      BigInt(payload.nonce as unknown as bigint | string),
      BigInt(payload.deadline as unknown as bigint | string),
      Number(payload.vType),
    ]
  ) as `0x${string}`;
}

export function encodeUniversalPayloadSvm(payload: UniversalPayload): Buffer {
  const writeU64 = (val: bigint | number | string): Buffer => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(val), 0);
    return b;
  };

  const writeI64 = (val: bigint | number | string): Buffer => {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(BigInt(val), 0);
    return b;
  };

  const writeVecU8 = (val: Buffer | Uint8Array | number[]): Buffer => {
    const bytes = Buffer.isBuffer(val)
      ? val
      : Buffer.from(val as Uint8Array | number[]);
    const len = Buffer.alloc(4);
    len.writeUInt32LE(bytes.length, 0);
    return Buffer.concat([len, bytes]);
  };

  const writeU8 = (val: number): Buffer => Buffer.from([val]);

  const toAddrBytes = (() => {
    const to = payload.to as `0x${string}`;
    const hex = to.slice(2).padStart(40, '0');
    return Buffer.from(hex, 'hex');
  })();

  const valueBytes = writeU64(payload.value as unknown as bigint | number | string);

  const dataBytes = (() => {
    const data = payload.data as `0x${string}`;
    const hex = data.slice(2);
    const buf = hex.length ? Buffer.from(hex, 'hex') : Buffer.alloc(0);
    return writeVecU8(buf);
  })();

  const gasLimitBytes = writeU64(payload.gasLimit as unknown as bigint | number | string);
  const maxFeePerGasBytes = writeU64(payload.maxFeePerGas as unknown as bigint | number | string);
  const maxPriorityFeePerGasBytes = writeU64(payload.maxPriorityFeePerGas as unknown as bigint | number | string);
  const nonceBytes = writeU64(payload.nonce as unknown as bigint | number | string);
  const deadlineBytes = writeI64(payload.deadline as unknown as bigint | number | string);

  const vTypeVal = (() => {
    const v = payload.vType as any;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return Number(v);
    return 0;
  })();
  const vTypeBytes = writeU8(vTypeVal);

  return Buffer.concat([
    toAddrBytes,
    valueBytes,
    dataBytes,
    gasLimitBytes,
    maxFeePerGasBytes,
    maxPriorityFeePerGasBytes,
    nonceBytes,
    deadlineBytes,
    vTypeBytes,
  ]);
}
