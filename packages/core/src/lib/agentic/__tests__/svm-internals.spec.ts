import { PublicKey } from '@solana/web3.js';
import { bytesToHex, hexToBytes, numberToHex, type Hex } from 'viem';
import {
  decodeSvmTerms,
  encodeSvmTerms,
  validateSvmTerms,
  SvmDataPinMode,
  type SvmTermsWire,
} from '../codec/svm-terms';
import {
  deriveAgwSvmAta,
  deriveAgwSvmCea,
  deriveAgwSvmValueAccounts,
  svmKey,
  resolveAgwSvmRuleContext,
} from '../codec/svm-accounts';
import {
  encodeAgwSvmPayload,
  parseAgwSvmPayload,
  validateAgwSvmPayload,
} from '../execution/svm-payload';
import { composeAgwSvmAction } from '../execution/svm-outbound';
import { decodeFunctionData } from 'viem';
import { UNIVERSAL_GATEWAY_PC } from '../../constants/abi';
import { encodeSvmExecutePayload } from '../../orchestrator/payload-builders';
import { ADDR } from './fake-chain';

const key = (byte: string) => `0x${byte.repeat(32)}` as Hex;
const CEA = key('11'),
  GATEWAY = key('22'),
  PROGRAM = key('33'),
  ATA = key('44');
const NOW = 1_700_000_000;
const base = (): SvmTermsWire => ({
  validUntil: NOW + 60,
  expectedCEA: CEA,
  gatewayProgram: GATEWAY,
  assets: [{ token: ADDR.target, maxPerCall: BigInt(5), maxTotal: BigInt(10) }],
  maxGasPerCall: BigInt(20),
  ceaAccounts: [CEA, ATA],
  programs: [
    {
      program: PROGRAM,
      discriminator: '0x0100000000000000',
      discriminatorLen: 1,
      dataless: false,
      maxAccounts: 2,
    },
  ],
  pins: [
    { ruleIndex: 0, accountIndex: 0, expected: CEA },
    { ruleIndex: 0, accountIndex: 1, expected: ATA },
  ],
  dataPins: [],
});
const accounts = [
  { pubkey: CEA, isWritable: true },
  { pubkey: ATA, isWritable: true },
];

