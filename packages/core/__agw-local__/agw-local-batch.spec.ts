/** Real EIP-7702 self-delegation and real AGW/engine/policy; executor is a small
 * test-only ERC-7821-shaped CALL dispatcher. No UEA relay or live network. */
import {
  encodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { AgenticRevertError, CHAIN, type PushChain } from '../src';
import { PUSH_BATCH_EXECUTOR_ADDRESS } from '../src/lib/constants/chain';
import { startHarness, type Harness } from './harness';
import { readNativeCounters } from '../__e2e__/shared/agw-state';

const ABI = parseAbi([
  'function increment()',
  'function counter() view returns(uint256)',
]);
let h: Harness;
let owner: PushChain;
let previous: Address | undefined;

beforeAll(async () => {
  h = await startHarness(18552);
  previous = PUSH_BATCH_EXECUTOR_ADDRESS[CHAIN.PUSH_LOCALNET];
  const executor = await h.deploy(
    0,
    'HarnessAtomicExecutor',
    'HarnessFixtures.sol'
  );
  PUSH_BATCH_EXECUTOR_ADDRESS[CHAIN.PUSH_LOCALNET] = executor;
  owner = await h.client(0);
});
afterAll(async () => {
  if (previous) PUSH_BATCH_EXECUTOR_ADDRESS[CHAIN.PUSH_LOCALNET] = previous;
  else delete PUSH_BATCH_EXECUTOR_ADDRESS[CHAIN.PUSH_LOCALNET];
  await h?.stop();
});

async function walletFor(maxCalls: number) {
  const result = await owner.agentic.create('native-batch', {
    rules: [
      {
        agent: h.wallets[1].account!.address,
        target: h.addresses.target,
        selector: 'increment()',
        validUntil: Number((await h.publicClient.getBlock()).timestamp) + 3600,
        maxCalls,
      },
    ],
  });
  const agent = await h.client(1, { agenticWallet: result.wallet });
  return { ...result, agent };
}
const calls = () =>
  Array.from({ length: 2 }, () => ({
    to: h.addresses.target,
    value: BigInt(0),
    data: encodeFunctionData({ abi: ABI, functionName: 'increment' }),
  }));
const counter = () =>
  h.publicClient.readContract({
    address: h.addresses.target,
    abi: ABI,
    functionName: 'counter',
  });

it('atomic native agent array preserves the agent sender and meters both actions', async () => {
  const { wallet, rulesIds, agent } = await walletFor(3);
  const before = await counter();
  const tx = await agent.universal.sendTransaction({
    to: h.addresses.target,
    data: calls(),
  });
  expect((await tx.wait()).status).toBe(1);
  expect(tx.from).toBe(wallet);
  expect(tx.agentic?.nativeCalls).toHaveLength(2);
  expect(await counter()).toBe(before + BigInt(2));
  expect(
    await readNativeCounters(
      h.publicClient,
      h.generation.addresses,
      wallet,
      rulesIds[0]
    )
  ).toMatchObject({ callsUsed: 2 });
  // Verify actual type-4 outer transaction and its signer identity independently.
  const raw = await h.publicClient.getTransaction({ hash: tx.hash as Hex });
  expect(raw.type).toBe('eip7702');
  expect(getAddress(raw.from)).toBe(h.wallets[1].account!.address);
  expect(getAddress(raw.to as Address)).toBe(h.wallets[1].account!.address);
});

it('failure of a later native action rolls back the earlier call and its counters', async () => {
  const { wallet, rulesIds, agent } = await walletFor(1);
  const before = await counter();
  const nonceBefore = await h.publicClient.getTransactionCount({
    address: h.wallets[1].account!.address,
  });
  await expect(
    agent.universal.sendTransaction({ to: h.addresses.target, data: calls() })
  ).rejects.toBeInstanceOf(AgenticRevertError);
  // Prove this was a mined transaction failure, not an early SDK rejection.
  expect(
    await h.publicClient.getTransactionCount({
      address: h.wallets[1].account!.address,
    })
  ).toBeGreaterThan(nonceBefore);
  expect(await counter()).toBe(before);
  expect(
    await readNativeCounters(
      h.publicClient,
      h.generation.addresses,
      wallet,
      rulesIds[0]
    )
  ).toMatchObject({ callsUsed: 0 });
});
