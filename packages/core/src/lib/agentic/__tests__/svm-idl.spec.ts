import type { Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { encodeAnchorIxData } from '../../orchestrator/svm-idl/ix-encoder';
import type { SolanaRule } from '../agentic.types';
import { compileSvmIdlRule, type SvmResolvedContext } from '../codec/svm-idl';
import { SvmDataPinMode } from '../codec/svm-terms';
import {
  encodeAgwSvmPayload,
  validateAgwSvmPayload,
} from '../execution/svm-payload';
import { ADDR } from './fake-chain';
import type { Hex } from 'viem';
const key = (c: string) => `0x${c.repeat(64)}` as Hex;
const program = key('3'),
  cea = key('4'),
  mint = key('5'),
  ata = key('6');
const idl: Idl = {
  address: new PublicKey(Buffer.from(program.slice(2), 'hex')).toBase58(),
  metadata: { name: 'test', version: '1', spec: '0.1.0' },
  instructions: [
    {
      name: 'deposit',
      discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
      accounts: [
        { name: 'cea', writable: true },
        { name: 'token', writable: true },
      ],
      args: [
        { name: 'flag', type: 'u8' },
        { name: 'amount', type: 'u64' },
        { name: 'minimum', type: 'u64' },
      ],
    },
  ],
};
const ctx: SvmResolvedContext = {
  expectedCEA: cea,
  gatewayProgram: key('2'),
  ceaAccounts: [cea, ata],
  assets: [
    { token: ADDR.target, maxPerCall: BigInt(10), maxTotal: BigInt(100) },
  ],
  tokenAccounts: new Map([[mint, ata]]),
};
const input = (): SolanaRule => ({
  agent: ADDR.agent,
  chainNamespace: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  validUntil: 100,
  assets: [],
  maxGasPerCall: BigInt(10),
  allowedInstructions: [
    {
      program,
      instruction: { idl, name: 'deposit' },
      accounts: [
        { name: 'cea', expected: { kind: 'walletCEA' } },
        { name: 'token', expected: { kind: 'walletATA', token: mint } },
      ],
      fields: [
        { name: 'flag', equals: BigInt(1) },
        { name: 'amount', max: BigInt(10) },
        {
          numerator: 'amount',
          denominator: 'minimum',
          minRatio: { num: BigInt(2), den: BigInt(1) },
        },
      ],
    },
  ],
});
describe('named SVM IDL rule compilation', () => {
  it('enforces named constraints against independently Borsh-encoded data', () => {
    const terms = compileSvmIdlRule(input(), ctx, 0);
    expect(terms.pins.map((p) => p.expected)).toEqual([cea, ata]);
    expect(terms.dataPins.map((p) => [p.offset, p.len, p.mode])).toEqual([
      [8, 1, SvmDataPinMode.EQ],
      [9, 8, SvmDataPinMode.LTE_LE],
      [9, 8, SvmDataPinMode.RATIO_GTE_LE],
    ]);
    const payload = (amount: bigint, minimum: bigint) =>
      encodeAgwSvmPayload(
        program,
        [
          { pubkey: cea, isWritable: true },
          { pubkey: ata, isWritable: true },
        ],
        encodeAnchorIxData(idl, 'deposit', [1, amount, minimum])
      );
    expect(
      validateAgwSvmPayload(terms, program, payload(BigInt(10), BigInt(5)))
    ).toBe(0);
    expect(() =>
      validateAgwSvmPayload(terms, program, payload(BigInt(11), BigInt(5)))
    ).toThrow('SvmDataCeilingExceeded');
    expect(() =>
      validateAgwSvmPayload(terms, program, payload(BigInt(9), BigInt(5)))
    ).toThrow('SvmDataRatioNotMet');
  });
  it.each([
    [
      'unknown account',
      (r: SolanaRule) => {
        r.allowedInstructions[0].accounts[0].name = 'wrong';
      },
    ],
    [
      'unlisted ATA',
      (r: SolanaRule) => {
        r.allowedInstructions[0].accounts[1].expected = {
          kind: 'walletATA',
          token: key('7'),
        };
      },
    ],
    [
      'unknown field',
      (r: SolanaRule) => {
        r.allowedInstructions[0].fields = [{ name: 'wrong', max: BigInt(2) }];
      },
    ],
    [
      'overflow',
      (r: SolanaRule) => {
        r.allowedInstructions[0].fields = [{ name: 'flag', max: BigInt(256) }];
      },
    ],
    [
      'duplicate instruction',
      (r: SolanaRule) => {
        r.allowedInstructions.push(r.allowedInstructions[0]);
      },
    ],
    [
      'mismatched program',
      (r: SolanaRule) => {
        r.allowedInstructions[0].program = key('8');
      },
    ],
    [
      'conflicting comparison',
      (r: SolanaRule) => {
        r.allowedInstructions[0].fields = [
          { name: 'flag', min: BigInt(0), max: BigInt(1) } as never,
        ];
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    const r = input();
    mutate(r);
    expect(() => compileSvmIdlRule(r, ctx, 0)).toThrow();
  });
  it.each(['bytes', 'string', { vec: 'u8' }, { defined: { name: 'Unknown' } }])(
    'refuses unsupported layouts %j',
    (type) => {
      const r = input();
      r.allowedInstructions[0].instruction.idl = {
        ...idl,
        instructions: [
          {
            ...idl.instructions[0],
            args: [
              { name: 'prefix', type: type as never },
              ...idl.instructions[0].args,
            ],
          },
        ],
      };
      expect(() => compileSvmIdlRule(r, ctx, 0)).toThrow('layout');
    }
  );
  it('does not mutate the caller IDL', () => {
    const before = JSON.stringify(idl);
    compileSvmIdlRule(input(), ctx, 0);
    expect(JSON.stringify(idl)).toBe(before);
  });
});