describe('v4 internal SVM wire codec', () => {
  it('round-trips ordered per-token caps and all four data-pin modes', () => {
    const t = base();
    t.dataPins = [
      {
        ruleIndex: 0,
        fromEnd: false,
        offset: 0,
        offsetB: 0,
        len: 1,
        mode: 0,
        expected: key('00'),
        num: BigInt(0),
        den: BigInt(0),
      },
      {
        ruleIndex: 0,
        fromEnd: true,
        offset: 8,
        offsetB: 0,
        len: 8,
        mode: 1,
        expected: numberToHex(5, { size: 32 }),
        num: BigInt(0),
        den: BigInt(0),
      },
      {
        ruleIndex: 0,
        fromEnd: false,
        offset: 1,
        offsetB: 0,
        len: 2,
        mode: 2,
        expected: numberToHex(65535, { size: 32 }),
        num: BigInt(0),
        den: BigInt(0),
      },
      {
        ruleIndex: 0,
        fromEnd: true,
        offset: 16,
        offsetB: 8,
        len: 8,
        mode: 3,
        expected: key('00'),
        num: BigInt(9),
        den: BigInt(10),
      },
    ];
    t.assets = [
      ...t.assets,
      { token: ADDR.other, maxPerCall: BigInt(0), maxTotal: BigInt(0) },
    ];
    expect(decodeSvmTerms(encodeSvmTerms(t, NOW))).toEqual(t);
  });
  it.each([
    [
      'expired',
      (t: SvmTermsWire) => {
        t.validUntil = NOW;
      },
    ],
    [
      'zero CEA',
      (t: SvmTermsWire) => {
        t.expectedCEA = key('00');
      },
    ],
    [
      'empty assets',
      (t: SvmTermsWire) => {
        t.assets = [];
      },
    ],
    [
      'duplicate tokens',
      (t: SvmTermsWire) => {
        t.assets = [t.assets[0], t.assets[0]];
      },
    ],
    [
      'system program',
      (t: SvmTermsWire) => {
        t.programs = [{ ...t.programs[0], program: key('00') }];
      },
    ],
    [
      'ambiguous prefixes',
      (t: SvmTermsWire) => {
        t.programs = [
          ...t.programs,
          {
            ...t.programs[0],
            discriminator: '0x0102000000000000',
            discriminatorLen: 2,
          },
        ];
      },
    ],
    [
      'missing pin',
      (t: SvmTermsWire) => {
        t.pins = [];
      },
    ],
    [
      'duplicate pin',
      (t: SvmTermsWire) => {
        t.pins = [t.pins[0], t.pins[0]];
      },
    ],
    [
      'CEA absent',
      (t: SvmTermsWire) => {
        t.ceaAccounts = [ATA];
      },
    ],
    [
      'fixed count outside bound',
      (t: SvmTermsWire) => {
        t.programs = [{ ...t.programs[0], maxAccounts: 65 }];
      },
    ],
  ])('rejects %s before encoding', (_name, change) => {
    const t = base();
    change(t);
    expect(() => encodeSvmTerms(t, NOW)).toThrow(
      expect.objectContaining({ code: 'INVALID_RULE' })
    );
  });
  it('refuses misleading integer/raw alignment and zero ratio denominators', () => {
    const t = base();
    const p = {
      ruleIndex: 0,
      fromEnd: false,
      offset: 1,
      offsetB: 3,
      len: 2,
      mode: SvmDataPinMode.EQ,
      expected: numberToHex(5, { size: 32 }),
      num: BigInt(0),
      den: BigInt(0),
    };
    t.dataPins = [p];
    expect(() => validateSvmTerms(t, NOW)).toThrow(/left-aligned/);
    t.dataPins = [
      {
        ...p,
        mode: SvmDataPinMode.GTE_LE,
        expected: numberToHex(65536, { size: 32 }),
      },
    ];
    expect(() => validateSvmTerms(t, NOW)).toThrow(/width/);
    t.dataPins = [
      {
        ...p,
        mode: SvmDataPinMode.RATIO_GTE_LE,
        num: BigInt(1),
        den: BigInt(0),
      },
    ];
    expect(() => validateSvmTerms(t, NOW)).toThrow(/ratio/);
  });
});

describe('wallet-scoped SVM value accounts', () => {
  it('derives the exact PDA from wallet20 and the selected gateway', () => {
    const result = deriveAgwSvmCea(ADDR.owner, GATEWAY);
    const [expected, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from('push_identity'), Buffer.from(hexToBytes(ADDR.owner))],
      new PublicKey(hexToBytes(GATEWAY))
    );
    expect(result).toEqual({ address: bytesToHex(expected.toBytes()), bump });
    expect(deriveAgwSvmCea(ADDR.agent, GATEWAY).address).not.toBe(
      result.address
    );
    expect(deriveAgwSvmCea(ADDR.owner, PROGRAM).address).not.toBe(
      result.address
    );
    expect(PublicKey.isOnCurve(hexToBytes(result.address))).toBe(false);
  });
  it('resolved token caps cannot omit their corresponding protected ATAs', () => {
    const cap = {
      token: ADDR.target,
      maxPerCall: BigInt(1),
      maxTotal: BigInt(2),
    };
    const result = resolveAgwSvmRuleContext(
      ADDR.owner,
      GATEWAY,
      [
        { kind: 'native', cap },
        { kind: 'spl', cap: { ...cap, token: ADDR.other }, mint: PROGRAM },
      ],
      [{ mint: ATA }]
    );
    expect(result.ceaAccounts).toHaveLength(3);
    expect(result.assets.map((a) => a.token)).toEqual([
      ADDR.target,
      ADDR.other,
    ]);
    expect(() => deriveAgwSvmCea(ADDR.owner, key('00'))).toThrow(
      /gateway program/
    );
  });
  it('includes input/output ATAs, deduplicates, and separates Token-2022 accounts', () => {
    const t = { mint: PROGRAM },
      output = { mint: ATA };
    const derived = deriveAgwSvmValueAccounts(
      ADDR.owner,
      GATEWAY,
      [t, t],
      [output]
    );
    expect(derived.ceaAccounts).toEqual([
      derived.expectedCEA,
      deriveAgwSvmAta(derived.expectedCEA, t),
      deriveAgwSvmAta(derived.expectedCEA, output),
    ]);
    const legacy = deriveAgwSvmAta(derived.expectedCEA, t),
      token2022 = deriveAgwSvmAta(derived.expectedCEA, {
        ...t,
        tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      });
    expect(token2022).not.toBe(legacy);
    expect(svmKey(new PublicKey(hexToBytes(PROGRAM)).toBase58())).toBe(PROGRAM);
    expect(() =>
      deriveAgwSvmAta(derived.expectedCEA, { mint: key('00') })
    ).toThrow(/native SOL/);
  });
});

