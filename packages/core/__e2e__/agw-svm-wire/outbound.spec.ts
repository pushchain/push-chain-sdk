/** Internal wire acceptance alongside public Solana coverage. Policy refusals come from URP simulation. */
import '@e2e/shared/setup';
import { PushChain } from '../../src';
import { Keypair, PublicKey, type ParsedTransactionWithMeta } from '@solana/web3.js';
import bs58 from 'bs58';
import { bytesToHex, createPublicClient, http, encodeFunctionData, erc20Abi, parseAbi, parseEther, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO, getPushViemChain } from '../../src/lib/constants/chain';
import type { AgenticRuntime } from '../../src/lib/agentic/runtime';
import { resolveWalletGeneration } from '../../src/lib/agentic/deployments';
import { Snapshot } from '../../src/lib/agentic/reads/snapshot';
import { readSvmRule } from '../../src/lib/agentic/reads/svm';
import { grantSvmWire } from '../../src/lib/agentic/management/svm';
import { createSvmMetadataProvider } from '../../src/lib/agentic/management/svm-metadata';
import { resolveSvmContext } from '../../src/lib/agentic/management/svm-context';
import { sendSvmAgentWire, prepareSvmAgentExecution, type PreparedSvmRequest } from '../../src/lib/agentic/execution/svm-send';
import { SvmDataPinMode, type SvmTermsWire } from '../../src/lib/agentic/codec/svm-terms';
import { svmKey } from '../../src/lib/agentic/codec/svm-accounts';
import { adaptTrackedResponse } from '../../src/lib/agentic/response';
import { v5 } from '../../src/lib/agentic/contracts/v5';
import { setupAgw, evmClient, inSeconds, type AgwFixture } from '../agw/_fixture';
import { loadAgwManifest, verifyAgwManifest } from '../agw/_manifest';
import { inspectSvmWirePrograms, svmWireConnection, SVM_WIRE_CHAIN, SVM_WIRE_GATEWAY, SVM_WIRE_PROGRAM, SVM_WIRE_COUNTER, decodeWireCounter } from '../shared/agw-svm-preflight';
import { probeSvmWirePolicies } from '../shared/agw-svm-policy-probe';

const d = process.env['AGW_SVM_WIRE_E2E'] === '1' ? describe : describe.skip;
// Load the public entry point before internal modules (the existing harness
// does the same); keeping this runtime use prevents TypeScript erasing it.
if (PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET !== SVM_WIRE_CHAIN) throw new Error('Solana fixture chain mismatch');
const AMOUNT = BigInt(10_000); // 0.00001 SOL, twice at most per run.
const MAX_PC = parseEther('20');
const RECEIVE = '0x79f4fa0308e5e101' as Hex;
const DECREMENT = '0x6ae3a83bf81b9665' as Hex;
const ZERO = `0x${'00'.repeat(32)}` as Hex;
const rt = (c: PushChain) => (c as unknown as { agenticRuntime: AgenticRuntime }).agenticRuntime;
const ixData = (disc: Hex, amount: bigint) => {
  const b = Buffer.alloc(16); Buffer.from(disc.slice(2), 'hex').copy(b); b.writeBigUInt64LE(amount, 8); return b;
};

function transferFromCea(tx: ParsedTransactionWithMeta, cea: string, recipient: string, amount: bigint) {
  return tx.meta?.innerInstructions?.some((group) => group.instructions.some((ix) =>
    'parsed' in ix && ix.program === 'system' && ix.parsed.type === 'transfer' &&
    ix.parsed.info.source === cea && ix.parsed.info.destination === recipient &&
    BigInt(ix.parsed.info.lamports) === amount
  ));
}

