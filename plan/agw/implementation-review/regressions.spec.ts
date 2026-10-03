// Reviewer-authored regressions: desired behavior, expected to fail at 3008497.
import { decodeFunctionData, getAddress, maxUint256, type Address, type Hex } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../../../packages/core/src/lib/constants/enums';
import { ERC20_EVM } from '../../../packages/core/src/lib/constants/abi';
import { currentGeneration, resetAgenticGenerations } from '../../../packages/core/src/lib/agentic/deployments';
import { ADDR, FakeChain, registerFakeGeneration, ruleId } from '../../../packages/core/src/lib/agentic/__tests__/fake-chain';
import { mockRuntime, fakeResponse } from '../../../packages/core/src/lib/agentic/__tests__/mock-runtime';
import { agenticSend } from '../../../packages/core/src/lib/agentic/execution/send';
import { composeOutbound, ownerOutboundCalls } from '../../../packages/core/src/lib/agentic/execution/outbound';
import { nativeRuleToTerms, nativeTermsToRule } from '../../../packages/core/src/lib/agentic/codec/native';
import { adaptTrackedResponse } from '../../../packages/core/src/lib/agentic/response';
import { e704d5b } from '../../../packages/core/src/lib/agentic/contracts/e704d5b';
import type { AgenticExecutionContext } from '../../../packages/core/src/lib/agentic/context';

function setup(door: 'owner' | 'agent' = 'agent') {
  registerFakeGeneration();
  const fake = new FakeChain();
  const wallet = fake.addWallet(ADDR.owner, 'review', [fake.nativeRule(ADDR.agent, ruleId(1))]);
  const gen = currentGeneration(PUSH_NETWORK.TESTNET_DONUT);
  const signer = door === 'owner' ? ADDR.owner : ADDR.agent;
  const rt = mockRuntime(fake, { signer });
  const ctx: AgenticExecutionContext = { wallet: wallet.address, door, signerPushAccount: signer, signerOrigin: { chain: CHAIN.PUSH_TESTNET_DONUT, address: signer }, generation: gen };
  return { fake, wallet, gen, rt, ctx };
}
afterEach(() => resetAgenticGenerations());

it('R2 explicit connected Push destination behaves like the bare native address', async () => {
  const { rt, ctx } = setup();
  await expect(agenticSend(rt, ctx, { to: { address: ADDR.target, chain: CHAIN.PUSH_TESTNET_DONUT }, data: '0xd09de08a' })).resolves.toBeDefined();
});

it('R3 owner funds-only outbound encodes the requested destination address', async () => {
  const { rt, gen, wallet } = setup('owner');
  const out = await composeOutbound(rt, gen, wallet.address, { to: { address: ADDR.target, chain: CHAIN.ETHEREUM_SEPOLIA }, funds: { amount: BigInt(10) } }, { requireCalls: false });
  expect(out.gatewayCall.data.toLowerCase()).toContain(ADDR.target.slice(2).toLowerCase());
});

it('R4 owner outbound accepts an existing unlimited gateway allowance', async () => {
  const { rt, gen, wallet } = setup('owner');
  const out = await composeOutbound(rt, gen, wallet.address, { to: { address: ADDR.target, chain: CHAIN.ETHEREUM_SEPOLIA }, data: '0xd09de08a', funds: { amount: BigInt(10) } }, { requireCalls: false });
  expect(() => ownerOutboundCalls(gen, out, maxUint256)).not.toThrow();
});

it('R5 decoded static-array pin keeps its argument index', () => {
  const input = { agent: ADDR.agent, target: ADDR.target, selector: 'deposit(uint256[2],address)' as const, validUntil: 1800000000, pins: [{ arg: 1, expected: ADDR.other }] };
  const { terms } = nativeRuleToTerms(input, { nowSeconds: 1700000000 });
  const decoded = nativeTermsToRule(terms, ADDR.agent, `0x${'00'.repeat(32)}`);
  expect(decoded.pins?.[0].arg).toBe(1);
});

it('R5 a decoded simple address-pin rule can be re-encoded after restoring its known signature', () => {
  const input = { agent: ADDR.agent, target: ADDR.target, selector: 'deposit(address,uint256)' as const, validUntil: 1800000000, pins: [{ arg: 0, expected: ADDR.other }] };
  const { terms } = nativeRuleToTerms(input, { nowSeconds: 1700000000 });
  const decoded = nativeTermsToRule(terms, ADDR.agent, `0x${'00'.repeat(32)}`);
  expect(() => nativeRuleToTerms({ ...decoded, selector: input.selector }, { nowSeconds: 1700000000 })).not.toThrow();
});

it('R6 replayed outbound must replace a preexisting Push route instead of preserving it', async () => {
  const { rt, gen, wallet } = setup('owner');
  const out = await composeOutbound(rt, gen, wallet.address, { to: { address: ADDR.target, chain: CHAIN.ETHEREUM_SEPOLIA }, data: '0xd09de08a' }, { requireCalls: false });
  const resp = fakeResponse({ to: wallet.address, data: e704d5b.encodeExecute([out.gatewayCall]), route: 'UOA_TO_PUSH' });
  const adapted = await adaptTrackedResponse(rt, resp);
  expect(adapted.route).toBe('UOA_TO_CEA');
});

it('R7 failed recovery RPC must not claim that a confirmed deployment did not happen', async () => {
  registerFakeGeneration();
  const fake = new FakeChain();
  const getCode = fake.getCode.bind(fake);
  let rpcUnavailable = false;
  fake.getCode = async (args) => { if (rpcUnavailable) throw new Error('RPC unavailable'); return getCode(args); };
  const { PushChainBatchExecutionError } = await import('../../../packages/core/src/lib/orchestrator/internals/errors');
  const { createWallet } = await import('../../../packages/core/src/lib/agentic/management/create');
  const rt = mockRuntime(fake, { signer: ADDR.owner, execute: async () => {
    fake.addWallet(ADDR.owner, 'committed');
    rpcUnavailable = true;
    throw new PushChainBatchExecutionError('grant failed', [`0x${'11'.repeat(32)}`]);
  } });
  const err = await createWallet(rt, 'review', { rules: [{ agent: ADDR.agent, target: ADDR.target, selector: 'increment()', validUntil: 1800000000 }] }).catch(e => e);
  expect(err.code).toBe('CREATE_PARTIAL');
  expect(err.details.walletDeployed).not.toBe(false);
});