describe('S12–S18 payload checks', () => {
  it('matches the existing node encoder and parses every byte including writable flags', () => {
    const payload = encodeAgwSvmPayload(
      PROGRAM,
      accounts,
      new Uint8Array([1, 2, 3])
    );
    expect(payload).toBe(
      encodeSvmExecutePayload({
        targetProgram: PROGRAM,
        accounts,
        ixData: new Uint8Array([1, 2, 3]),
        instructionId: 2,
      })
    );
    expect(parseAgwSvmPayload(payload)).toMatchObject({
      program: PROGRAM,
      instructionData: new Uint8Array([1, 2, 3]),
      accounts: [
        { pubkey: CEA, writableFlag: 1 },
        { pubkey: ATA, writableFlag: 1 },
      ],
    });
    expect(validateAgwSvmPayload(base(), PROGRAM, payload)).toBe(0);
    const raw = hexToBytes(payload);
    raw[36] = 7;
    expect(parseAgwSvmPayload(bytesToHex(raw)).accounts[0].writableFlag).toBe(
      7
    );
    expect(validateAgwSvmPayload(base(), PROGRAM, bytesToHex(raw))).toBe(0); // URP deliberately ignores flags.
  });
  it.each([
    ['trailing data', (p: Hex) => `${p}00` as Hex, 'MalformedSvmPayload'],
    ['truncated', (p: Hex) => p.slice(0, -2) as Hex, 'MalformedSvmPayload'],
    [
      'oversized count',
      (p: Hex) => `0x00000041${p.slice(10)}` as Hex,
      'SvmAccountsOutOfRange',
    ],
  ])(
    'rejects %s with the corresponding contract error',
    (_name, mutate, error) => {
      const p = encodeAgwSvmPayload(PROGRAM, accounts, new Uint8Array([1]));
      expect(() => parseAgwSvmPayload(mutate(p))).toThrow(
        expect.objectContaining({ details: { contractError: error } })
      );
    }
  );
  it('pins prevent key substitution and protected-account aliasing', () => {
    const t = base();
    expect(() =>
      validateAgwSvmPayload(
        t,
        PROGRAM,
        encodeAgwSvmPayload(
          PROGRAM,
          [{ ...accounts[0], pubkey: GATEWAY }, accounts[1]],
          new Uint8Array([1])
        )
      )
    ).toThrow(/SvmAccountPinMismatch/);
    t.programs = [{ ...t.programs[0], maxAccounts: 0 }];
    expect(() =>
      validateAgwSvmPayload(
        t,
        PROGRAM,
        encodeAgwSvmPayload(
          PROGRAM,
          [...accounts, accounts[0]],
          new Uint8Array([1])
        )
      )
    ).toThrow(/CeaAccountAtUnpinnedIndex/);
    expect(() =>
      validateAgwSvmPayload(
        t,
        GATEWAY,
        encodeAgwSvmPayload(PROGRAM, accounts, new Uint8Array([1]))
      )
    ).toThrow(/RecipientTargetMismatch/);
  });
  it('enforces little-endian floors/ceilings, from-end offsets, ratios and exact byte pins', () => {
    const t = base();
    t.dataPins = [
      {
        ruleIndex: 0,
        fromEnd: true,
        offset: 4,
        offsetB: 2,
        len: 2,
        mode: 3,
        expected: key('00'),
        num: BigInt(9),
        den: BigInt(10),
      },
    ];
    const make = (out: number, input: number) =>
      encodeAgwSvmPayload(
        PROGRAM,
        accounts,
        new Uint8Array([1, out & 255, out >> 8, input & 255, input >> 8])
      );
    expect(validateAgwSvmPayload(t, PROGRAM, make(90, 100))).toBe(0);
    expect(() => validateAgwSvmPayload(t, PROGRAM, make(89, 100))).toThrow(
      /SvmDataRatioNotMet/
    );
    t.dataPins = [
      {
        ...t.dataPins[0],
        fromEnd: false,
        offset: 1,
        mode: 1,
        expected: numberToHex(90, { size: 32 }),
      },
    ];
    expect(() => validateAgwSvmPayload(t, PROGRAM, make(89, 100))).toThrow(
      /SvmDataFloorNotMet/
    );
    t.dataPins = [{ ...t.dataPins[0], mode: 2 }];
    expect(() => validateAgwSvmPayload(t, PROGRAM, make(91, 100))).toThrow(
      /SvmDataCeilingExceeded/
    );
    t.dataPins = [
      { ...t.dataPins[0], mode: 0, expected: `0x5a00${'00'.repeat(30)}` },
    ];
    expect(validateAgwSvmPayload(t, PROGRAM, make(90, 100))).toBe(0);
    expect(() =>
      validateAgwSvmPayload(
        t,
        PROGRAM,
        encodeAgwSvmPayload(PROGRAM, accounts, new Uint8Array([1]))
      )
    ).toThrow(/SvmDataTooShortForPin/);
  });
});