d('agw svm wire', () => {
  let f: AgwFixture, wallet: Address, token: Address, rulesId: Hex, agent: PushChain;
  let gen: Awaited<ReturnType<typeof resolveWalletGeneration>>;
  let recipient: PublicKey, cea: PublicKey;
  const sol = svmWireConnection();
  const metadata = createSvmMetadataProvider({ [SVM_WIRE_CHAIN]: {
    gatewayProgram: SVM_WIRE_GATEWAY, rpcUrls: CHAIN_INFO[SVM_WIRE_CHAIN].defaultRPC,
  } }, (url) => svmWireConnection(url));
  const accounts = (failure = false) => failure
    ? [{ pubkey: svmKey(SVM_WIRE_COUNTER.toBase58()), isWritable: true }, { pubkey: svmKey(cea.toBase58()), isWritable: false }]
    : [{ pubkey: svmKey(SVM_WIRE_COUNTER.toBase58()), isWritable: true }, { pubkey: svmKey(recipient.toBase58()), isWritable: true }, { pubkey: svmKey(cea.toBase58()), isWritable: true }, { pubkey: ZERO, isWritable: false }];
  const request = (failure = false): PreparedSvmRequest => ({ wallet, rulesId, token, amount: AMOUNT, gasLimit: BigInt(0),
    program: SVM_WIRE_PROGRAM, instructionData: ixData(failure ? DECREMENT : RECEIVE, failure ? BigInt(1) : AMOUNT), accounts: accounts(failure) });
  const stored = () => Snapshot.at(rt(f.owner).reader).then((snap) => readSvmRule(snap, gen, wallet, rulesId, rt(f.owner).pushChainNamespace));

  beforeAll(async () => {
    // Every cluster/program check runs before setupAgw can fund anything.
    const preflight = await inspectSvmWirePrograms(sol);
    const key = process.env['SOLANA_PRIVATE_KEY'];
    if (!key) throw new Error('SOLANA_PRIVATE_KEY is needed only to identify the owned recipient');
    try { recipient = Keypair.fromSecretKey(bs58.decode(key)).publicKey; }
    catch { recipient = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(key))).publicKey; }
    const destination = await sol.getAccountInfo(recipient);
    if (!destination || destination.executable || !destination.owner.equals(PublicKey.default)) throw new Error('Owned recipient must be an existing System account');
    if (parseEther(process.env['AGW_E2E_AGENT_PC'] ?? '0.5') > parseEther('0.5')) throw new Error('Wire suite agent funding is bounded to 0.5 PC');
    const manifest = loadAgwManifest();
    if (manifest.network !== PUSH_NETWORK.TESTNET_DONUT) throw new Error('Wire suite is restricted to Donut');
    const push = createPublicClient({ chain: getPushViemChain(CHAIN.PUSH_TESTNET_DONUT), transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]) });
    await verifyAgwManifest(push, manifest);
    const ownerKey = process.env['PUSH_PRIVATE_KEY'] as Hex | undefined;
    if (!ownerKey) throw new Error('PUSH_PRIVATE_KEY is required');
    const ownerAddress = privateKeyToAccount(ownerKey).address;
    token = await push.readContract({ address: '0x00000000000000000000000000000000000000C0',
      abi: parseAbi(['function gasTokenPRC20ByChainNamespace(string) view returns (address)']),
      functionName: 'gasTokenPRC20ByChainNamespace', args: [SVM_WIRE_CHAIN] });
    const ownerTokens = await push.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [ownerAddress] });
    if (ownerTokens < AMOUNT * BigInt(2)) throw new Error('Push owner needs 0.00002 pSOL for this bounded suite');
    if (await push.getBalance({ address: ownerAddress }) < parseEther('45')) throw new Error('Push owner needs 45 PC to cover bounded setup and outbound budgets');
    f = await setupAgw();
    f.evidence('svm-wire-program-preflight', preflight);
    wallet = (await f.owner.agentic.create('e2e-internal-svm-wire', { rules: [] })).wallet;
    gen = await resolveWalletGeneration(rt(f.owner).reader, f.manifest.network, wallet);
    const resolved = await resolveSvmContext(await Snapshot.at(rt(f.owner).reader), wallet, SVM_WIRE_CHAIN,
      [{ token, maxPerCall: AMOUNT, maxTotal: AMOUNT * BigInt(2) }], metadata);
    cea = new PublicKey(Buffer.from(resolved.expectedCEA.slice(2), 'hex'));
    if (cea.toBase58() === preflight.counter.authority) throw new Error('Failure fixture requires a counter authority different from the fresh AGW CEA');
    const terms: SvmTermsWire = { ...resolved, validUntil: inSeconds(7200), maxGasPerCall: MAX_PC,
      programs: [RECEIVE, DECREMENT].map((discriminator, i) => ({ program: svmKey(SVM_WIRE_PROGRAM), discriminator,
        discriminatorLen: 8, dataless: false, maxAccounts: i === 0 ? 4 : 2 })),
      pins: [false, true].flatMap((failure, ruleIndex) => accounts(failure).map((a, accountIndex) => ({ ruleIndex, accountIndex, expected: a.pubkey }))),
      dataPins: [AMOUNT, BigInt(1)].map((limit, ruleIndex) => ({ ruleIndex, fromEnd: false, offset: 8, offsetB: 0, len: 8,
        mode: SvmDataPinMode.LTE_LE, expected: `0x${limit.toString(16).padStart(64, '0')}`, num: BigInt(0), den: BigInt(0) })),
    };
    const grant = await grantSvmWire(rt(f.owner), gen, wallet, { agent: f.agentAddress, chainNamespace: SVM_WIRE_CHAIN, terms });
    rulesId = grant.rulesId;
    await f.fundPC(wallet, MAX_PC * BigInt(2) + parseEther('1'));
    await (await f.owner.universal.sendTransaction({ to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [wallet, AMOUNT * BigInt(2)] }) })).wait();
    const ownerWallet = await evmClient(process.env['PUSH_PRIVATE_KEY'] as Hex, CHAIN.PUSH_TESTNET_DONUT, f.manifest.network, wallet);
    await (await ownerWallet.universal.sendTransaction({ to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [f.manifest.addresses.gateway, AMOUNT * BigInt(2)] }) })).wait();
    agent = await f.agent(wallet);
    f.evidence('svm-wire-setup', { wallet, rulesId, grantHash: grant.tx.hash, agent: f.agentAddress, recipient: recipient.toBase58(), cea: cea.toBase58(), token, terms, walletPCFunded: MAX_PC * BigInt(2) + parseEther('1'), tokenFunded: AMOUNT * BigInt(2) });
  }, 900_000);
  afterAll(() => f?.teardown());

  it('1. positive outbound: actual CEA transfer and counter execution, receipt and replay', async () => {
    const before = decodeWireCounter((await sol.getAccountInfo(SVM_WIRE_COUNTER))!.data).value;
    const count = await f.push.readContract({ address: wallet, abi: v5.abis.wallet, functionName: 'checkpointCount' });
    const { tx } = await sendSvmAgentWire(rt(agent), gen, request(), metadata);
    f.evidence('svm-wire-positive-submitted', { wallet, rulesId, hash: tx.hash });
    // Existing verified-wallet replay adaptation enables normal outbound wait;
    // it uses the gateway wire call as the logical summary, not a new SVM API.
    await adaptTrackedResponse(rt(agent), tx);
    expect(tx.from).toBe(wallet); expect(tx.route).toBe('UOA_TO_CEA');
    const receipt = await tx.wait({ outboundTimeoutMs: 600_000 });
    f.evidence('svm-wire-positive-receipt', { hash: tx.hash, receipt });
    expect(receipt.status).toBe(1); expect(receipt.externalStatus).toBe('success');
    expect(receipt.from).toBe(wallet); expect(receipt.externalChain).toBe(SVM_WIRE_CHAIN);
    const destination = await sol.getParsedTransaction(receipt.externalTxHash!, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    expect(destination).not.toBeNull(); expect(destination!.meta!.err).toBeNull();
    expect(transferFromCea(destination!, cea.toBase58(), recipient.toBase58(), AMOUNT)).toBe(true);
    expect(destination!.meta!.innerInstructions?.some((g) => g.instructions.some((ix) =>
      'data' in ix && ix.programId.toBase58() === SVM_WIRE_PROGRAM && bytesToHex(bs58.decode(ix.data)) === bytesToHex(ixData(RECEIVE, AMOUNT)) &&
      ix.accounts.some((a) => a.equals(cea))
    ))).toBe(true);
    expect(decodeWireCounter((await sol.getAccountInfo(SVM_WIRE_COUNTER))!.data).value).toBeGreaterThanOrEqual(before + AMOUNT);
    expect((await stored()).config.assets[0].spent).toBe(AMOUNT);
    expect(await f.push.readContract({ address: wallet, abi: v5.abis.wallet, functionName: 'checkpointCount' })).toBe(count);
    const replay = await f.owner.universal.trackTransaction(tx.hash);
    expect(replay.from).toBe(wallet); expect(replay.route).toBe('UOA_TO_CEA');
    expect(replay.agentic).toMatchObject({ door: 'agent', rulesId });
    const replayReceipt = await replay.wait({ outboundTimeoutMs: 600_000 });
    expect(replayReceipt.externalTxHash).toBe(receipt.externalTxHash);
    f.evidence('svm-wire-positive-destination', { hash: tx.hash, externalTxHash: receipt.externalTxHash, destination, replayReceipt });
  }, 900_000);

  it('2. substituted account and oversized instruction amount fail before submission', async () => {
    const base = request();
    const wrong = [...base.accounts!]; wrong[2] = { ...wrong[2], pubkey: svmKey(recipient.toBase58()) };
    const nonce = await f.push.getTransactionCount({ address: f.agentAddress });
    await expect(sendSvmAgentWire(rt(agent), gen, { ...base, accounts: wrong }, metadata)).rejects.toMatchObject({ name: 'AgenticRevertError', decodedError: { name: 'PolicyCheckReverted(SvmAccountPinMismatch)' } });
    await expect(sendSvmAgentWire(rt(agent), gen, { ...base, instructionData: ixData(RECEIVE, AMOUNT + BigInt(1)) }, metadata)).rejects.toMatchObject({ name: 'AgenticRevertError', decodedError: { name: 'PolicyCheckReverted(SvmDataCeilingExceeded)' } });
    const prepared = await prepareSvmAgentExecution(rt(agent), gen, base, metadata);
    const policy = await probeSvmWirePolicies(f.push, { from: f.agentAddress, wallet, rulesId, call: prepared.call, blockNumber: await f.push.getBlockNumber() });
    expect(await f.push.getTransactionCount({ address: f.agentAddress })).toBe(nonce);
    f.evidence('svm-wire-preflight-refusals', { wallet, rulesId, nonce, policy, transactionsSent: 0 });
  });

  it('3. destination program failure is classified and does not restore policy spend', async () => {
    const prior = (await stored()).config.assets[0].spent;
    const { tx } = await sendSvmAgentWire(rt(agent), gen, request(true), metadata);
    f.evidence('svm-wire-failure-submitted', { wallet, rulesId, hash: tx.hash });
    await adaptTrackedResponse(rt(agent), tx);
    // The observed node rejection lifecycle exceeded ten minutes. Keep the
    // failed assertion strict while allowing the bounded terminalization window.
    const receipt = await tx.wait({ outboundTimeoutMs: 1_200_000 });
    f.evidence('svm-wire-failure-receipt', { hash: tx.hash, receipt });
    const pushReceipt = await f.push.getTransactionReceipt({ hash: tx.hash as Hex });
    expect(pushReceipt.status).toBe('success'); expect(receipt.externalStatus).toBe('failed');
    expect((await stored()).config.assets[0].spent).toBe(prior + AMOUNT);
    if (receipt.externalTxHash) {
      const destination = await sol.getParsedTransaction(receipt.externalTxHash, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      expect(destination).not.toBeNull(); expect(destination!.meta!.err).not.toBeNull();
      f.evidence('svm-wire-failure-destination', { hash: tx.hash, externalTxHash: receipt.externalTxHash, destination });
    }
  }, 1_500_000);
});
