/**
 * Real-contract checks for the harder AGW paths (pinned e704d5b on anvil).
 * The universal-outbound block drives the SDK's composer with a runtime whose
 * CEA and fee quote are local stand-ins (no destination chain or price feeds
 * exist here); URP still decides every gate on the composed request.
 */
import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  toBytes,
  type Address,
  type Hex,
} from 'viem';
import { AgenticRevertError, CHAIN, type PushChain } from '../src';
import { AGENTIC_ERROR_CODE, AgenticError } from '../src/lib/agentic/errors';
import { agenticSend } from '../src/lib/agentic/execution/send';
import { updateRules } from '../src/lib/agentic/management/rules-write';
import type { AgenticRuntime } from '../src/lib/agentic/runtime';
import type { AgenticExecutionContext } from '../src/lib/agentic/context';
import { buildSession, encodeEnvelope } from '../src/lib/agentic/codec/session';
import { encodeUniversalTermsE704d5b } from '../src/lib/agentic/codec/historical/e704d5b-universal';
import { startHarness, type Harness } from './harness';

const TARGET_ABI = parseAbi([
  'function increment()',
  'function deposit(address beneficiary, uint256 amount) payable',
  'function lastBeneficiary() view returns (address)',
  'function counter() view returns (uint256)',
]);
const TOKEN_ABI = parseAbi([
  'function mint(address to, uint256 amount)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function totalSupply() view returns (uint256)',
]);
const GATEWAY_ABI = parseAbi([
  'function outboundCount() view returns (uint256)',
  'function lastSender() view returns (address)',
  'function lastRequestHash() view returns (bytes32)',
]);
const CORE_ABI = parseAbi([
  'function getOutboundTxGasAndFees(address,uint256) view returns (address,uint256,uint256,uint256,string,uint256)',
]);

type Internals = { agenticRuntime: AgenticRuntime; agenticContext?: AgenticExecutionContext };
const internals = (c: PushChain) => c as unknown as Internals;

async function chainNow(h: Harness): Promise<number> {
  return Number((await h.publicClient.getBlock()).timestamp);
}
async function warp(h: Harness, seconds: number): Promise<void> {
  await h.publicClient.request({ method: 'evm_increaseTime' as never, params: [seconds] as never });
  await h.publicClient.request({ method: 'evm_mine' as never, params: [] as never });
}
const fund = (h: Harness, to: Address, value: bigint) =>
  h.wallets[4].sendTransaction({ to, value, account: h.wallets[4].account!, chain: h.wallets[4].chain });

