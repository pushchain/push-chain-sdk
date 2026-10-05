/**
 * Contract-generated vectors for the pure AGW codecs. Every `expected` value
 * below is computed BY THE PINNED CONTRACTS (pure engine/factory views, or
 * state read back after a real grant), never by the SDK under test.
 *
 *   AGW_WRITE_VECTORS=1 → (re)write src/lib/agentic/__fixtures__/v4-vectors.json
 *   otherwise           → assert the committed file still matches the contracts
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getAddress, numberToHex, type Address, type Hex } from 'viem';
import { buildSession } from '../src/lib/agentic/codec/session';
import { agentConfig } from '../src/lib/agentic/codec/ids';
import {
  encodeNativeTerms,
  nativeRuleToTerms,
} from '../src/lib/agentic/codec/native';
import {
  encodeEnvelope,
  encodeSession,
} from '../src/lib/agentic/codec/session';
import type { NativeRule } from '../src/lib/agentic/agentic.types';
import { startHarness, type Harness } from './harness';

const FIXTURE = join(
  __dirname,
  '..',
  'src',
  'lib',
  'agentic',
  '__fixtures__',
  'v4-vectors.json'
);
const bigintJson = (v: unknown) =>
  JSON.stringify(
    v,
    (_k, x) => (typeof x === 'bigint' ? { $bigint: x.toString() } : x),
    2
  );

describe('contract-generated AGW vectors (v4)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness(18548);
  });
  afterAll(async () => {
    await h?.stop();
  });

  it('matches the committed fixture (or writes it)', async () => {
    const pc = h.publicClient;
    const gen = h.generation;
    const validator = h.addresses.validator;
    const agents: Address[] = [
      h.wallets[1].account!.address,
      h.wallets[2].account!.address,
      getAddress('0x00000000000000000000000000000000000000ff'),
    ];

    // rulesId: SmartSession.getPermissionId is pure over (validator, initData, salt).
    const rulesId = [];
    for (const agent of agents) {
      for (const grantNonce of [
        BigInt(0),
        BigInt(1),
        BigInt(7),
        BigInt(2) ** BigInt(63),
      ]) {
        const session = {
          ...buildSession({
            validator,
            agent,
            rulesPolicy: h.addresses.rulesPolicy,
            actions: [],
          }),
          salt: numberToHex(grantNonce, { size: 32 }),
        };
        const expected = (await pc.readContract({
          address: h.addresses.engine,
          abi: gen.contracts.abis.engine,
          functionName: 'getPermissionId',
          args: [session as never],
        })) as Hex;
        rulesId.push({
          validator,
          agent,
          grantNonce,
          agentConfig: agentConfig(agent),
          expected,
        });
      }
    }

    // deriveWallet: factory.predictWallet for fresh owners (index 0) and a used owner (0..next).
    const deriveWallet = [];
    const owners: Address[] = [
      h.wallets[3].account!.address,
      getAddress('0x1111111111111111111111111111111111111111'),
    ];
    for (const owner of owners) {
      const [expected] = (await pc.readContract({
        address: h.addresses.factory,
        abi: gen.contracts.abis.factory,
        functionName: 'predictWallet',
        args: [owner, BigInt(0)],
      })) as readonly [Address, boolean];
      deriveWallet.push({
        factory: h.addresses.factory,
        walletImplementation: h.addresses.walletImplementation,
        owner,
        index: 0,
        expected,
      });
    }

    // Native session round trip: SDK-encoded grant, contract-stored terms and IDs.
    const owner = await h.client(0);
    const rule: NativeRule = {
      agent: agents[0],
      target: h.addresses.target,
      selector: 'deposit(address,uint256)',
      validUntil: 4102444800, // 2100-01-01, fixed so the vector is reproducible
      pins: [{ arg: 0, expected: agents[1] }],
      amount: { arg: 1, maxPerCall: BigInt(10), maxTotal: BigInt(100) },
      maxValuePerCall: BigInt(5),
      maxValueTotal: BigInt(50),
      maxCalls: 3,
    };
    const created = await owner.agentic.create('vectors', { rules: [rule] });
    const wallet = created.wallet;
    const rid = created.rulesIds[0];
    const [actionId] = (await pc.readContract({
      address: h.addresses.engine,
      abi: gen.contracts.abis.engine,
      functionName: 'getEnabledActions',
      args: [wallet, rid],
    })) as Hex[];
    const { terms } = nativeRuleToTerms(rule, { nowSeconds: 0 });
    const nativeChain = `eip155:${await pc.getChainId()}`;
    const session = buildSession({
      validator,
      agent: rule.agent,
      rulesPolicy: h.addresses.rulesPolicy,
      actions: [
        {
          target: terms.target,
          selector: terms.selector,
          initData: encodeEnvelope(nativeChain, encodeNativeTerms(terms)),
        },
      ],
    });
    // configId is recovered by searching what the policy accepts: the stored config is only
    // initialized under the correct key, so a successful read proves the derivation.
    const { configId } = await import('../src/lib/agentic/codec/ids');
    const cid = configId(wallet, rid, actionId);
    const stored = (await pc.readContract({
      address: h.addresses.rulesPolicy,
      abi: gen.contracts.abis.policy,
      functionName: 'getNativeConfig',
      args: [cid, wallet],
    })) as {
      initialized: boolean;
      target: Address;
      selector: Hex;
      pins: readonly { offset: number; expected: Hex }[];
      amount: { offset: number };
    };
    const native = {
      rule,
      nativeChain,
      wallet,
      rulesId: rid,
      actionId,
      configId: cid,
      configInitialized: stored.initialized,
      storedTarget: stored.target,
      storedSelector: stored.selector,
      storedPins: stored.pins.map((p) => ({
        offset: Number(p.offset),
        expected: p.expected,
      })),
      storedAmountOffset: Number(stored.amount.offset),
      encodedSession: encodeSession(session),
    };

    const vectors = {
      provenance: {
        agwCommit: h.generation.sourceCommit,
        generatedBy: 'packages/core/__agw-local__/vectors.spec.ts',
        toolchain: safe(
          () => execSync('forge --version').toString().split('\n')[0]
        ),
        chainId: await pc.getChainId(),
        note: 'Addresses are deterministic for a fresh anvil + the harness deploy order.',
      },
      rulesId,
      deriveWallet,
      native,
    };

    if (process.env['AGW_WRITE_VECTORS'] === '1') {
      mkdirSync(join(FIXTURE, '..'), { recursive: true });
      writeFileSync(FIXTURE, bigintJson(vectors) + '\n');
    }
    const committed = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const { provenance: _a, ...current } = JSON.parse(bigintJson(vectors));
    const { provenance: _b, ...saved } = committed;
    expect(current).toEqual(saved);
    expect(native.configInitialized).toBe(true);
  });
});

function safe(f: () => string): string {
  try {
    return f();
  } catch {
    return 'unknown';
  }
}
