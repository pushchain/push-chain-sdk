import type { Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { deriveSvmCeaPda } from '../../universal/account/account';
import { CHAIN } from '../../constants/enums';
import { getIdl } from './registry';
import type { SvmGatewayAccountMeta } from '../orchestrator.types';

type IxItem = Idl['instructions'][number];
type AccountItem = IxItem['accounts'][number];
type FlatAccount = {
  name: string;
  writable?: boolean;
  signer?: boolean;
  optional?: boolean;
  address?: string;
  pda?: {
    seeds: Array<{ kind: string; value?: unknown; path?: string }>;
    program?: { kind: string; value?: unknown; path?: string };
  };
  relations?: string[];
};

export interface ResolveInput {
  programAddress: `0x${string}`;
  data: Uint8Array;
  senderUea: `0x${string}`;
  targetChain: CHAIN;
}

export interface ResolvedSvmCall {
  targetProgram: `0x${string}`;
  accounts: SvmGatewayAccountMeta[];
  ixData: Uint8Array;
}

const CEA_AUTHORITY_NAMES = new Set([
  'cea_authority',
  'ceaAuthority',
  'cea',
  'cea_signer',
  'ceaSigner',
]);

export function resolveSvmCall(input: ResolveInput): ResolvedSvmCall {
  const idl = getIdl(input.programAddress);
  if (!idl) {
    throw new Error(
      `resolveSvmCall: no IDL found for ${input.programAddress}. ` +
        `The SDK auto-registers Anchor IDLs when you call ` +
        `PushChain.utils.helpers.encodeTxData({abi: idl, ...}). ` +
        `If you built 'data' manually, call PushChain.utils.svm.registerIdl(idl) ` +
        `once before prepareTransaction.`
    );
  }

  if (input.data.length < 8) {
    throw new Error(
      'resolveSvmCall: data must be at least 8 bytes (Anchor discriminator)'
    );
  }
  const disc = input.data.slice(0, 8);
  const ix = idl.instructions.find((i) =>
    Buffer.from(i.discriminator).equals(Buffer.from(disc))
  );
  if (!ix) {
    throw new Error(
      `resolveSvmCall: no instruction in IDL '${
        idl.metadata?.name ?? idl.address
      }' matches discriminator [${Array.from(disc).join(',')}]`
    );
  }

  const programPk = new PublicKey(
    Buffer.from(input.programAddress.slice(2), 'hex')
  );
  const { address: ceaPdaHex } = deriveSvmCeaPda(
    input.senderUea,
    input.targetChain,
    true
  );

  const accounts: SvmGatewayAccountMeta[] = [];
  for (const item of ix.accounts) {
    if ('accounts' in item) {
      throw new Error(
        `resolveSvmCall: nested account group '${item.name}' in '${ix.name}' not supported`
      );
    }
    const flat = item as FlatAccount;
    const pubkey = resolveAccountPubkey(flat, programPk, ceaPdaHex, ix.name);
    accounts.push({ pubkey, isWritable: Boolean(flat.writable) });
  }

  return {
    targetProgram: input.programAddress,
    accounts,
    ixData: input.data,
  };
}

function resolveAccountPubkey(
  spec: FlatAccount,
  programPk: PublicKey,
  ceaPdaHex: `0x${string}`,
  ixName: string
): `0x${string}` {
  if (spec.address) {
    return pkToHex(new PublicKey(spec.address));
  }
  if (spec.pda) {
    const seeds = resolveConstSeeds(spec.pda.seeds, spec.name, ixName);
    const programForPda = spec.pda.program
      ? new PublicKey(resolveConstSeedValue(spec.pda.program, spec.name, ixName))
      : programPk;
    const [pda] = PublicKey.findProgramAddressSync(seeds, programForPda);
    return pkToHex(pda);
  }
  if (CEA_AUTHORITY_NAMES.has(spec.name)) {
    return ceaPdaHex;
  }
  throw new Error(
    `resolveSvmCall: cannot resolve account '${spec.name}' in '${ixName}'. ` +
      `Add 'address' or 'pda.seeds' to the IDL, or rename to a CEA convention (cea_authority).`
  );
}

function resolveConstSeeds(
  seeds: NonNullable<FlatAccount['pda']>['seeds'],
  accountName: string,
  ixName: string
): Buffer[] {
  return seeds.map((seed: { kind: string; value?: unknown }, idx: number) => {
    if (seed.kind !== 'const') {
      throw new Error(
        `resolveSvmCall: non-const PDA seed (kind='${seed.kind}') on account '${accountName}' in '${ixName}' not supported yet`
      );
    }
    if (!Array.isArray(seed.value)) {
      throw new Error(
        `resolveSvmCall: const seed at index ${idx} on '${accountName}' is malformed`
      );
    }
    return Buffer.from(seed.value);
  });
}

function resolveConstSeedValue(
  seed: { kind: string; value?: unknown },
  accountName: string,
  ixName: string
): Buffer {
  if (seed.kind !== 'const' || !Array.isArray(seed.value)) {
    throw new Error(
      `resolveSvmCall: only const program-seed supported on '${accountName}' in '${ixName}'`
    );
  }
  return Buffer.from(seed.value as number[]);
}

function pkToHex(pk: PublicKey): `0x${string}` {
  return ('0x' + Buffer.from(pk.toBytes()).toString('hex')) as `0x${string}`;
}
