# 7. SDK: 8183 Job

<aside>
📄

**Where we are going.** One namespace for the ERC-8183 job lifecycle, usable by both sides: the client (an AGW, driven by its owner) and the provider (a plain agent key with no wallet). `market.start` uses it; anyone can use it without the marketplace.

**What this page is.** The `client.job` namespace over the `AgenticCommerce` kernel and the binding hook. Examples first, types second.

**How to read.** Client side, provider side, types, open. Complete and reject exist on the kernel but in card jobs the evaluator contract calls them, so they sit behind a clearly named escape hatch.

**Depends on.** Page 3: hook checks, fee token, fixed fee vs quote. Kernel is built, not deployed.

</aside>

# 1. Client side (AGW owner), by example

Without the marketplace: the owner creates and funds a job from an AGW that already exists.

```tsx
const owner = await PushChain.initialize(ownerSigner, { network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET });
const w = owner.agentic.wallet('0xWallet');

const { jobId, txHash } = await owner.job.create({
  client: w.address,                                       // the AGW is the client on the kernel
  provider: '0xAgentOnPush',                               // same Push address as rules.agent: an EOA, or the UEA of an external key
  evaluator: PushChain.CONSTANTS.EVALUATION[TESTNET_DONUT].UNIVERSAL_EVALUATOR,
  expiredAt: now + 30 * 86400,
  hook: PushChain.CONSTANTS.JOB[TESTNET_DONUT].RULES_BINDING_HOOK,
  criteria: criteriaBytes,                                 // page 8; carried in description as hex (single carrier)
});
// goes through w.execute: the AGW calls createJob

await owner.job.fund(jobId, { amount: parseUnits('5', 6), token: USDC_ETH }, { rulesId });   // token chosen by the client at createJob (K-12)
// approve(kernel) + fund(jobId, amount, optParams = rulesId) in one execute; the hook binds rulesId to jobId

await owner.job.status(jobId);                             // Job
owner.job.watch(jobId, (e) => console.log(e.status));      // Funded, Started (from evaluation), Submitted, Completed, Rejected
await owner.job.claimRefund(jobId);                        // after expiredAt + grace, never pausable
```

# 2. Provider side, by example

No AGW, no rules: the provider is an ordinary signer talking to the kernel.

```tsx
const provider = await PushChain.initialize(agentSigner, { network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET });

await provider.job.list({ provider: provider.universal.account, status: 'Funded' });   // the signer's Push address, UEA for an external key
await provider.evaluation.waitForStart(jobId);             // page 8: PreRecorded exists, START reads landed

// ... do the work through the AGW as the agent (page 5, section 2) ...

await provider.job.submit(jobId, { deliverable: 'ipfs://...' });
// hook afterAction(submit) fires END reads; the verdict lands via evaluation.watch (page 8)

// quote path only (open on page 3): await provider.job.setBudget(jobId, parseUnits('5', 6));
```

# 3. Types

```tsx
interface JobNamespace {
  create(params: CreateJobParams): Promise<{ jobId: bigint; txHash: Hex }>;
  fund(jobId: bigint, fee: { amount: bigint; token: Address }, opts: { rulesId: Hex; progressHook? }): Promise<TxResponse>;
  submit(jobId: bigint, params: { deliverable: Hex | string; optParams?: Hex }): Promise<TxResponse>;   // string is hashed to bytes32
  claimRefund(jobId: bigint): Promise<TxResponse>;
  setBudget?(jobId: bigint, amount: bigint): Promise<TxResponse>;        // only if the quote path wins
  status(jobId: bigint): Promise<Job>;
  list(filter: { client?: Address; provider?: Address; status?: JobStatus }): Promise<Job[]>;
  watch(jobId: bigint, cb: (e: JobEvent) => void): () => void;
  evaluatorOnly: {                                                       // escape hatch for non-card jobs where the evaluator is a signer
    complete(jobId: bigint, reason: string): Promise<TxResponse>;
    reject(jobId: bigint, reason: string): Promise<TxResponse>;
  };
  prepare: {
    create(params: CreateJobParams): Promise<MultiCall[]>;
    fund(jobId: bigint, fee, opts): Promise<MultiCall[]>;
  };
}

interface CreateJobParams {
  client: Address;                                         // AGW address; the SDK routes through its execute door
  provider: Address;                                       // must equal rules.agent; the hook checks equality
  evaluator: Address;
  expiredAt: number;
  hook: Address;
  paymentToken: Address;                                   // K-12: client's choice, any PRC20
  criteria?: Hex;                                          // encoded Criteria; written to description as hex
  description?: string;                                    // only when criteria is absent (plain 8183 job, no evaluator)
  progressHook?: (p: ProgressEvent) => void;
}

type JobStatus = 'Open' | 'Funded' | 'Submitted' | 'Completed' | 'Rejected' | 'Expired';

interface Job {
  id: bigint;  client: Address;  provider: Address;  evaluator: Address;
  status: JobStatus;  budget: bigint;  paymentToken: Address;
  expiredAt: number;  hook: Address;
  criteria?: { bytes: Hex; hash: Hex };                    // decoded from description when present
  paymentToken: Address;                                   // K-12
  deliverable?: Hex;                                       // bytes32 on the kernel: hash or digest of the deliverable
  rulesId?: Hex;                                           // from the binding hook
}

interface JobEvent { jobId: bigint; status: JobStatus | 'Started'; txHash: Hex; blockNumber: bigint; reason?: string }

PushChain.CONSTANTS.JOB[PUSH_NETWORK.TESTNET_DONUT] = { KERNEL, RULES_BINDING_HOOK, GRACE: 3600 };   // no payment token constant: the client picks it per job

class JobError extends AgenticError {}                    // TOKEN_MISMATCH (kernel is single-token), NOT_STARTED, RULES_NOT_BOUND, EXPIRED
// progress family: JOB-TX-1xx
```

# 4. Open for review

1. Payment token is chosen by the client per job (USDC, USDT.eth, USDT.sol, any PRC20). The kernel on the branch is single-token (`paymentToken` set in `initialize`), so this needs K-12: `createJob(..., address paymentToken)`, `Job.paymentToken`, `totalEscrowed` per token, fees paid in the job's token. `fund` then takes no token argument; the SDK reads it from the job and throws `TOKEN_MISMATCH` if the caller passes a different one.
2. `evaluatorOnly.complete/reject`: keep as a named escape hatch or leave out of the SDK entirely (call the kernel raw). Leaving it in makes plain 8183 jobs usable without the evaluator.
3. `setBudget` exists only on the quote path. Decide with page 2 open item 2.
4. `watch` emits `Started` from the evaluator's `PreRecorded`, not from the kernel. One stream for the reader, two sources underneath.
5. `create` from an EOA client (no AGW) for plain 8183 jobs: allow, or require an AGW always. Allowing it keeps the namespace honest to the standard.