describe('AGW advanced paths against real e704d5b contracts', () => {
  let h: Harness;
  let owner: PushChain;
  let agentAddr: Address;

  beforeAll(async () => {
    h = await startHarness(18547);
    owner = await h.client(0);
    agentAddr = h.wallets[1].account!.address;
  });
  afterAll(async () => {
    await h?.stop();
  });

  describe('native pins, amount and value caps', () => {
    let wallet: Address;
    let agent: PushChain;
    const beneficiary = getAddress('0x00000000000000000000000000000000000b0b0b');

    beforeAll(async () => {
      const created = await owner.agentic.create('pins', {
        rules: [
          {
            agent: agentAddr,
            target: h.addresses.target,
            selector: 'deposit(address,uint256)',
            validUntil: (await chainNow(h)) + 3600,
            pins: [{ arg: 0, expected: beneficiary }],
            amount: { arg: 1, maxPerCall: BigInt(10), maxTotal: BigInt(15) },
            maxValuePerCall: BigInt(1000),
            maxValueTotal: BigInt(1000),
          },
        ],
      });
      wallet = created.wallet;
      await h.publicClient.waitForTransactionReceipt({ hash: await fund(h, wallet, BigInt(10) ** BigInt(18)) });
      agent = await h.client(1, { agenticWallet: wallet });
    });

    const deposit = (to: Address, amount: bigint, value = BigInt(0)) =>
      agent.universal.sendTransaction({
        to: h.addresses.target,
        value,
        data: encodeFunctionData({ abi: TARGET_ABI, functionName: 'deposit', args: [to, amount] }),
      });

    it('a pinned beneficiary and an in-cap amount pass', async () => {
      await (await deposit(beneficiary, BigInt(5), BigInt(10))).wait();
      expect(
        await h.publicClient.readContract({ address: h.addresses.target, abi: TARGET_ABI, functionName: 'lastBeneficiary' })
      ).toBe(beneficiary);
    });

    it('a wrong beneficiary is rejected by URP with a decoded error and no state change', async () => {
      const err = await deposit(agentAddr, BigInt(5)).catch((e) => e);
      expect(err).toBeInstanceOf(AgenticRevertError);
      expect(err.decodedError?.name).toBe("PolicyCheckReverted(ArgPinMismatch)");
      const rec = await owner.agentic.wallet(wallet).rules.list();
      expect(rec.rules[0].spent).toMatchObject({ amountSpent: BigInt(5), callsUsed: 1 });
    });

    it('per-call and lifetime amount caps are enforced on-chain', async () => {
      await expect(deposit(beneficiary, BigInt(11))).rejects.toBeInstanceOf(AgenticRevertError);
      await (await deposit(beneficiary, BigInt(10))).wait();
      await expect(deposit(beneficiary, BigInt(1))).rejects.toBeInstanceOf(AgenticRevertError);
    });

    it('the decoded native terms carry the pins and caps as stored', async () => {
      const { rules } = await owner.agentic.wallet(wallet).rules.list();
      expect(rules[0].rule).toMatchObject({
        pins: [{ arg: 0, expected: `0x${'0'.repeat(24)}${beneficiary.slice(2).toLowerCase()}` }],
        amount: { arg: 1, maxPerCall: BigInt(10), maxTotal: BigInt(15) },
        maxValuePerCall: BigInt(1000),
      });
    });
  });

  describe('stale-spend replacement race', () => {
    it('an agent spend between the read and inclusion reverts the whole replacement atomically', async () => {
      const created = await owner.agentic.create('race', {
        rules: [{ agent: agentAddr, target: h.addresses.target, selector: 'increment()', validUntil: (await chainNow(h)) + 3600 }],
      });
      const wallet = created.wallet;
      const oldId = created.rulesIds[0];
      const agent = await h.client(1, { agenticWallet: wallet });
      const rt = internals(owner).agenticRuntime;
      const cpBefore = await h.publicClient.readContract({
        address: wallet,
        abi: parseAbi(['function checkpointCount() view returns (uint64)']),
        functionName: 'checkpointCount',
      });
      const racing: AgenticRuntime = {
        ...rt,
        reader: rt.reader,
        execute: async (params, options) => {
          // The agent spends after the SDK read the counters, before the owner's tx lands.
          await (
            await agent.universal.sendTransaction({
              to: h.addresses.target,
              data: encodeFunctionData({ abi: TARGET_ABI, functionName: 'increment' }),
            })
          ).wait();
          return rt.execute(params, options);
        },
      };
      const err = await updateRules(racing, h.generation, wallet, {
        rules: [{ rulesId: oldId, rule: { agent: agentAddr, target: h.addresses.target, selector: 'increment()', validUntil: (await chainNow(h)) + 3600 } }],
      }).catch((e) => e);
      expect(err).toBeInstanceOf(AgenticRevertError);
      // Nothing changed: the old rule is still the only enabled rule and no checkpoint landed.
      const { rules } = await owner.agentic.wallet(wallet).rules.list();
      expect(rules.map((r) => r.rulesId)).toEqual([oldId]);
      expect(
        await h.publicClient.readContract({
          address: wallet,
          abi: parseAbi(['function checkpointCount() view returns (uint64)']),
          functionName: 'checkpointCount',
        })
      ).toBe(cpBefore);
    });
  });

  describe('expiry', () => {
    it('an expired-but-enabled rule still identifies the agent; the send fails on-chain', async () => {
      const created = await owner.agentic.create('expiring', {
        rules: [{ agent: agentAddr, target: h.addresses.target, selector: 'increment()', validUntil: (await chainNow(h)) + 600 }],
      });
      await warp(h, 1200);
      const agent = await h.client(1, { agenticWallet: created.wallet });
      const err = await agent.universal
        .sendTransaction({
          to: h.addresses.target,
          data: encodeFunctionData({ abi: TARGET_ABI, functionName: 'increment' }),
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(AgenticRevertError);
      expect(err.decodedError?.name).toBe("PolicyCheckReverted(RulesExpired)");
    });
  });

  describe('sequential create partial failure and recovery', () => {
    it('reports CREATE_PARTIAL with the deployed wallet and granted IDs; rules.add finishes it', async () => {
      // Chain time runs ahead of the local clock: the SDK accepts validUntil, the policy does not.
      const skewedValidUntil = Math.floor(Date.now() / 1000) + 600;
      await warp(h, 7200);
      const err = await owner.agentic
        .create('partial', {
          rules: [
            { agent: agentAddr, target: h.addresses.target, selector: 'increment()', validUntil: (await chainNow(h)) + 3600 },
            { agent: h.wallets[3].account!.address, target: h.addresses.target, selector: 'increment()', validUntil: skewedValidUntil },
          ],
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(AgenticError);
      expect(err.code).toBe(AGENTIC_ERROR_CODE.CREATE_PARTIAL);
      expect(err.details.walletDeployed).toBe(true);
      expect(err.details.grantedRulesIds).toHaveLength(1);
      expect(err.details.confirmedHashes.length).toBeGreaterThanOrEqual(2);
      const wallet = err.details.wallet as Address;
      const added = await owner.agentic.wallet(wallet).rules.add([
        { agent: h.wallets[3].account!.address, target: h.addresses.target, selector: 'increment()', validUntil: (await chainNow(h)) + 3600 },
      ]);
      expect(added.rulesIds).toHaveLength(1);
      const { rules } = await owner.agentic.wallet(wallet).rules.list();
      expect(rules).toHaveLength(2);
    });

    it('rules.add with several rules is one atomic owner batch: OWNER_ACTION + RULES_GRANTED per rule', async () => {
      const created = await owner.agentic.create('multi-add', { rules: [] });
      const before = await h.publicClient.readContract({
        address: created.wallet,
        abi: parseAbi(['function checkpointCount() view returns (uint64)']),
        functionName: 'checkpointCount',
      });
      const added = await owner.agentic.wallet(created.wallet).rules.add([
        { agent: agentAddr, target: h.addresses.target, selector: 'increment()', validUntil: (await chainNow(h)) + 3600 },
        { agent: h.wallets[3].account!.address, target: h.addresses.target, selector: 'increment()', validUntil: (await chainNow(h)) + 3600 },
      ]);
      expect(added.rulesIds).toHaveLength(2);
      expect(added.tx.atomic).toBe(true);
      const { checkpoints } = await owner.agentic.wallet(created.wallet).checkpoints({ sinceBlock: added.tx.blockNumber });
      expect(BigInt(checkpoints.length)).toBe(BigInt(4));
      expect(checkpoints.map((c) => c.kind)).toEqual(['OWNER_ACTION', 'RULES_GRANTED', 'OWNER_ACTION', 'RULES_GRANTED']);
      expect(before).toBe(BigInt(0));
    });
  });

  describe('agent EVM outbound (historical single-asset terms, stub gateway)', () => {
    const SEPOLIA = CHAIN.ETHEREUM_SEPOLIA;
    const CEA = getAddress('0x000000000000000000000000000000000000cea1');
    const destTarget = getAddress('0x00000000000000000000000000000000000d0d0d');
    let token: Address;
    let wallet: Address;
    let rulesId: Hex;
    let runtime: AgenticRuntime;
    let ctx: AgenticExecutionContext;
    let ownerAgw: PushChain;

    beforeAll(async () => {
      token = await h.deploy(0, 'HarnessPRC20', 'HarnessFixtures.sol', [SEPOLIA, 6]);
      const created = await owner.agentic.create('outbound', { rules: [] });
      wallet = created.wallet;
      await h.write(0, token, TOKEN_ABI, 'mint', [wallet, BigInt(1_000_000)]);
      await h.publicClient.waitForTransactionReceipt({ hash: await fund(h, wallet, BigInt(10) ** BigInt(17)) });
      // Fixture setup (raw owner call): grant a historical single-asset universal rule.
      const terms = encodeUniversalTermsE704d5b({
        validUntil: (await chainNow(h)) + 3600,
        expectedCEA: CEA,
        asset: token,
        maxAmountPerCall: BigInt(1000),
        maxAmountTotal: BigInt(1500),
        maxPCPerCall: BigInt(10) ** BigInt(16),
        allowedCalls: [{ target: destTarget, selector: '0xd09de08a', beneficiaryOffset: 0, hasBeneficiary: false, maxValue: BigInt(0) }],
      });
      const session = buildSession({
        validator: h.addresses.validator,
        agent: agentAddr,
        rulesPolicy: h.addresses.rulesPolicy,
        actions: [{ target: h.addresses.gateway, selector: '0x77b86bec', initData: encodeEnvelope(SEPOLIA, terms) }],
      });
      await h.write(0, wallet, h.generation.contracts.abis.wallet as never, 'grantRules', [session]);
      [rulesId] = (await h.publicClient.readContract({
        address: h.addresses.engine,
        abi: h.generation.contracts.abis.engine,
        functionName: 'getPermissionIDs',
        args: [wallet],
      })) as Hex[];

      const agent = await h.client(1, { agenticWallet: wallet });
      ctx = internals(agent).agenticContext!;
      const base = internals(agent).agenticRuntime;
      runtime = {
        ...base,
        reader: base.reader,
        resolveCEA: async () => ({ cea: CEA, isDeployed: false }),
        resolvePrc20: () => token,
        quoteOutbound: async (prc20, gasLimit) => {
          const [, gasFee, protocolFee, , , gasLimitUsed] = (await h.publicClient.readContract({
            address: h.addresses.universalCore,
            abi: CORE_ABI,
            functionName: 'getOutboundTxGasAndFees',
            args: [prc20, gasLimit],
          })) as readonly [Address, bigint, bigint, bigint, string, bigint];
          return { protocolFee, nativeValueForGas: gasFee, gasLimitUsed };
        },
      };
      ownerAgw = await h.client(0, { agenticWallet: wallet });
    });

    const send = (amount: bigint) =>
      agenticSend(runtime, ctx, {
        to: { address: destTarget, chain: SEPOLIA },
        data: '0xd09de08a',
        funds: { amount, token: { symbol: 'USDC', decimals: 6, address: token, mechanism: 'approve' } },
      });

    it('fails before signing when the owner has not set a gateway allowance', async () => {
      await expect(send(BigInt(100))).rejects.toMatchObject({
        code: AGENTIC_ERROR_CODE.GATEWAY_ALLOWANCE_INSUFFICIENT,
      });
    });

    it('owner sets a bounded allowance with an ordinary owner-door send; the agent outbound passes URP, pulls and burns', async () => {
      await (
        await ownerAgw.universal.sendTransaction({
          to: token,
          data: encodeFunctionData({ abi: TOKEN_ABI, functionName: 'approve', args: [h.addresses.gateway, BigInt(300)] }),
        })
      ).wait();
      const supplyBefore = (await h.publicClient.readContract({ address: token, abi: TOKEN_ABI, functionName: 'totalSupply' })) as bigint;
      const tx = await send(BigInt(100));
      const receipt = await h.publicClient.waitForTransactionReceipt({ hash: tx.hash as Hex });
      expect(receipt.status).toBe('success');
      expect(await h.publicClient.readContract({ address: h.addresses.gateway, abi: GATEWAY_ABI, functionName: 'lastSender' })).toBe(wallet);
      expect(await h.publicClient.readContract({ address: token, abi: TOKEN_ABI, functionName: 'totalSupply' })).toBe(supplyBefore - BigInt(100));
      expect(await h.publicClient.readContract({ address: token, abi: TOKEN_ABI, functionName: 'allowance', args: [wallet, h.addresses.gateway] })).toBe(BigInt(200));
      // The request the wallet sent: empty recipient, wallet refund, nonzero gas cap, multicall payload.
      const payload = `0x2cc2842d${encodeAbiParameters(
        [{ type: 'tuple[]', components: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }] }],
        [[{ to: destTarget, value: BigInt(0), data: '0xd09de08a' }]]
      ).slice(2)}` as Hex;
      const expected = keccak256(
        encodeAbiParameters(
          [{ type: 'tuple', components: [
            { name: 'recipient', type: 'bytes' }, { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' },
            { name: 'gasLimit', type: 'uint256' }, { name: 'gasPrice', type: 'uint256' }, { name: 'maxPCForGas', type: 'uint256' },
            { name: 'payload', type: 'bytes' }, { name: 'revertRecipient', type: 'address' } ] }],
          [{ recipient: '0x', token, amount: BigInt(100), gasLimit: BigInt(200_000), gasPrice: BigInt(0), maxPCForGas: BigInt(10) ** BigInt(15), payload, revertRecipient: wallet }]
        )
      );
      expect(await h.publicClient.readContract({ address: h.addresses.gateway, abi: GATEWAY_ABI, functionName: 'lastRequestHash' })).toBe(expected);
      expect(tx.from).toBe(wallet);
      expect(tx.route).toBe('UOA_TO_CEA');
      expect(tx.agentic).toMatchObject({ door: 'agent', rulesId, destinationAccount: CEA, chainNamespace: SEPOLIA });
      expect(keccak256(toBytes(SEPOLIA))).toBeTruthy();
    });

    it('owner can remove the allowance; the agent is stopped before signing again', async () => {
      await (
        await ownerAgw.universal.sendTransaction({
          to: token,
          data: encodeFunctionData({ abi: TOKEN_ABI, functionName: 'approve', args: [h.addresses.gateway, BigInt(0)] }),
        })
      ).wait();
      await expect(send(BigInt(10))).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.GATEWAY_ALLOWANCE_INSUFFICIENT });
    });

    it('a call outside the allow-list is rejected by URP on-chain', async () => {
      await (
        await ownerAgw.universal.sendTransaction({
          to: token,
          data: encodeFunctionData({ abi: TOKEN_ABI, functionName: 'approve', args: [h.addresses.gateway, BigInt(50)] }),
        })
      ).wait();
      const err = await agenticSend(runtime, ctx, {
        to: { address: destTarget, chain: SEPOLIA },
        data: '0x12345678',
      }).catch((e) => e);
      expect(err).toBeInstanceOf(AgenticRevertError);
    });
  });
});
