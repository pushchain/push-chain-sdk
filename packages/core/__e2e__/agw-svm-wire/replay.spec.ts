/** Read-only acceptance of recorded wire transactions; no signer or funding required. */
import { PushChain } from '../../src';
import { createPublicClient, http, type Hex } from 'viem';
import { CHAIN_INFO, getPushViemChain } from '../../src/lib/constants/chain';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { v5 } from '../../src/lib/agentic/contracts/v5';
import { chainReaderFromPublicClient } from '../../src/lib/agentic/contracts/reader';
import { resolveWalletGeneration } from '../../src/lib/agentic/deployments';
import { Snapshot } from '../../src/lib/agentic/reads/snapshot';
import { readSvmRule } from '../../src/lib/agentic/reads/svm';
import { probeSvmWirePolicies } from '../shared/agw-svm-policy-probe';

const d = process.env['AGW_SVM_WIRE_REPLAY_E2E'] === '1' ? describe : describe.skip;
const POSITIVE = '0x50a96ff863722ced3464e3e8e5e451621903396c9bc83fcc010756dc1aee73b8' as Hex;
const REJECTED = '0x51e2227e833e8090844f151c2d5d959225d3ec24828bf11a1c6467e2a74410fc' as Hex;
const EXTERNAL = 'kGUaPUfASg9Poo93aMsztHJjUk27MKuRJBfDZK1WP3FFSaXSYcoPcxjUMFyDxaK6aU6mQkZeowSu3MtvK5PXKgK';

d('agw svm recorded replay', () => {
  const push = createPublicClient({ chain: getPushViemChain(CHAIN.PUSH_TESTNET_DONUT), transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]) });
  let source: Awaited<ReturnType<typeof push.getTransaction>>;
  let decoded: Extract<NonNullable<ReturnType<typeof v5.decodeWalletCall>>, { kind: 'executeAsAgent' }>;
  let client: PushChain;
  beforeAll(async () => {
    source = await push.getTransaction({ hash: POSITIVE });
    const call = v5.decodeWalletCall(source.input);
    if (!source.to || call?.kind !== 'executeAsAgent') throw new Error('Recorded fixture is not an AGW agent call');
    decoded = call;
    client = await PushChain.initialize({ chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT, address: source.from }, { network: PUSH_NETWORK.TESTNET_DONUT });
    expect(client.isReadMode).toBe(true);
  });
  it('1. positive replay retains wallet, signer origin and actual Solana signature', async () => {
    const tx = await client.universal.trackTransaction(POSITIVE);
    expect(tx.from.toLowerCase()).toBe(source.to!.toLowerCase());
    expect(tx.origin.toLowerCase()).toBe(`eip155:42101:${source.from}`.toLowerCase());
    expect(tx.agentic?.rulesId).toBe(decoded.rulesId); expect(tx.route).toBe('UOA_TO_CEA');
    const receipt = await tx.wait({ outboundTimeoutMs: 30_000 });
    expect(receipt.status).toBe(1); expect(receipt.externalStatus).toBe('success'); expect(receipt.externalTxHash).toBe(EXTERNAL);
  }, 120_000);
  it('2. later terminal rejection is failed, while the source succeeded and spend remains charged', async () => {
    const tx = await client.universal.trackTransaction(REJECTED);
    const receipt = await tx.wait({ outboundTimeoutMs: 30_000 });
    expect(receipt.status).toBe(1); expect(receipt.externalStatus).toBe('failed');
    expect(receipt.externalError).toContain('tx not executed on destination chain');
    expect(tx.from.toLowerCase()).toBe(source.to!.toLowerCase());
    // Historical snapshot after the actual refund block, immune to later owner changes.
    const reader = chainReaderFromPublicClient(push);
    const gen = await resolveWalletGeneration(reader, PUSH_NETWORK.TESTNET_DONUT, source.to!);
    const snapshot = new Snapshot(reader, BigInt(23950160));
    const rule = await readSvmRule(snapshot, gen, source.to!, decoded.rulesId, 'eip155:42101');
    expect(rule.config.assets[0].spent).toBe(BigInt(20_000));
  }, 120_000);
  it('3. pinned live policy calls refuse account and data mutations without submitting', async () => {
    const receipt = await push.getTransactionReceipt({ hash: POSITIVE });
    const result = await probeSvmWirePolicies(push, { from: source.from, wallet: source.to!, rulesId: decoded.rulesId, call: decoded.calls[0], blockNumber: receipt.blockNumber });
    expect(result.transactionsSent).toBe(0); expect(result.observations.map((r) => r.decoded.name)).toEqual([
      'PolicyCheckReverted(SvmAccountPinMismatch)', 'PolicyCheckReverted(SvmDataCeilingExceeded)',
    ]);
  });
});
