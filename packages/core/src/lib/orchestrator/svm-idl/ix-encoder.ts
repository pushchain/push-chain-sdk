import { BorshInstructionCoder, BN, type Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

type IdlArg = Idl['instructions'][number]['args'][number];

export function encodeAnchorIxData(
  idl: Idl,
  functionName: string,
  positionalArgs: unknown[] = []
): Uint8Array {
  const ix = findInstruction(idl, functionName);
  if (!ix) {
    throw new Error(
      `Instruction '${functionName}' not found in IDL '${idl.metadata?.name ?? 'unknown'}'`
    );
  }
  if (positionalArgs.length !== ix.args.length) {
    throw new Error(
      `Arg count mismatch for '${ix.name}': IDL expects ${ix.args.length}, got ${positionalArgs.length}`
    );
  }

  const named: Record<string, unknown> = {};
  for (let i = 0; i < ix.args.length; i++) {
    named[ix.args[i].name] = normalizeArg(positionalArgs[i], ix.args[i]);
  }

  const coder = new BorshInstructionCoder(idl);
  return new Uint8Array(coder.encode(ix.name, named));
}

function findInstruction(idl: Idl, name: string): Idl['instructions'][number] | undefined {
  const snake = name.replace(/([A-Z])/g, (_, c) => '_' + c.toLowerCase());
  const camel = name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  return idl.instructions.find(
    (i) => i.name === name || i.name === snake || i.name === camel
  );
}

function normalizeArg(value: unknown, field: IdlArg): unknown {
  if (typeof value === 'bigint') {
    return new BN(value.toString());
  }
  if (
    field.type === 'pubkey' &&
    typeof value === 'string' &&
    value.startsWith('0x') &&
    value.length === 66
  ) {
    return new PublicKey(Buffer.from(value.slice(2), 'hex'));
  }
  return value;
}

export function isAnchorIdl(value: unknown): value is Idl {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const maybe = value as Record<string, unknown>;
  return Array.isArray(maybe['instructions']) && typeof maybe['address'] === 'string';
}
