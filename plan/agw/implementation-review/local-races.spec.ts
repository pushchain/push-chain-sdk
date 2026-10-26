// Reviewer regressions against real e704d5b contracts on local Anvil only.
import { encodeFunctionData, parseAbi, type Address } from 'viem';
import { startHarness, type Harness } from '../../../packages/core/__agw-local__/harness';
import type { AgenticRuntime } from '../../../packages/core/src/lib/agentic/runtime';
import { CHAIN, type PushChain } from '../../../packages/core/src';
import { e704d5b } from '../../../packages/core/src/lib/agentic/contracts/e704d5b';

const TOKEN = parseAbi(['function mint(address,uint256)', 'function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)']);
let h: Harness;
let owner: PushChain;
beforeAll(async () => { h = await startHarness(); owner = await h.client(0); });
afterAll(async () => { await h?.stop(); });

it('R1 a raced creation must not grant permissions on the concurrently created wallet', async () => {
  const expected = await owner.agentic.derive();
  const rt = (owner as unknown as { agenticRuntime: AgenticRuntime }).agenticRuntime;
  const execute = rt.execute;
  let raced = false;
  rt.execute = async (params, options) => {
    if (!raced) {
      raced = true;
      await h.write(0, h.addresses.factory, h.generation.contracts.abis.factory, 'deployWallet', ['other-purpose-wallet']);
    }
    return execute(params, options);
  };
  let error: unknown;
  try {
    await owner.agentic.create('intended-agent-wallet', { rules: [{ agent: h.wallets[1].account!.address, target: h.addresses.target, selector: 'increment()', validUntil: Number((await h.publicClient.getBlock()).timestamp) + 3600 }] });
  } catch (e) { error = e; }
  finally { rt.execute = execute; }
  expect(error).toMatchObject({ code: 'INDEX_RACE' });
  const ids = await h.publicClient.readContract({ address: h.addresses.engine, abi: h.generation.contracts.abis.engine, functionName: 'getPermissionIDs', args: [expected.address] });
  // The SDK threw, but the old predicted wallet must not acquire the new permission.
  expect(ids).toHaveLength(0);
});

it('R4 owner outbound must not restore an allowance revoked after composition', async () => {
  const { wallet } = await owner.agentic.create('allowance-race', { rules: [] });
  const token = await h.deploy(0, 'HarnessPRC20', 'HarnessFixtures.sol', [CHAIN.ETHEREUM_SEPOLIA, 6]);
  await h.write(0, token, TOKEN, 'mint', [wallet, BigInt(1000)]);
  const fundingHash = await h.wallets[0].sendTransaction({ to: wallet, value: BigInt(10) ** BigInt(17), account: h.wallets[0].account!, chain: h.wallets[0].chain });
  await h.publicClient.waitForTransactionReceipt({ hash: fundingHash });
  const c = await h.client(0, { agenticWallet: wallet });
  await c.universal.sendTransaction({ to: token, data: encodeFunctionData({ abi: TOKEN, functionName: 'approve', args: [h.addresses.gateway, BigInt(50)] }) });
  const rt = (c as unknown as { agenticRuntime: AgenticRuntime }).agenticRuntime;
  rt.resolvePrc20 = () => token;
  rt.resolveCEA = async () => ({ cea: h.wallets[2].account!.address, isDeployed: true });
  rt.quoteOutbound = async () => ({ protocolFee: BigInt(10) ** BigInt(14), nativeValueForGas: BigInt(10) ** BigInt(15), gasLimitUsed: BigInt(200000) });
  const execute = rt.execute;
  let raced = false;
  rt.execute = async (params, options) => {
    if (!raced) {
      raced = true;
      const revoke = e704d5b.encodeExecute([{ target: token, value: BigInt(0), data: encodeFunctionData({ abi: TOKEN, functionName: 'approve', args: [h.addresses.gateway, BigInt(0)] }) }]);
      await execute({ to: wallet, data: revoke });
    }
    return execute(params, options);
  };
  try {
    await c.universal.sendTransaction({ to: { address: h.wallets[2].account!.address as Address, chain: CHAIN.ETHEREUM_SEPOLIA }, data: '0xd09de08a', funds: { amount: BigInt(10) } });
  } finally { rt.execute = execute; }
  const remaining = await h.publicClient.readContract({ address: token, abi: TOKEN, functionName: 'allowance', args: [wallet, h.addresses.gateway] });
  expect(remaining).toBe(BigInt(0));
});
