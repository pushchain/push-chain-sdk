# 7. SDK: 8183 Job

<aside>
📄

**Where we are going.** One namespace for the ERC-8183 job lifecycle, usable by both sides: the client (an AGW driven by its owner, or any address) and the provider (a plain agent key). `client.market.openJob` creates the job; after that everything is here. Anyone can use it without the marketplace.

**What this page is.** The `client.job` namespace over the `AgenticCommerce` kernel, the rules hook and the evaluator's job-side reads ([3. 8183 (job kernel and hook)](3%208183%20(job%20kernel%20and%20hook)%203e9188aea7f48188a838c3a740d8c858.md)). One heading per function, examples first, types second. Same conventions as [5. SDK: AGW](5%20SDK%20AGW%203e9188aea7f481cf8e8de324956549b9.md).

**Status.** Kernel BUILT, not deployed; evaluator IN BUILD. Surface PROPOSED (2026-10-12), re-drafted against the current contracts; names on the evaluator side follow the V2 design and may move with it.

</aside>

# List of changes

New

- `client.job`
    - client side
        - `create`
        - `fund`
        - `status`
        - `list`
        - `watch`
        - `claimRefund`
    - provider side
        - `setBudget`
        - `submit`
        - `verify`
- `PushChain.CONSTANTS.AGENTIC.JOB.ADDRESS[chain]` (was `CONSTANTS.JOB[chain]`; kept because phase 2 puts an `EvaluatorGateway` on every chain)
- `JobError`, progress family `JOB-TX-1xx`

Removed from the earlier draft of this page

- `prepare.create` and `prepare.fund` (no prepare anywhere in the agentic SDK)
- `fund`'s token argument (the token is fixed at `createJob` with K-12 and read from the job)
- `evaluatorOnly.complete / reject` (DECIDED 2026-10-12: out; the evaluator contract calls them, a plain job calls the kernel raw)
- `client.evaluation` as a namespace (page 8): its job-side reads (`status`, `verdict`, `waitForStart`, `watch`) fold into `client.job.status` and `client.job.watch`; its criteria helpers become `PushChain.utils.job.*` (`buildJobSpec`, `encodeJobSpec`, `decodeJobSpec`, `describeJobSpec`, `previewJobSpec`), documented on [6. SDK: Universal Marketplace](6%20SDK%20Universal%20Marketplace%203ea188aea7f481e2961ed97129f3a4e6.md), section 3

Two sides. The client is whoever created the job: in marketplace jobs the AGW, acting through its owner (`PushChain.initialize(ownerSigner, { agenticWallet })`), so every client write below is a normal `sendTransaction` to the kernel through the owner door. The provider is an ordinary signer with no wallet and no rules, talking to the kernel directly.

# 1. Client side, by example

### 1.a Create a job without the marketplace - `client.job.create`

A plain 8183 job: the connected account is the client. From an owner in `agenticWallet` mode the AGW is the client; from any other signer, that signer is. Marketplace jobs do not use this; `client.market.openJob` creates them from the card's job spec template.

```tsx
// Function
const res = await client.job.create({ options })

// Usage and Params
const res = await client.job.create({
  provider: '0xAgentOnPush',                                     // the agent; zero for bid mode
  evaluator: PushChain.CONSTANTS.AGENTIC.JOB.ADDRESS[CHAIN.PUSH_TESTNET_DONUT].EVALUATOR,
  hook: PushChain.CONSTANTS.AGENTIC.JOB.ADDRESS[CHAIN.PUSH_TESTNET_DONUT].HOOK,
  expiredAt: now + 7 * 86400,
  paymentToken: USDC_PUSH,                                       // K-12; fixed here, read everywhere after
  jobSpec: jobSpecBytes,                                         // encodeJobSpec(spec); the description on the kernel
  progressHook: (p) => console.log(p.id, p.message),
});
// options.provider       Address, required            the 8183 provider; for an AGW client it must equal the agent of a live rule on that wallet
// options.evaluator      Address, required            UniversalEvaluator on Push, or the EvaluatorGateway on another chain (phase 2)
// options.hook           Address, required            a hook whitelisted on the kernel; zero for none
// options.expiredAt      number, required             unix seconds; at least the kernel's minimum window ahead
// options.paymentToken   Address, required            the job's token (K-12); until K-12 lands the kernel's one token is implied and this is ignored
// options.jobSpec        Hex, optional                encodeJobSpec(spec); omit for a job with no evaluation (description then free text)
// options.description    string, optional             only when jobSpec is absent
// options.progressHook   function, optional           progress events, JOB-TX-101; default none

// Returns
// <Object> { jobId, tx }
{
  jobId: 43n,
  tx: {                                                // UniversalTxResponse
    hash: '0x...',
    origin: 'eip155:11155111:0x31dC...',
    from: '0xWalletOrSigner',
    blockNumber: 1400n,
    wait
  }
}
```

