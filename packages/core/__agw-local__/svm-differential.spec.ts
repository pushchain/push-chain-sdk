/** Seeded, independent SDK-vs-contract comparisons. No live transport/funding. */
import {
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  type Hex,
} from 'viem';
import { CHAIN } from '../src/lib/constants/enums';
import { buildSession, encodeEnvelope } from '../src/lib/agentic/codec/session';
import {
  SVM_TERMS_PARAM,
  validateSvmTerms,
  type SvmTermsWire,
} from '../src/lib/agentic/codec/svm-terms';
import {
  encodeAgwSvmPayload,
  validateAgwSvmPayload,
} from '../src/lib/agentic/execution/svm-payload';
import { v4 } from '../src/lib/agentic/contracts/v4';
import { deriveAgwSvmValueAccounts } from '../src/lib/agentic/codec/svm-accounts';
import { decodeAgenticRevert } from '../src/lib/agentic/revert';
import { startHarness, type Harness } from './harness';
const key = (b: string) => `0x${b.repeat(32)}` as Hex;
const GATEWAY = key('22'),
  PROGRAM = key('33');
const TOKEN = parseAbi([
  'function mint(address,uint256)',
  'function approve(address,uint256) returns(bool)',
]);
const seed = 0x5a17;
let rng = seed;
function random(n: number) {
  rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
  return rng % n;
}
const clone = <T>(t: T): T => structuredClone(t);

