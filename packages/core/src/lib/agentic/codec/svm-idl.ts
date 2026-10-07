/** Compile named Anchor IDL constraints. Unsupported layouts are never guessed. */
import type { Idl } from '@coral-xyz/anchor';
import { bytesToHex, hexToBytes, type Hex } from 'viem';
import type { SolanaRule, SvmAccountRef } from '../agentic.types';
import { svmKey } from './svm-accounts';
import {
  SvmDataPinMode,
  svmInvalid,
  validateSvmTerms,
  type SvmTermsWire,
  type SvmDataPinWire,
} from './svm-terms';

export type SvmResolvedContext = Pick<
  SvmTermsWire,
  'assets' | 'expectedCEA' | 'gatewayProgram' | 'ceaAccounts'
> & {
  /** Verified mint -> wallet ATA mapping, including output mints. */
  tokenAccounts: ReadonlyMap<Hex, Hex>;
};
type Field = { offset: number; len: number; type: unknown };
const widths: Record<string, number> = {
  bool: 1,
  u8: 1,
  i8: 1,
  u16: 2,
  i16: 2,
  u32: 4,
  i32: 4,
  f32: 4,
  u64: 8,
  i64: 8,
  f64: 8,
  u128: 16,
  i128: 16,
  u256: 32,
  i256: 32,
  pubkey: 32,
};
function width(type: unknown): number {
  if (typeof type === 'string' && widths[type]) return widths[type];
  if (type && typeof type === 'object' && 'array' in type) {
    const a = (type as { array: unknown }).array;
    if (
      Array.isArray(a) &&
      a.length === 2 &&
      Number.isSafeInteger(a[1]) &&
      a[1] > 0
    ) {
      const size = width(a[0]) * a[1];
      if (size <= 1024) return size;
    }
  }
  throw svmInvalid(
    'IDL field layout is not supported: use fixed-width primitives or fixed arrays'
  );
}
export function svmIdlInstruction(idl: Idl, name: string) {
  if (!idl || !Array.isArray(idl.instructions) || typeof name !== 'string')
    throw svmInvalid('instruction requires an Anchor IDL and name');
  const found = idl.instructions.filter((i) => i.name === name);
  if (found.length !== 1)
    throw svmInvalid(`IDL instruction ${name} must exist exactly once`);
  const ix = found[0];
  if (
    !Array.isArray(ix.discriminator) ||
    ix.discriminator.length !== 8 ||
    ix.discriminator.some((b) => !Number.isInteger(b) || b < 0 || b > 255)
  )
    throw svmInvalid('Anchor IDL discriminator must contain eight bytes');
  return ix;
}
function accountNames(accounts: unknown[], prefix = ''): string[] {
  return accounts.flatMap((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('name' in entry) ||
      typeof entry.name !== 'string'
    )
      throw svmInvalid('invalid IDL account');
    const name = prefix + entry.name;
    if ('accounts' in entry)
      throw svmInvalid(
        'nested IDL accounts are not supported by the instruction resolver'
      );
    if ('optional' in entry && entry.optional)
      throw svmInvalid('optional IDL accounts are not supported for rules');
    return [name];
  });
}
function resolveAccount(ref: SvmAccountRef, ctx: SvmResolvedContext): Hex {
  if (!ref || typeof ref !== 'object')
    throw svmInvalid('invalid named account reference');
  if (ref.kind === 'walletCEA') return ctx.expectedCEA;
  if (ref.kind === 'address') return svmKey(ref.address);
  if (ref.kind === 'walletATA') {
    const ata = ctx.tokenAccounts.get(svmKey(ref.token));
    if (!ata)
      throw svmInvalid(
        'walletATA mint must be listed in assets or outputTokens'
      );
    return ata;
  }
  throw svmInvalid('unknown named account reference');
}
function unsigned(f: Field): void {
  if (typeof f.type !== 'string' || !/^u(8|16|32|64)$/.test(f.type))
    throw svmInvalid(
      'range/ratio constraints require unsigned integer fields of at most eight bytes'
    );
}
function bound(v: bigint, len: number): Hex {
  if (
    typeof v !== 'bigint' ||
    v < BigInt(0) ||
    v >= BigInt(1) << BigInt(len * 8)
  )
    throw svmInvalid('field constraint exceeds its unsigned width');
  return `0x${v.toString(16).padStart(64, '0')}`;
}
export function compileSvmIdlRule(
  rule: SolanaRule,
  ctx: SvmResolvedContext,
  now: number
): SvmTermsWire {
  if (
    !Array.isArray(rule.allowedInstructions) ||
    !rule.allowedInstructions.length ||
    rule.allowedInstructions.length > 32
  )
    throw svmInvalid('allowedInstructions must contain 1..32 entries');
  const terms: SvmTermsWire = {
    validUntil: rule.validUntil,
    maxGasPerCall: rule.maxGasPerCall,
    assets: ctx.assets,
    expectedCEA: ctx.expectedCEA,
    gatewayProgram: ctx.gatewayProgram,
    ceaAccounts: ctx.ceaAccounts,
    programs: [],
    pins: [],
    dataPins: [],
  };
  const programs = [],
    pins = [],
    dataPins: SvmDataPinWire[] = [];
  for (const [ruleIndex, entry] of rule.allowedInstructions.entries()) {
    const ix = svmIdlInstruction(
      entry.instruction?.idl,
      entry.instruction?.name
    );
    const program = svmKey(entry.program);
    if (svmKey(entry.instruction.idl.address) !== program)
      throw svmInvalid('IDL address differs from rule program');
    if (!Array.isArray(ix.accounts) || !Array.isArray(entry.accounts))
      throw svmInvalid('instruction accounts are required');
    const names = accountNames(ix.accounts);
    if (new Set(names).size !== names.length)
      throw svmInvalid('duplicate IDL account names');
    programs.push({
      program,
      discriminator: bytesToHex(
        Uint8Array.from([
          ...ix.discriminator,
          ...Array(8 - ix.discriminator.length).fill(0),
        ])
      ),
      discriminatorLen: ix.discriminator.length,
      dataless: false,
      maxAccounts: names.length,
    });
    for (const a of entry.accounts) {
      const accountIndex = names.indexOf(a.name);
      if (accountIndex < 0) throw svmInvalid(`unknown IDL account ${a.name}`);
      pins.push({
        ruleIndex,
        accountIndex,
        expected: resolveAccount(a.expected, ctx),
      });
    }
    const fields = new Map<string, Field>();
    let offset = ix.discriminator.length;
    // Reject variable/nested-defined layouts rather than claiming a reliable offset.
    for (const arg of ix.args) {
      if (fields.has(arg.name)) throw svmInvalid('duplicate IDL field name');
      const len = width(arg.type);
      fields.set(arg.name, { offset, len, type: arg.type });
      offset += len;
    }
    if (offset > 1024)
      throw svmInvalid('IDL instruction data exceeds the policy limit');
    const field = (name: string) => {
      const f = fields.get(name);
      if (!f) throw svmInvalid(`unknown IDL field ${name}`);
      return f;
    };
    if (entry.fields !== undefined && !Array.isArray(entry.fields))
      throw svmInvalid('fields must be an array');
    for (const constraint of entry.fields ?? []) {
      const keys = ['equals', 'min', 'max', 'minRatio'].filter(
        (k) => k in constraint
      );
      if (keys.length !== 1)
        throw svmInvalid(
          'each field constraint must specify exactly one comparison'
        );
      const f = field(
        'numerator' in constraint ? constraint.numerator : constraint.name
      );
      const p: SvmDataPinWire = {
        ruleIndex,
        fromEnd: false,
        offset: f.offset,
        offsetB: 0,
        len: f.len,
        mode: SvmDataPinMode.EQ,
        expected: `0x${'00'.repeat(32)}`,
        num: BigInt(0),
        den: BigInt(0),
      };
      if ('minRatio' in constraint) {
        unsigned(f);
        const b = field(constraint.denominator);
        unsigned(b);
        if (f.len !== b.len)
          throw svmInvalid('ratio fields must have the same width');
        Object.assign(p, {
          mode: SvmDataPinMode.RATIO_GTE_LE,
          offsetB: b.offset,
          num: constraint.minRatio.num,
          den: constraint.minRatio.den,
        });
      } else if ('min' in constraint || 'max' in constraint) {
        unsigned(f);
        const min = 'min' in constraint;
        p.mode = min ? SvmDataPinMode.GTE_LE : SvmDataPinMode.LTE_LE;
        p.expected = bound(min ? constraint.min : constraint.max, f.len);
      } else {
        let bytes: Uint8Array;
        if (typeof constraint.equals === 'bigint') {
          unsigned(f);
          bound(constraint.equals, f.len);
          bytes = Uint8Array.from({ length: f.len }, (_, i) =>
            Number(
              ((constraint.equals as bigint) >> BigInt(8 * i)) & BigInt(255)
            )
          );
        } else if (typeof constraint.equals === 'boolean') {
          if (f.type !== 'bool')
            throw svmInvalid('boolean equality requires a bool field');
          bytes = Uint8Array.of(constraint.equals ? 1 : 0);
        } else {
          if (!/^0x(?:[a-fA-F0-9]{2})*$/.test(constraint.equals))
            throw svmInvalid('equality requires exact hex bytes');
          bytes = hexToBytes(constraint.equals);
        }
        if (bytes.length !== f.len || f.len > 32)
          throw svmInvalid(
            'equality value must match field width (at most 32 bytes)'
          );
        p.expected = `0x${bytesToHex(bytes).slice(2).padEnd(64, '0')}`;
      }
      dataPins.push(p);
    }
  }
  Object.assign(terms, { programs, pins, dataPins });
  validateSvmTerms(terms, now);
  return terms;
}
