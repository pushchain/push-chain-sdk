/** Opt-in funded Donut acceptance. Nothing in this file runs in unit/local validation. */
import type { UniversalRule } from '../../src';
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  fallback,
  http,
  parseAbi,
  parseEventLogs,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { getPRC20Address } from '../../src/lib/universal/prc20-address';
import { getCEAAddress } from '../../src/lib/orchestrator/cea-utils';
import { configId } from '../../src/lib/agentic/codec/ids';
import { CHAIN } from '../../src/lib/constants/enums';
import { MOVEABLE_TOKEN_CONSTANTS } from '../../src/lib/constants/tokens';
import { v5 } from '../../src/lib/agentic/contracts/v5';
import { EVM_CHAIN_FIXTURES } from '@e2e/shared/chain-fixtures';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import {
  AGW_E2E_ENABLED,
  evmClient,
  inSeconds,
  setupAgw,
  type AgwFixture,
} from './_fixture';

const d = AGW_E2E_ENABLED ? describe : describe.skip;
const chain = CHAIN.ETHEREUM_SEPOLIA;
const counter = EVM_CHAIN_FIXTURES.find((x) => x.chain === chain)!.contracts
  .counter as `0x${string}`;

d('agw v5 multi-asset', () => {
  let f: AgwFixture;
  beforeAll(async () => {
    f = await setupAgw();
  });
  afterAll(() => f?.teardown());
  it('1. public create reads and replaces an ordered two-token rule', async () => {
    const rule: UniversalRule = {
      agent: f.agentAddress,
      chainNamespace: chain,
      validUntil: inSeconds(3600),
      maxGasPerCall: parseEther('20'),
      assets: [
        {
          token: MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.ETH,
          maxPerCall: BigInt(1000),
        },
        {
          token: MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.USDC,
          maxPerCall: BigInt(10),
          maxTotal: BigInt(100),
        },
      ],
      allowedCalls: [{ target: counter, selector: 'increment()' as const }],
    };
    const created = await f.owner.agentic.create('v5-two-token', {
      rules: [rule],
    });
    const w = f.owner.agentic.wallet(created.wallet);
    const before = await w.rules.get(created.rulesIds[0]);
    expect(before.rule).toMatchObject({
      assets: [
        {
          maxPerCall: BigInt(1000),
          maxTotal: BigInt(2) ** BigInt(256) - BigInt(1),
        },
        { maxPerCall: BigInt(10), maxTotal: BigInt(100) },
      ],
    });
    expect(before).not.toHaveProperty('spent');
    const count = await f.push.readContract({
      address: created.wallet,
      abi: v5.abis.wallet,
      functionName: 'checkpointCount',
    });
    const replacement = await w.rules.update({
      rules: [{ rulesId: created.rulesIds[0], rule }],
    });
    expect(
      await f.push.readContract({
        address: created.wallet,
        abi: v5.abis.wallet,
        functionName: 'checkpointCount',
      })
    ).toBe(count + BigInt(5));
    expect((await w.rules.list()).rules.map((x) => x.rulesId)).toEqual([
      replacement.rules[0].rulesId,
    ]);
    f.evidence('v5-two-token-replacement', {
      wallet: created.wallet,
      oldId: created.rulesIds[0],
      newId: replacement.rules[0].rulesId,
      txHash: replacement.tx.hash,
    });
  });
  it('2. empty user assets routes a call-only outbound with zero token spend', async () => {
    const created = await f.owner.agentic.create('v5-call-only', {
      rules: [
        {
          agent: f.agentAddress,
          chainNamespace: chain,
          assets: [],
          validUntil: inSeconds(3600),
          maxGasPerCall: parseEther('20'),
          allowedCalls: [{ target: counter, selector: 'increment()' }],
        },
      ],
    });
    const record = await f.owner.agentic
      .wallet(created.wallet)
      .rules.get(created.rulesIds[0]);
    expect(record.rule).toMatchObject({
      assets: [{ maxPerCall: BigInt(0), maxTotal: BigInt(0) }],
    });
    await f.fundPC(created.wallet, parseEther('21'));
    const agent = await f.agent(created.wallet);
    const tx = await agent.universal.sendTransaction({
      to: { address: counter, chain },
      data: '0xd09de08a',
      gasLimit: BigInt(2_000_000),
    });
    const receipt = await tx.wait({ outboundTimeoutMs: 600_000 });
    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeTruthy();
    await verifyExternalTransaction(receipt.externalTxHash as string, chain);
    const [action] = await f.push.readContract({
      address: f.manifest.addresses.sessionEngine,
      abi: v5.abis.engine,
      functionName: 'getEnabledActions',
      args: [created.wallet, created.rulesIds[0]],
    });
    const { configId } = await import('../../src/lib/agentic/codec/ids');
    const cfg = await f.push.readContract({
      address: f.manifest.addresses.rulesPolicy,
      abi: v5.abis.policy,
      functionName: 'getConfig',
      args: [
        configId(created.wallet, created.rulesIds[0], action),
        created.wallet,
      ],
    });
    expect(cfg.assets.map((x) => x.spent)).toEqual([BigInt(0)]);
    f.evidence('v5-call-only', {
      wallet: created.wallet,
      pushTx: tx.hash,
      externalTx: receipt.externalTxHash,
    });
  }, 900_000);
  it('3. both assets execute independently after one token budget is exhausted', async () => {
    const eth = MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.ETH;
    const usdc = MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.USDC;
    const amounts = [BigInt(10) ** BigInt(12), BigInt(10)];
    const tokens = [eth, usdc].map(
      (token) =>
        getPRC20Address(
          { chain, address: token.address },
          { network: f.manifest.network }
        ).address
    );
    // Keep an extra token unit and allowance available so total-limit failures
    // reach URP instead of being masked by the SDK balance/allowance checks.
    for (let i = 0; i < tokens.length; i++) {
      const available = await f.push.readContract({
        address: tokens[i],
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [f.ownerAddress],
      });
      if (available < amounts[i] + BigInt(1))
        throw new Error('Insufficient master funds for two-asset fixture');
    }
    const made = await f.owner.agentic.create('v5-independent-budgets', {
      rules: [
        {
          agent: f.agentAddress,
          chainNamespace: chain,
          validUntil: inSeconds(3600),
          maxGasPerCall: parseEther('20'),
          assets: [eth, usdc].map((token, i) => ({
            token,
            maxPerCall: amounts[i],
            maxTotal: amounts[i],
          })),
          allowedCalls: [{ target: counter, selector: 'increment()' }],
        },
      ],
    });
    await f.fundPC(made.wallet, parseEther('41'));
    const owner = await evmClient(
      process.env['PUSH_PRIVATE_KEY'] as Hex,
      CHAIN.PUSH_TESTNET_DONUT,
      f.manifest.network,
      made.wallet
    );
    for (let i = 0; i < tokens.length; i++) {
      await (
        await f.owner.universal.sendTransaction({
          to: tokens[i],
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [made.wallet, amounts[i] + BigInt(1)],
          }),
        })
      ).wait();
      await (
        await owner.universal.sendTransaction({
          to: tokens[i],
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [f.manifest.addresses.gateway, amounts[i] + BigInt(1)],
          }),
        })
      ).wait();
    }
    const agent = await f.agent(made.wallet);
    const [action] = await f.push.readContract({
      address: f.manifest.addresses.sessionEngine,
      abi: v5.abis.engine,
      functionName: 'getEnabledActions',
      args: [made.wallet, made.rulesIds[0]],
    });
    const key = configId(made.wallet, made.rulesIds[0], action);
    const spent = async () =>
      (
        await f.push.readContract({
          address: f.manifest.addresses.rulesPolicy,
          abi: v5.abis.policy,
          functionName: 'getConfig',
          args: [key, made.wallet],
        })
      ).assets.map((asset) => asset.spent);
    const sep = createPublicClient({
      chain: sepolia,
      transport: fallback(CHAIN_INFO[chain].defaultRPC.map((url) => http(url))),
    });
    const cea = (await getCEAAddress(made.wallet, chain)).cea as Address;
    const params = (i: number, amount = amounts[i]) => ({
      to: { address: counter, chain },
      data: [{ to: counter, value: BigInt(0), data: '0xd09de08a' as Hex }],
      funds: { token: [eth, usdc][i], amount },
      gasLimit: BigInt(2_000_000),
    });
    const hashes: string[] = [];
    expect(await spent()).toEqual([BigInt(0), BigInt(0)]);
    for (let i = 0; i < tokens.length; i++) {
      const beforeDestination =
        i === 0
          ? await sep.getBalance({ address: cea })
          : await sep.readContract({
              address: usdc.address as Address,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [cea],
            });
      const tx = await agent.universal.sendTransaction(params(i));
      f.evidence('v5-budget-outbound-submitted', {
        wallet: made.wallet,
        rulesId: made.rulesIds[0],
        token: tokens[i],
        amount: amounts[i],
        pushTx: tx.hash,
      });
      const receipt = await tx.wait({ outboundTimeoutMs: 600_000 });
      expect(receipt.externalStatus).toBe('success');
      await verifyExternalTransaction(receipt.externalTxHash!, chain);
      const external = await sep.getTransactionReceipt({
        hash: receipt.externalTxHash as Hex,
      });
      const executed = parseEventLogs({
        abi: parseAbi([
          'event UniversalTxExecuted(bytes32 indexed subTxId, bytes32 indexed universalTxId, address indexed originCaller, address target, bytes data)',
        ]),
        logs: external.logs,
      });
      expect(
        executed.some(
          (event) =>
            event.address.toLowerCase() === cea.toLowerCase() &&
            event.args.originCaller.toLowerCase() ===
              made.wallet.toLowerCase() &&
            event.args.target.toLowerCase() === counter.toLowerCase()
        )
      ).toBe(true);
      const afterDestination =
        i === 0
          ? await sep.getBalance({ address: cea })
          : await sep.readContract({
              address: usdc.address as Address,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [cea],
            });
      expect(afterDestination).toBe(beforeDestination + amounts[i]);
      expect(
        await f.push.readContract({
          address: tokens[i],
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [made.wallet],
        })
      ).toBe(BigInt(1));
      expect(
        await f.push.readContract({
          address: tokens[i],
          abi: erc20Abi,
          functionName: 'allowance',
          args: [made.wallet, f.manifest.addresses.gateway],
        })
      ).toBe(BigInt(1));
      const expected = i === 0 ? [amounts[0], BigInt(0)] : amounts;
      expect(await spent()).toEqual(expected);
      const nonce = await f.push.getTransactionCount({
        address: f.agentAddress,
      });
      await expect(
        agent.universal.sendTransaction(params(i, BigInt(1)))
      ).rejects.toMatchObject({
        decodedError: { name: 'PolicyCheckReverted(TotalSpendCapExceeded)' },
      });
      expect(
        await f.push.getTransactionCount({ address: f.agentAddress })
      ).toBe(nonce);
      expect(await spent()).toEqual(expected);
      hashes.push(tx.hash, receipt.externalTxHash!);
    }
    f.evidence('v5-independent-token-budgets', {
      wallet: made.wallet,
      rulesId: made.rulesIds[0],
      tokens,
      amounts,
      spent: await spent(),
      hashes,
    });
  }, 1_800_000);
});