### 1.b Fund the escrow - `client.job.fund`

The client's acceptance. Call after the provider's `setBudget`. The SDK reads the stored budget as `expectedBudget` (the kernel refuses a mismatch), reads the job's token, and for an AGW client passes `abi.encode(rulesId)` so the rules hook binds job to rules. If the criteria have NUM or PCT checks it also attaches the baseline prefund (`quoteSnapshot`) in PC.

```tsx
// Function
const tx = await client.job.fund(jobId, { options? })

// Usage and Params
const tx = await client.job.fund(42n, { rulesId: '0x9c1e...' });                            // AGW client: binds the rules
const tx = await client.job.fund(43n);                                                      // plain client, no hook payload
const tx = await client.job.fund(42n, { rulesId, progressHook: (p) => console.log(p.id) });
// jobId                  bigint, required     the job
// options.rulesId        Hex, required for an AGW client with the rules hook   the rule this job runs under
// options.progressHook   function, optional   progress events, JOB-TX-102; default none

// Returns
// <UniversalTxResponse> { hash, origin, from, to, blockNumber, wait() }
```

Before sending, the SDK checks the budget is set (`BUDGET_NOT_SET`), the token balance and allowance of the client (`INSUFFICIENT_FUNDS`), and for an AGW client that the wallet is free (`WALLET_HAS_ACTIVE_JOB`). Marketplace jobs: `client.market.deposit` moves the funds into the wallet first ([6. SDK: Universal Marketplace](6%20SDK%20Universal%20Marketplace%203ea188aea7f481e2961ed97129f3a4e6.md)).

### 1.c Read a job - `client.job.status`

The kernel record plus the evaluator's view of it, in one read.

```tsx
// Function
const job = await client.job.status(jobId)

// Usage and Params
const job = await client.job.status(42n);
// jobId   bigint, required

// Returns
// <Job> { jobId, status, client, provider, evaluator, hook, expiredAt, budget, paymentToken, deliverable?, jobSpec?, rulesId?, evaluation }
{
  jobId: 42n,
  status: 'Funded',                                  // Open | Funded | Submitted | Completed | Rejected | Expired
  client: '0x2Fd9...',
  provider: '0xAgentOnPush',
  evaluator: '0xEval...',
  hook: '0xHook...',
  expiredAt: 1767225600,
  budget: 5000000n,
  paymentToken: '0xUSDC...',
  deliverable: undefined,                            // bytes32 after submit
  jobSpec: {
    spec: { ... },                                   // decoded JobSpec
    bytes: '0x...',
    frozen: true,                                    // frozen once Funded; the standing proposal while Open
  },
  rulesId: '0x9c1e...',                              // from the rules hook, AGW clients only
  evaluation: {
    baselineAt: 1290n,                               // block of the baseline; undefined before fund or for BOOL/CMP-only specs
    before: [499950000n, undefined],                 // per read, where taken
    after: undefined,
    verdict: undefined,                              // 'PASS' | 'FAIL' | 'CLIENT_INTERFERED' once settled
    reason: undefined,
    lastVerifyAt: undefined,
  }
}
```

### 1.d List jobs - `client.job.list`

```tsx
// Function
const res = await client.job.list({ options? })

// Usage and Params
const { jobs } = await client.job.list({ provider: client.universal.account, status: 'Funded' });   // my jobs as provider
const { jobs } = await client.job.list({ client: '0x2Fd9...' });                                    // one wallet's jobs
// options.client    Address, optional
// options.provider  Address, optional
// options.status    JobStatus, optional
// options.fromJobId bigint, optional   walk from here; default 1

// Returns
// <Object> { jobs: Job[] }
```

Walks `jobCounter` and `jobs(id)` until an indexer exists.

### 1.e Watch a job - `client.job.watch`

One stream for the reader, two sources underneath: kernel events (`BudgetSet`, `JobFunded`, `JobSubmitted`, `JobCompleted`, `JobRejected`) and evaluator events (proposal stored, baseline recorded, verify round, verdict).