describe('seeded SVM differential validation', () => {
  let h: Harness, wallet: `0x${string}`, token: `0x${string}`;
  let terms: SvmTermsWire;
  beforeAll(async () => {
    h = await startHarness(18555);
    token = await h.deploy(0, 'HarnessPRC20', 'HarnessFixtures.sol', [
      CHAIN.SOLANA_DEVNET,
      9,
    ]);
    wallet = (
      await (await h.client(0)).agentic.create('differential', { rules: [] })
    ).wallet;
    const derived = deriveAgwSvmValueAccounts(wallet, GATEWAY, []);
    terms = {
      ...derived,
      validUntil: Math.floor(Date.now() / 1000) + 3600,
      assets: [{ token, maxPerCall: BigInt(10), maxTotal: BigInt(100) }],
      maxGasPerCall: BigInt(10) ** BigInt(16),
      programs: [
        {
          program: PROGRAM,
          discriminator: '0x0100000000000000',
          discriminatorLen: 1,
          dataless: false,
          maxAccounts: 1,
        },
      ],
      pins: [{ ruleIndex: 0, accountIndex: 0, expected: derived.expectedCEA }],
      dataPins: [],
    };
  });
  afterAll(async () => h?.stop());
  const session = (t: SvmTermsWire) =>
    buildSession({
      validator: h.addresses.validator,
      rulesPolicy: h.addresses.rulesPolicy,
      agent: h.wallets[1].account!.address,
      actions: [
        {
          target: h.addresses.gateway,
          selector: '0x77b86bec',
          initData: encodeEnvelope(
            CHAIN.SOLANA_DEVNET,
            encodeAbiParameters([SVM_TERMS_PARAM], [t])
          ),
        },
      ],
    });

  it('grant-shape corpus agrees with the actual URP initializer', async () => {
    const cases: { name: string; terms: SvmTermsWire }[] = [];
    const add = (name: string, mutate: (t: SvmTermsWire) => void) => {
      const t = clone(terms);
      mutate(t);
      cases.push({ name, terms: t });
    };
    add('base', () => {
      /* Keep the baseline unchanged for the first comparison. */
    });
    for (const per of [
      BigInt(0),
      BigInt(1),
      (BigInt(1) << BigInt(64)) - BigInt(1),
      (BigInt(1) << BigInt(256)) - BigInt(1),
    ])
      for (const total of [
        BigInt(0),
        BigInt(1),
        (BigInt(1) << BigInt(64)) - BigInt(1),
        (BigInt(1) << BigInt(256)) - BigInt(1),
      ])
        add(`caps-${per}-${total}`, (t) => {
          t.assets = [{ token, maxPerCall: per, maxTotal: total }];
        });
    add('zero-pc-hard-cap', (t) => {
      t.maxGasPerCall = BigInt(0);
    });
    add('zero-assets', (t) => {
      t.assets = [];
    });
    add('duplicate-asset', (t) => {
      t.assets = [...t.assets, t.assets[0]];
    });
    add('zero-token', (t) => {
      t.assets = [
        { ...t.assets[0], token: '0x0000000000000000000000000000000000000000' },
      ];
    });
    add('empty-programs', (t) => {
      t.programs = [];
    });
    add('zero-cea', (t) => {
      t.expectedCEA = key('00');
    });
    add('zero-gateway', (t) => {
      t.gatewayProgram = key('00');
    });
    add('zero-expiry', (t) => {
      t.validUntil = 0;
    });
    add('no-pins', (t) => {
      t.pins = [];
    });
    add('duplicate-pin', (t) => {
      t.pins = [...t.pins, t.pins[0]];
    });
    add('pin-rule-outside', (t) => {
      t.pins[0].ruleIndex = 1;
    });
    add('pin-index-outside', (t) => {
      t.pins[0].accountIndex = 64;
    });
    add('no-cea-coverage', (t) => {
      t.ceaAccounts = [];
    });
    add('duplicate-cea', (t) => {
      t.ceaAccounts = [t.expectedCEA, t.expectedCEA];
    });
    add('forbidden-program', (t) => {
      t.programs[0].program = t.gatewayProgram;
    });
    add('overlapping-program-rules', (t) => {
      t.programs = [...t.programs, { ...t.programs[0] }];
      t.pins = [...t.pins, { ...t.pins[0], ruleIndex: 1 }];
    });
    for (const count of [0, 1, 63, 64, 65])
      add(`account-count-${count}`, (t) => {
        t.programs[0].maxAccounts = count;
      });
    for (const len of [0, 1, 8, 9])
      add(`tag-len-${len}`, (t) => {
        t.programs[0].discriminatorLen = len;
      });
    add('dataless', (t) => {
      t.programs[0].dataless = true;
      t.programs[0].discriminatorLen = 0;
    });
    for (let i = 0; i < 64; i++) {
      const mode = random(4),
        width = [0, 1, 2, 8, 9, 32, 33][random(7)],
        fromEnd = Boolean(random(2));
      const offset = [0, 1, width, 1024 - width, 1024, 1025][random(6)];
      add(`pin-seed-${i}`, (t) => {
        t.dataPins = [
          {
            ruleIndex: 0,
            fromEnd,
            offset,
            offsetB: width,
            len: width,
            mode,
            expected: key('00'),
            num: BigInt(mode === 3 ? random(2) : 0),
            den: BigInt(mode === 3 ? random(2) : 0),
          },
        ];
      });
    }
    const mismatches: string[] = [];
    let accepted = 0,
      rejected = 0;
    const now = Number((await h.publicClient.getBlock()).timestamp);
    for (const c of cases) {
      let sdk = true,
        contract = true;
      try {
        validateSvmTerms(c.terms, now);
      } catch {
        sdk = false;
      }
      try {
        await h.publicClient.call({
          to: wallet,
          data: v4.encodeGrantRules(session(c.terms)),
          account: h.wallets[0].account!.address,
        });
      } catch (e) {
        contract = false;
        expect(decodeAgenticRevert(e)).toBeDefined();
      }
      if (contract) accepted++;
      else rejected++;
      if (sdk !== contract)
        mismatches.push(c.name + `: sdk=${sdk},contract=${contract}`);
    }
    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
    expect(mismatches).toEqual([]);
    console.log(
      JSON.stringify({
        corpus: 'svm-grant',
        seed,
        cases: cases.length,
        accepted,
        rejected,
        mismatches,
      })
    );
  });

  it('payload mutation corpus agrees with actual URP authorization and rejects without metering', async () => {
    const t = clone(terms);
    t.programs[0].maxAccounts = 0;
    t.dataPins = [
      {
        ruleIndex: 0,
        fromEnd: false,
        offset: 1,
        offsetB: 0,
        len: 1,
        mode: 1,
        expected: `0x${'00'.repeat(31)}05`,
        num: BigInt(0),
        den: BigInt(0),
      },
    ];
    await h.write(0, wallet, v4.abis.wallet, 'grantRules', [session(t)]);
    const [id] = await h.publicClient.readContract({
      address: h.addresses.engine,
      abi: v4.abis.engine,
      functionName: 'getPermissionIDs',
      args: [wallet],
    });
    await h.publicClient.waitForTransactionReceipt({
      hash: await h.wallets[4].sendTransaction({
        to: wallet,
        value: BigInt(10) ** BigInt(18),
        account: h.wallets[4].account!,
        chain: h.wallets[4].chain,
      }),
    });
    await h.write(0, token, TOKEN, 'mint', [wallet, BigInt(100)]);
    await h.write(0, wallet, v4.abis.wallet, 'execute', [
      key('00'),
      v4.packSingle({
        target: token,
        value: BigInt(0),
        data: encodeFunctionData({
          abi: TOKEN,
          functionName: 'approve',
          args: [h.addresses.gateway, BigInt(100)],
        }),
      }),
    ]);
    const base = encodeAgwSvmPayload(
      PROGRAM,
      [{ pubkey: t.expectedCEA, isWritable: true }],
      new Uint8Array([1, 5])
    );
    const cases: { name: string; payload: Hex }[] = [
      { name: 'base', payload: base },
    ];
    for (const amount of [0, 4, 5, 6, 255])
      cases.push({
        name: `floor-${amount}`,
        payload: encodeAgwSvmPayload(
          PROGRAM,
          [{ pubkey: t.expectedCEA, isWritable: true }],
          new Uint8Array([1, amount])
        ),
      });
    cases.push({
      name: 'uncovered-cea-alias',
      payload: encodeAgwSvmPayload(
        PROGRAM,
        [
          { pubkey: t.expectedCEA, isWritable: true },
          { pubkey: t.expectedCEA, isWritable: false },
        ],
        new Uint8Array([1, 5])
      ),
    });
    cases.push({
      name: 'pin-substitution',
      payload: encodeAgwSvmPayload(
        PROGRAM,
        [{ pubkey: key('66'), isWritable: true }],
        new Uint8Array([1, 5])
      ),
    });
    for (let i = 0; i < 80; i++) {
      const bytes = Buffer.from(base.slice(2), 'hex');
      if (i % 4 === 0)
        cases.push({
          name: `truncate-${i}`,
          payload: `0x${bytes
            .subarray(0, random(bytes.length))
            .toString('hex')}`,
        });
      else if (i % 4 === 1)
        cases.push({
          name: `trailing-${i}`,
          payload: `${base}${random(256).toString(16).padStart(2, '0')}` as Hex,
        });
      else {
        const at = random(bytes.length);
        bytes[at] ^= 1 << random(8);
        cases.push({
          name: `flip-${i}-${at}`,
          payload: `0x${bytes.toString('hex')}`,
        });
      }
    }
    const mismatches: string[] = [];
    let accepted = 0,
      rejected = 0;
    for (const c of cases) {
      let sdk = true,
        contract = true;
      try {
        validateAgwSvmPayload(t, PROGRAM, c.payload);
      } catch {
        sdk = false;
      }
      const data = encodeFunctionData({
        abi: parseAbi([
          'function sendUniversalTxOutbound((bytes recipient,address token,uint256 amount,uint256 gasLimit,uint256 gasPrice,uint256 maxPCForGas,bytes payload,address revertRecipient) req) payable',
        ]),
        functionName: 'sendUniversalTxOutbound',
        args: [
          {
            recipient: PROGRAM,
            token,
            amount: BigInt(1),
            gasLimit: BigInt(200_000),
            gasPrice: BigInt(0),
            maxPCForGas: BigInt(10) ** BigInt(15),
            payload: c.payload,
            revertRecipient: wallet,
          },
        ],
      });
      try {
        await h.publicClient.simulateContract({
          address: wallet,
          abi: v4.abis.wallet,
          functionName: 'executeAsAgent',
          args: [
            id,
            key('00'),
            v4.packSingle({
              target: h.addresses.gateway,
              value: BigInt(11) * BigInt(10) ** BigInt(14),
              data,
            }),
          ],
          account: h.wallets[1].account!.address,
        });
      } catch (e) {
        contract = false;
        expect(decodeAgenticRevert(e)).toBeDefined();
      }
      if (contract) accepted++;
      else rejected++;
      if (sdk !== contract)
        mismatches.push(c.name + `: sdk=${sdk},contract=${contract}`);
    }
    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
    expect(mismatches).toEqual([]);
    // Every case used eth_call; even successful probes cannot spend an asset.
    expect(
      await h.publicClient.readContract({
        address: token,
        abi: parseAbi(['function balanceOf(address) view returns(uint256)']),
        functionName: 'balanceOf',
        args: [wallet],
      })
    ).toBe(BigInt(100));
    console.log(
      JSON.stringify({
        corpus: 'svm-payload',
        seed,
        cases: cases.length,
        accepted,
        rejected,
        mismatches,
      })
    );
  });
});