describe('internal SVM outbound action', () => {
  const config = () => ({
    ...base(),
    initialized: true,
    maxGasPerCall: BigInt(100),
    assets: [
      {
        token: ADDR.target,
        maxPerCall: BigInt(5),
        maxTotal: BigInt(10),
        spent: BigInt(2),
      },
    ],
  });
  const input = () => ({
    wallet: ADDR.owner,
    gateway: ADDR.gateway,
    token: ADDR.target,
    amount: BigInt(3),
    recipient: PROGRAM,
    payload: encodeAgwSvmPayload(PROGRAM, accounts, new Uint8Array([1])),
    gasLimit: BigInt(200000),
    protocolFee: BigInt(2),
    maxPCForGas: BigInt(3),
  });
  it('uses the program recipient, wallet refund and quoted PC while preserving the exact payload', () => {
    const i = input(),
      result = composeAgwSvmAction(i, config(), NOW);
    const request = decodeFunctionData({
      abi: UNIVERSAL_GATEWAY_PC,
      data: result.data,
    }).args![0];
    expect(result.target).toBe(ADDR.gateway);
    expect(result.value).toBe(BigInt(5));
    expect(request).toMatchObject({
      recipient: PROGRAM,
      revertRecipient: ADDR.owner,
      amount: BigInt(3),
      payload: i.payload,
      gasPrice: BigInt(0),
    });
  });
  it('rejects caps, zero gas and unknown assets before signing', () => {
    expect(() =>
      composeAgwSvmAction({ ...input(), amount: BigInt(6) }, config(), NOW)
    ).toThrow(/AmountExceedsCap/);
    expect(() =>
      composeAgwSvmAction({ ...input(), token: ADDR.other }, config(), NOW)
    ).toThrow(/AssetNotAllowed/);
    expect(() =>
      composeAgwSvmAction({ ...input(), maxPCForGas: BigInt(0) }, config(), NOW)
    ).toThrow(/UncappedGasSwapRejected/);
    expect(() =>
      composeAgwSvmAction(
        { ...input(), maxPCForGas: BigInt(100) },
        config(),
        NOW
      )
    ).toThrow(/PCValueExceedsCap/);
    const c = config();
    c.assets[0].spent = BigInt(9);
    expect(() => composeAgwSvmAction(input(), c, NOW)).toThrow(
      /TotalSpendCapExceeded/
    );
    c.assets[0].maxPerCall = BigInt(2) ** BigInt(256) - BigInt(1);
    expect(() =>
      composeAgwSvmAction(
        { ...input(), amount: BigInt(2) ** BigInt(64) },
        c,
        NOW
      )
    ).toThrow(/AmountExceedsU64/);
  });
});