```tsx
// Function
const stop = client.job.watch(jobId, callback)

// Usage and Params
const stop = client.job.watch(42n, (e) => console.log(e.kind, e.txHash));
stop();
// jobId      bigint, required
// callback   (e: JobEvent) => void, required

// Returns
// <function> stop()
// JobEvent.kind: 'BudgetSet' | 'JobSpecProposed' | 'Funded' | 'BaselineRecorded' | 'Submitted' | 'VerifyRound' | 'Completed' | 'Rejected' | 'Refunded'
```

### 1.f Claim a refund - `client.job.claimRefund`

After `expiredAt` (plus the 1-hour grace for a Submitted job). Never pausable on the kernel.

```tsx
// Function
const tx = await client.job.claimRefund(jobId, { options? })

// Usage and Params
const tx = await client.job.claimRefund(42n);
// jobId                  bigint, required
// options.progressHook   function, optional

// Returns
// <UniversalTxResponse>
```

# 2. Provider side, by example

### 2.a Price the job, optionally propose a new spec - `client.job.setBudget`

Sets the budget in the job's token. For a marketplace job the budget must equal the card's `providerFee`, because the client's `fund` passes that as `expectedBudget`. When the job's `allowedMutability` allows the provider, `jobSpec` carries a replacement `JobSpec` in `optParams`; the hook checks the flag and the evaluator stores the proposal. The client sees it in `status.jobSpec` and accepts by funding, or does not fund.

```tsx
// Function
const tx = await client.job.setBudget(jobId, amount, { options? })

// Usage and Params
const tx = await client.job.setBudget(42n, parseUnits('5', 6));                                     // price only
const tx = await client.job.setBudget(42n, parseUnits('5', 6), { jobSpec: newSpecBytes });          // price plus a counter-proposal
// jobId                  bigint, required
// amount                 bigint, required     in the job's paymentToken
// options.jobSpec        Hex, optional        encodeJobSpec(spec); refused by the hook unless allowedMutability allows PROVIDER or BOTH
// options.progressHook   function, optional

// Returns
// <UniversalTxResponse>
```

Before sending, the SDK checks the job is Open and not expired, the caller is the provider, and if `jobSpec` is given that `allowedMutability` permits it (`JOB_SPEC_NOT_MUTABLE`) and that `origin` and `allowedMutability` are unchanged (`PROPOSAL_CHANGES_FIXED_FIELDS`).

### 2.b Submit the work - `client.job.submit`

Funded only, before `expiredAt`. The hook's `afterAction(submit)` calls the evaluator's `verify`, so the verdict follows without another call; the submitter pays the after reads.

```tsx
// Function
const tx = await client.job.submit(jobId, { options })

// Usage and Params
const tx = await client.job.submit(42n, { deliverable: 'ipfs://...' });                            // string is hashed to bytes32
const tx = await client.job.submit(42n, { deliverable: '0x7a0f...' });                             // a bytes32 as is
// jobId                  bigint, required
// options.deliverable    Hex | string, required   bytes32 on the kernel: a hash, or a string the SDK hashes
// options.progressHook   function, optional       progress events, JOB-TX-103; default none

// Returns
// <UniversalTxResponse>
```

### 2.c Run or retry the verdict - `client.job.verify`

Normally not needed: `submit` triggers it. Call when a verify round was inconclusive (a read failed or the job is before `failFinalAt` and failing) and the provider wants another round. Caller pays the reads. PROPOSED name; follows the evaluator's function once it lands.

```tsx
// Function
const tx = await client.job.verify(jobId, { options? })

// Usage and Params
const tx = await client.job.verify(42n);
// jobId                  bigint, required
// options.progressHook   function, optional

// Returns
// <UniversalTxResponse>
```

# 3. Types

