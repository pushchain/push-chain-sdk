/** Opt-in funded Donut acceptance. Nothing in this file runs in unit/local validation. */
import type { UniversalRule } from '../../src';
import { parseEther } from 'viem';
import { CHAIN } from '../../src/lib/constants/enums';
import { MOVEABLE_TOKEN_CONSTANTS } from '../../src/lib/constants/tokens';
import { v4 } from '../../src/lib/agentic/contracts/v4';
import { EVM_CHAIN_FIXTURES } from '@e2e/shared/chain-fixtures';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import {
  AGW_E2E_ENABLED,
  inSeconds,
  setupAgw,
  type AgwFixture,
} from './_fixture';

const d = AGW_E2E_ENABLED ? describe : describe.skip;
const chain = CHAIN.ETHEREUM_SEPOLIA;
const counter = EVM_CHAIN_FIXTURES.find((x) => x.chain === chain)!.contracts
  .counter as `0x${string}`;

d('agw v4 multi-asset', () => {
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
    const created = await f.owner.agentic.create('v4-two-token', {
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
      abi: v4.abis.wallet,
      functionName: 'checkpointCount',
    });
    const replacement = await w.rules.update({
      rules: [{ rulesId: created.rulesIds[0], rule }],
    });
    expect(
      await f.push.readContract({
        address: created.wallet,
        abi: v4.abis.wallet,
        functionName: 'checkpointCount',
      })
    ).toBe(count + BigInt(5));
    expect((await w.rules.list()).rules.map((x) => x.rulesId)).toEqual([
      replacement.rules[0].rulesId,
    ]);
    f.evidence('v4-two-token-replacement', {
      wallet: created.wallet,
      oldId: created.rulesIds[0],
      newId: replacement.rules[0].rulesId,
      txHash: replacement.tx.hash,
    });
  });
  it('2. empty user assets routes a call-only outbound with zero token spend', async () => {
    const created = await f.owner.agentic.create('v4-call-only', {
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
    });
    const receipt = await tx.wait({ outboundTimeoutMs: 600_000 });
    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeTruthy();
    await verifyExternalTransaction(receipt.externalTxHash as string, chain);
    const [action] = await f.push.readContract({
      address: f.manifest.addresses.sessionEngine,
      abi: v4.abis.engine,
      functionName: 'getEnabledActions',
      args: [created.wallet, created.rulesIds[0]],
    });
    const { configId } = await import('../../src/lib/agentic/codec/ids');
    const cfg = await f.push.readContract({
      address: f.manifest.addresses.rulesPolicy,
      abi: v4.abis.policy,
      functionName: 'getConfig',
      args: [
        configId(created.wallet, created.rulesIds[0], action),
        created.wallet,
      ],
    });
    expect(cfg.assets.map((x) => x.spent)).toEqual([BigInt(0)]);
    f.evidence('v4-call-only', {
      wallet: created.wallet,
      pushTx: tx.hash,
      externalTx: receipt.externalTxHash,
    });
  }, 900_000);
});
