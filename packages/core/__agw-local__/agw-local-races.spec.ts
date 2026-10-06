/**
 * Race regressions found during independent SDK review,
 * against the real pinned v4 contracts on local anvil.
 *  R1 — a concurrent creation must never let this create() grant on a wallet it
 *       did not deploy (the deploy is index-bound through deployWalletWithSig).
 *  R4 — an owner outbound must never restore an allowance revoked after the
 *       SDK read it (the SDK never writes allowances).
 */
import { encodeFunctionData, parseAbi, type Address } from 'viem';
import { AgenticRevertError, CHAIN, type PushChain } from '../src';
import type { AgenticRuntime } from '../src/lib/agentic/runtime';
import { v4 } from '../src/lib/agentic/contracts/v4';
import { AGENTIC_ERROR_CODE } from '../src/lib/agentic/errors';
import { startHarness, type Harness } from './harness';

const TOKEN = parseAbi([
  'function mint(address,uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
]);
const internalsOf = (c: PushChain) =>
  (c as unknown as { agenticRuntime: AgenticRuntime }).agenticRuntime;

describe('AGW race regressions (real v4 contracts)', () => {
  let h: Harness;
  let owner: PushChain;
  beforeAll(async () => {
    h = await startHarness(18549);
    owner = await h.client(0);
  });
  afterAll(async () => {
    await h?.stop();
  });

  it('R1 a concurrent creation makes create() fail with nothing granted on either wallet', async () => {
    const expected = await owner.agentic.derive();
    const rt = internalsOf(owner);
    const execute = rt.execute;
    rt.execute = async (params, options) => {
      rt.execute = execute;
      await h.write(
        0,
        h.addresses.factory,
        h.generation.contracts.abis.factory,
        'deployWallet',
        ['other-purpose-wallet']
      );
      return execute(params, options);
    };
    const err = await owner.agentic
      .create('intended', {
        rules: [
          {
            agent: h.wallets[1].account!.address,
            target: h.addresses.target,
            selector: 'increment()',
            validUntil:
              Number((await h.publicClient.getBlock()).timestamp) + 3600,
          },
        ],
      })
      .catch((e) => e)
      .finally(() => {
        rt.execute = execute;
      });
    expect(err).toMatchObject({
      code: AGENTIC_ERROR_CODE.INDEX_RACE,
      details: { committed: false },
    });
    const permissionIds = (address: Address) =>
      h.publicClient.readContract({
        address: h.addresses.engine,
        abi: h.generation.contracts.abis.engine,
        functionName: 'getPermissionIDs',
        args: [address],
      });
    expect(await permissionIds(expected.address)).toHaveLength(0);
    const next = await owner.agentic.derive();
    expect(next.index).toBe(expected.index + 1);
    expect(await permissionIds(next.address)).toHaveLength(0);
    // A retry re-reads the slot and succeeds.
    const retried = await owner.agentic.create('intended', { rules: [] });
    expect(retried.index).toBe(next.index);
  });

  it('R4 an allowance revoked after the SDK read it stays revoked; the outbound fails on-chain', async () => {
    const { wallet } = await owner.agentic.create('allowance-race', {
      rules: [],
    });
    const token = await h.deploy(0, 'HarnessPRC20', 'HarnessFixtures.sol', [
      CHAIN.ETHEREUM_SEPOLIA,
      6,
    ]);
    await h.write(0, token, TOKEN, 'mint', [wallet, BigInt(1000)]);
    await h.publicClient.waitForTransactionReceipt({
      hash: await h.wallets[0].sendTransaction({
        to: wallet,
        value: BigInt(10) ** BigInt(17),
        account: h.wallets[0].account!,
        chain: h.wallets[0].chain,
      }),
    });
    const c = await h.client(0, { agenticWallet: wallet });
    await (
      await c.universal.sendTransaction({
        to: token,
        data: encodeFunctionData({
          abi: TOKEN,
          functionName: 'approve',
          args: [h.addresses.gateway, BigInt(50)],
        }),
      })
    ).wait();
    const rt = internalsOf(c);
    rt.resolvePrc20 = () => token;
    rt.resolveCEA = async () => ({
      cea: h.wallets[2].account!.address,
      isDeployed: true,
    });
    rt.quoteOutbound = async () => ({
      protocolFee: BigInt(10) ** BigInt(14),
      nativeValueForGas: BigInt(10) ** BigInt(15),
      gasLimitUsed: BigInt(200000),
    });
    const execute = rt.execute;
    rt.execute = async (params, options) => {
      rt.execute = execute;
      const revoke = v4.encodeExecute([
        {
          target: token,
          value: BigInt(0),
          data: encodeFunctionData({
            abi: TOKEN,
            functionName: 'approve',
            args: [h.addresses.gateway, BigInt(0)],
          }),
        },
      ]);
      await (await execute({ to: wallet, data: revoke })).wait();
      return execute(params, options);
    };
    const err = await c.universal
      .sendTransaction({
        to: {
          address: h.wallets[3].account!.address as Address,
          chain: CHAIN.ETHEREUM_SEPOLIA,
        },
        data: '0xd09de08a',
        funds: { amount: BigInt(10) },
      })
      .catch((e) => e)
      .finally(() => {
        rt.execute = execute;
      });
    expect(err).toBeInstanceOf(AgenticRevertError);
    expect(err.message).toContain('0x10bad147'); // LowAllowance() — the token refused the pull
    expect(
      await h.publicClient.readContract({
        address: token,
        abi: TOKEN,
        functionName: 'allowance',
        args: [wallet, h.addresses.gateway],
      })
    ).toBe(BigInt(0));
  });
});