```tsx
interface JobNamespace {
  create(opts: CreateJobOptions): Promise<{ jobId: bigint; tx: UniversalTxResponse }>;
  fund(jobId: bigint, opts?: { rulesId?: Hex; progressHook?: ProgressHook }): Promise<UniversalTxResponse>;
  status(jobId: bigint): Promise<Job>;
  list(opts?: { client?: Address; provider?: Address; status?: JobStatus; fromJobId?: bigint }): Promise<{ jobs: Job[] }>;
  watch(jobId: bigint, cb: (e: JobEvent) => void): () => void;
  claimRefund(jobId: bigint, opts?: { progressHook?: ProgressHook }): Promise<UniversalTxResponse>;
  setBudget(jobId: bigint, amount: bigint, opts?: { jobSpec?: Hex; progressHook?: ProgressHook }): Promise<UniversalTxResponse>;
  submit(jobId: bigint, opts: { deliverable: Hex | string; progressHook?: ProgressHook }): Promise<UniversalTxResponse>;
  verify(jobId: bigint, opts?: { progressHook?: ProgressHook }): Promise<UniversalTxResponse>;
}

interface CreateJobOptions {
  provider: Address;
  evaluator: Address;
  hook: Address;
  expiredAt: number;
  paymentToken: Address;
  jobSpec?: Hex;
  description?: string;
  progressHook?: ProgressHook;
}

type JobStatus = 'Open' | 'Funded' | 'Submitted' | 'Completed' | 'Rejected' | 'Expired';

interface Job {
  jobId: bigint;
  status: JobStatus;
  client: Address;
  provider: Address;
  evaluator: Address;
  hook: Address;
  expiredAt: number;
  budget: bigint;
  paymentToken: Address;
  deliverable?: Hex;
  jobSpec?: {
    spec: JobSpec;
    bytes: Hex;
    frozen: boolean;
  };
  rulesId?: Hex;
  evaluation: {
    baselineAt?: bigint;
    before?: (bigint | undefined)[];
    after?: (bigint | undefined)[];
    verdict?: 'PASS' | 'FAIL' | 'CLIENT_INTERFERED';
    reason?: Hex;
    lastVerifyAt?: bigint;
  };
}

interface JobEvent {
  jobId: bigint;
  kind: 'BudgetSet' | 'JobSpecProposed' | 'Funded' | 'BaselineRecorded' | 'Submitted' | 'VerifyRound' | 'Completed' | 'Rejected' | 'Refunded';
  txHash: Hex;
  blockNumber: bigint;
  data?: unknown;
}

// JobSpec: the evaluator's wire format (page 3, section 3). Helpers to build, encode, decode and preview it are
// PushChain.utils.job.* (page 6, section 3: buildJobSpec, encodeJobSpec, decodeJobSpec, describeJobSpec, previewJobSpec); this namespace carries bytes.

PushChain.CONSTANTS.AGENTIC.JOB.ADDRESS[CHAIN.PUSH_TESTNET_DONUT] = {   // per chain: other chains get their kernel and EvaluatorGateway here in phase 2
  KERNEL,
  HOOK,
  EVALUATOR,                                             // UniversalEvaluator on Push; the EvaluatorGateway on every other chain
};
// the kernel's grace window is read from the kernel, not a constant (page 5 rule: limits stay inside the SDK)

class JobError extends AgenticError {}
// codes   BUDGET_NOT_SET, BUDGET_MISMATCH, INSUFFICIENT_FUNDS, WALLET_HAS_ACTIVE_JOB, NOT_PROVIDER, NOT_CLIENT, WRONG_STATUS, EXPIRED,
//         JOB_SPEC_NOT_MUTABLE, PROPOSAL_CHANGES_FIXED_FIELDS, RULES_NOT_LIVE, TOKEN_MISMATCH (until K-12: the kernel is single-token)
// progress events, JOB-TX (PROPOSED): 101 created, 102 funded { rulesId }, 103 submitted, 104 budget set { proposal }, 105 verify requested, 199-01 done, 199-02 failed
```

# 4. Open for review

1. `create` from a plain EOA client: allowed, agreed 2026-10-12. Keeps the namespace honest to the standard; the rules hook simply does not bind.
2. `verify` naming and who may call it follow the evaluator contract; the V2 design has a provider-callable retry (tagged 2026-10-12).
3. `list` and `watch` walk the kernel until an indexer exists; agreed 2026-10-12, the indexer comes later.
4. `JobSpec` helpers (`PushChain.utils.job.buildJobSpec`, `encodeJobSpec`, `decodeJobSpec`, `describeJobSpec`, `previewJobSpec`) live on [6. SDK: Universal Marketplace](6%20SDK%20Universal%20Marketplace%203ea188aea7f481e2961ed97129f3a4e6.md), section 3, next to the card they are first used for; this page only carries the encoded bytes. Their open items (preview cost, Solana reads, hole marker) are tracked there.