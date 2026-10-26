# 4. Universal Evaluation

<aside>
⚖️

**Where we are going.** One generic evaluator on Push that judges any job from data. A job's criteria are a `JobSpec`: what to read on which chain, how to compare each value, how the checks combine. Validators attest the reads by quorum at agreed heights; the evaluator does arithmetic on attested answers, runs the logic tree, and calls `complete` or `reject` on the kernel. A new job type is new data, never a new contract. v1 is the deterministic lane only; the committee lane is not claimed until it exists.

**What this page is.** The one thing to settle first (the shared wire format), the decisions taken since the 2026-09-28 draft, the rename map from that draft to the V2 design, the structural pieces (snapshot, verify, settlement, checkpoints, ratings, other chains), the contract surface as a sketch, and what is open. The narrative with diagrams is [ERC-8183 x Push: Trust Layer](https://app.notion.com/p/ERC-8183-x-Push-Trust-Layer-3f4188aea7f48036a26bc8b58e748cf1?pvs=21); the builder's guide with worked examples is [Plugging into Push Evaluation: criteria, reads and the 8183 touchpoints](https://app.notion.com/p/Plugging-into-Push-Evaluation-criteria-reads-and-the-8183-touchpoints-3f4188aea7f481449c87e3891942f3e5?pvs=21).

**Status.** DESIGN finalised as the Universal Evaluator V2 design (2026-10-05). `UniversalEvaluator` IN BUILD, ETA this week. The hook that feeds it is being extended from the marketplace's `RulesBindingHook`. Nothing on Donut yet. Phase 2 (jobs on other chains through an `EvaluatorGateway`) is planned and must not block the build.

</aside>

# 0. Settle first: one `JobSpec`, three repos

`JobSpec` is written by the marketplace, frozen by the hook and judged by the evaluator, and it is the 8183 job's `description` byte for byte. Three places define it today and they do not agree: the marketplace repo (`JobSpecTypes.sol`: `executeBy, failFinalAt, reads, checks, nodes, origin`, no mutability), the Trust Layer page (`executeBy, failFinalAt, mutability, reads, checks, logic`, no `origin`), and the evaluator build in progress. Field order is ABI; two orders means two incompatible descriptions on day one. Decided 2026-10-12, the one order both repos implement:

```solidity
enum Evaluation        { BOOLEAN, COMPARE, NUMBER, PERCENTAGE }                 // was EvalType { BOOL, CMP, NUM, PCT }; renamed 2026-10-12 to match the SDK constants
enum Operation         { EQUAL, NOT_EQUAL, GREATER_THAN, GREATER_OR_EQUAL, LESS_THAN, LESS_OR_EQUAL }   // was Op
enum LogicKind         { ALL, ANY, AT_LEAST }                                   // CHECK leaf dropped (PROPOSED 2026-10-12): operators reference checks directly
enum AllowedMutability { NONE, CLIENT, PROVIDER, BOTH }                         // was Mutability

struct Read  { string chainNamespace; string chainId; uint16 minConfirmations; address target; bytes4 selector; bytes args; bytes outputs; uint8[] field; }
struct Check { uint8 read; Evaluation evaluation; Operation operation; int256 target; }
struct Logic { LogicKind kind; uint8[] checks; uint8[] children; uint8 k; }   // checks: indices into checks[]; children: indices into logic[]; logic[0] is the root; no leaf nodes

struct JobSpec {
    Read[]     reads;         // what to look at
    Check[]    checks;        // how to compare each value
    Logic[]    logic;         // how the checks combine; logic[0] is the root
    AllowedMutability allowedMutability;   // who may propose a replacement spec at setBudget
    bytes32    origin;        // marketplace jobs: keccak256(marketplace, cardId, cardVersion, principal); zero for plain jobs
    uint64     executeBy;     // the provider should have acted by this time
    uint64     failFinalAt;   // after this a FAIL is final; must sit well before the kernel's expiredAt
}

struct JobSpecTemplate {      // the marketplace's stored form: the first four fields of JobSpec, plus param bounds
    ReadTemplate[]  reads;
    CheckTemplate[] checks;
    Logic[]           logic;
    AllowedMutability allowedMutability;
    ParamBounds[]     params;
}
```

Order decided 2026-10-12 (Harsh): content first (`reads`, `checks`, `logic`), then who may change it and where it came from (`allowedMutability`, `origin`), then timing (`executeBy`, `failFinalAt`). The template is the first four fields plus `params`, so `JobSpecBuilder` copies four fields and appends `origin` and the timing the job supplies. `origin` is kept, zero when unused: the marketplace needs it to tie a job to the card version the user signed. The evaluator ignores it except to refuse a proposal that changes it. The Trust Layer page's order is superseded; this one goes to the evaluator team as the order to implement. A `Check` compares a read against a constant target; read-against-read comparisons are out of scope (the marketplace resolves `principalBps` targets to constants at `openJob`). Vocabulary (2026-10-12): the enum and field names above are the SDK's constant names (`PushChain.CONSTANTS.AGENTIC.JOB.EVALUATION`, `OPERATION`, `LOGIC`, `ALLOWED_MUTABILITY`), one vocabulary from contract to SDK; `Logic` drops the `CHECK` leaf kind so an operator lists its checks and its child operators directly, which roughly halves node count (PROPOSED, for the evaluator team). The `Read` struct is EVM-shaped today (`address target`, `bytes4 selector`); since the evaluator only compares attested answers, any source universal read serves (Solana, web2) works once `Read` can carry the universal read envelope. Tracked as open item 3.

# 1. In one paragraph

The evaluator is deliberately dumb. It does not know what a yield job or a swap is. It knows how to fire a read on a chain at an agreed height, decode one value out of the answer using the `outputs` layout and the `field` path, compare that value (or its change since a snapshot) to a target, and combine the results through a small tree. Reads are attested by the universal validators by quorum, so the evaluator only ever does arithmetic on answers a quorum agreed on. The kernel's own lifecycle drives it: `fund` freezes the criteria and takes the snapshot, `submit` triggers the verdict, `complete` or `reject` settle. `claimRefund` after expiry always works, whatever the evaluator is doing.

# 2. Decisions

| # | Decision | Outcome |
| --- | --- | --- |
| E1 | Criteria format | **The V2 `JobSpec`** (reads, checks, logic) replaces the 2026-09-28 `Criteria { conditions[] }` draft. Generic through `outputs` and `field`: the evaluator reads a nested struct value without knowing the contract's interface. A read that cannot be decoded resolves to UNKNOWN, never reverts. |
| E2 | Comparison families | **Four `Evaluation`s**: BOOLEAN (`after == target`), COMPARE (`after op target`), NUMBER (`(after - before) op target`), PERCENTAGE (`(after - before) * 10000 / before op target`). NUMBER and PERCENTAGE need the snapshot; BOOLEAN and COMPARE look at the end state only. Named BOOL, CMP, NUM, PCT until 2026-10-12. The four families from the first draft (true or false, greater or less, percentage, absolute) map onto these one to one. |
| E3 | Pass logic | **A tree**, `logic[]`: ALL, ANY, AT_LEAST k, each listing the checks and the child operators it combines (the CHECK leaf kind was dropped 2026-10-12, PROPOSED). Children always have a higher index than their parent, so evaluation runs leaves up and cannot loop. No NOT: flip the operator on the check instead. Renamed from `nodes` to `logic` (2026-10-07). |
| E4 | Mutability | **`AllowedMutability` on the spec**: NONE, CLIENT, PROVIDER, BOTH. A proposal travels as a replacement `JobSpec` in `setBudget`'s `optParams`; the hook checks the flag against the caller; the evaluator stores it as the standing proposal; the client accepts by funding or does not fund. A proposal may not change `origin` or `allowedMutability`. `PROVIDER` means the whole spec. (2026-10-06, 2026-10-07) |
| E5 | Hook and evaluator | **Separate contracts.** The hook is the kernel-facing adapter (and on Push also the AGW rules binder); the evaluator is directly callable so a kernel with its own hook, or a party calling by hand, can use it. 8183 lets a kernel whitelist several hooks; merging would have limited that. (2026-10-06) |
| E6 | When the job starts | **At `fund`.** The hook's `afterAction(fund)` freezes the standing spec and takes the baseline: one before read per NUM or PCT check, pinned to the height at `fund`, so the baseline is the state before the agent touched anything. "Started" is the baseline being recorded; it is an evaluator fact, not a kernel state. |
| E7 | Who pays the reads | **Client prefunds the snapshot; the submitter pays the verify reads.** `quoteSnapshot(description)` returns the amount up front. On Push the AGW prefunds in the funding transaction. A spec with only BOOL and CMP checks has no snapshot and no prepay. (2026-10-06) |
| E8 | When the verdict runs | **At `submit`**, from the hook's `afterAction(submit)` calling `verify`. Wrapped in a try so a failed call never blocks `submit`; anyone can call `verify` again. A provider-callable retry exists for rounds where a read failed. The old "provider calls submit and then calls verify" is gone. |
| E9 | Verdicts | **PASS calls `complete`. FAIL after `failFinalAt` calls `reject`. FAIL before `failFinalAt` and INCONCLUSIVE send nothing** and `verify` can run again. `reason` is a hash of the job id and the round, so a verdict traces back to its reads. The three-consecutive-blocks rule from the first draft is dropped; a spec that fears a one-block spike adds a second read a few blocks later and joins them with ALL. |
| E10 | Checkpoint rule | **Checkpoint first.** Before any after read, the evaluator asks the AGW whether the owner changed anything after the baseline. If so, the job completes in the agent's favour (verdict `CLIENT_INTERFERED`), no reads. Unchanged from the first draft. |
| E11 | Verified ratings | **Written by the evaluator in the same transaction as `complete` or `reject`** (draft): rail, chain, job reference, 8004 agent id, provider, client, evaluator, verdict, reason, fee, settled at. Keyed by rail, chain and job so a job counts once. Where the record lives is open on [Proposal: Verified Ratings on ERC-8004 (In draft)](https://app.notion.com/p/Proposal-Verified-Ratings-on-ERC-8004-In-draft-3f4188aea7f4817480cfe762d6d833a6?pvs=21). |
| E12 | Jobs on other chains | **Phase 2: `EvaluatorGateway` per chain.** A job on Base or Arbitrum names the gateway as its evaluator and keeps its own kernel; `snapshot` and `verify` travel to Push through the universal gateway and the verdict comes back TSS-signed to the evaluator's account there, which alone may call `complete` or `reject` through the gateway. Three ways to trigger it: the kernel's own hook (from `EvaluationHookBase`), Push's hook whitelisted on the kernel, or any party calling `snapshot` and `verify` by hand (the default, needs nothing from the kernel operator). Planning doc pending; must not block v1. |
| E13 | Scope of v1 | **Deterministic lane only.** Validator-attested reads plus on-chain comparison. No committee, no staking, no commit-reveal, no judging of quality. Say so externally. Solana reads limited to what Read State serves today; prompt-based reads are the future path. |

# 3. Rename map (2026-09-28 draft to the V2 design)

| Area | Draft (09-28) | V2 (now) |
| --- | --- | --- |
| The criteria object | `Criteria { version, minDuration, conditions[] }` | `JobSpec { reads[], checks[], logic[], allowedMutability, origin, executeBy, failFinalAt }` |
| One condition | `Condition { read, sample, cmp }`, each condition owning its read | split into `Read` (fired once, may feed several checks), `Check` (one comparison) and `Logic` (how checks combine) |
| Read | `{ chainNamespace (full), queryType, target (bytes), callData, word, resultType }` | `{ chainNamespace (namespace only), chainId, minConfirmations, target (address), selector, args, outputs, field }`; `outputs` and `field` replace `word` and `resultType` |
| Sampling | `Sample { END, START_AND_END, PERIODIC }` | implied by `Evaluation`: NUMBER and PERCENTAGE snapshot at `fund`, BOOLEAN and COMPARE do not. PERIODIC dropped, not reserved |
| Comparison | `Compare { op (incl. IS_TRUE, IS_FALSE), basis (ABSOLUTE, DELTA, PCT, REF), value, ref, period, minPassBps }` | `Check { read, evaluation, operation, target }`; IS_TRUE and IS_FALSE become BOOLEAN with EQUAL; REF (compare two reads) is out of scope, see section 0 |
| Combining | all conditions must hold | `logic[]` tree: ALL, ANY, AT_LEAST k, operators listing checks and children directly |
| Timing | `minDuration` blocks early submit | `executeBy` and `failFinalAt` on the spec; the card's `minDuration`, `maxDuration`, `minExecuteWindow` and `settleWindow` bound them at `openJob` |
| Start | START reads at `fund`, `PreRecorded(jobId)` when the last lands | snapshot at `fund` by the hook, baseline recorded; same meaning, new names |
| Verdict trigger | END reads at `submit`, verdict in the last callback | `verify(jobId)` from `afterAction(submit)`, re-callable; verdicts PASS, FAIL, INCONCLUSIVE |
| Retry | `refireStart(jobId, condition)` by anyone | a provider-callable retry for failed reads; name follows the contract |
| Push-local and web2 reads | `push` namespace (direct staticcall, no fee), `web2` | push-local is a direct `staticcall`; web2 undefined, future planning (open item 3) |
| Where registered criteria live | evaluator or hook, open | the evaluator stores the spec and the standing proposal; the hook holds nothing of the criteria (storage doc owned by the evaluator track) |
| SDK namespace | `client.evaluation` (page 8) | none; job-side reads live in `client.job` ([7. SDK: 8183 Job](7%20SDK%208183%20Job%203ea188aea7f481e0a137f5a896723376.md)), `JobSpec` helpers (`buildJobSpec`, `encodeJobSpec`, ...) in `PushChain.utils.job` ([6. SDK: Universal Marketplace](6%20SDK%20Universal%20Marketplace%203ea188aea7f481e2961ed97129f3a4e6.md), section 3) |

# 4. Structural pieces

1. **Wire format.** `JobSpecTypes.sol` defined once and imported by the marketplace, the hook and the evaluator; never copied. Limits: `MAX_READS 16`, `MAX_CHECKS 16`, `MAX_LOGIC 32`, enforced by the evaluator, not the builder.
2. **Hook touchpoints.** `afterAction(setBudget)`: mutability check, proposal hand-off. `afterAction(fund)`: freeze, snapshot. `afterAction(submit)`: `verify` in a try. On Push the same hook also binds the AGW's rules in `beforeAction(fund)` ([3. 8183 (job kernel and hook)](3%208183%20(job%20kernel%20and%20hook)%203e9188aea7f48188a838c3a740d8c858.md)). `createJob` is hookable on the Push kernel only (2026-10-12) and the evaluator never depends on it.
3. **Snapshot.** One before read per NUM or PCT check, all pinned to the height at `fund`. Prefunded by the client; `quoteSnapshot` prices it. If the snapshot never completes, the job cannot pass a NUM or PCT check and expires into `claimRefund`.
4. **Verify round.** Checkpoint first; after reads by quorum; decode each read through `outputs` and `field`; each check resolves to PASS, FAIL or UNKNOWN; the tree combines them; settle or wait. Paid by the caller with `msg.value`.
5. **Settlement.** `complete` or `reject` with a reason hash; the verified rating written in the same transaction (draft). Late or duplicate verdicts are skipped, never reverted.
6. **Other chains (phase 2).** `EvaluatorGateway` per chain, `EvaluationHookBase` template for kernels that run their own hook, Push's hook as a one-time whitelist, or manual `snapshot` and `verify`. Job key on Push is (chain, kernel, jobId), never a bare jobId.

# 4b. Contract surface, as a sketch (PROPOSED; follows the V2 build)

Read `+` as new. Names follow the V2 design and the Plugging page; the build may move them.

**UniversalEvaluator** (Push)

```diff
// lifecycle, called by the hook (or by any party on a remote chain through the gateway)
+ propose(address kernel, uint256 jobId, address caller, bytes spec)                 // afterAction(setBudget): checks allowedMutability vs caller; stores the standing proposal; refuses origin or allowedMutability changes
+ snapshot(address kernel, uint256 jobId) payable                                    // afterAction(fund): freezes the standing spec; fires before reads for NUM and PCT; prefund in msg.value or via prefund()
+ verify(address kernel, uint256 jobId) payable                                      // afterAction(submit) or anyone: checkpoint, after reads, logic tree, settle or wait
+ prefund(address kernel, uint256 jobId) payable                                     // client prepays the snapshot before fund
+ quoteSnapshot(bytes description) view returns (uint256)                            // what the snapshot will cost

// views
+ specOf(address kernel, uint256 jobId) view returns (JobSpec)                       // frozen spec, or the standing proposal while Open
+ statusOf(address kernel, uint256 jobId) view returns (EvaluationStatus)            // baseline height, before values, last round, verdict
+ version() view returns (string)

// events
+ JobSpecProposed(kernel, jobId, by, specHash)      // CriteriaProposed in the morning draft; one noun with the struct (2026-10-12)
+ JobSpecFrozen(kernel, jobId, specHash)
+ BaselineRecorded(kernel, jobId, height)
+ VerifyRound(kernel, jobId, round, result)                                           // PASS | FAIL | INCONCLUSIVE
+ Settled(kernel, jobId, verdict, reason)                                             // PASS | FAIL | CLIENT_INTERFERED
```

**EvaluationHookBase** (template for kernels on any chain)

```diff
+ afterAction(jobId, sel, data): fund => GATEWAY.snapshot(msg.sender, jobId); submit => try GATEWAY.verify(msg.sender, jobId) {} catch {}; then _afterAction (yours)
```

**EvaluatorGateway** (every other chain, phase 2)

```diff
+ snapshot(kernel, jobId) payable, verify(kernel, jobId) payable, prefund(kernel, jobId) payable   // forward to Push through the universal gateway
+ settle(kernel, jobId, pass, reason)                                                // only from the evaluator's execution account on this chain; calls complete or reject; late or duplicate skipped
```

# 5. Open

1. `JobSpec` field order and `origin`: decided 2026-10-12 (section 0). Remaining step is the evaluator team implementing it in `JobSpecTypes.sol`; both repos import from there.
2. Who may call the retry, and its name on the contract (tagged 2026-10-12).
3. Push-local, non-EVM and web2 reads. Decided 2026-10-12: a read whose chain is Push itself is a direct `staticcall` by the evaluator, no universal read round trip. For every other source the evaluator compares attested answers and needs no new path; what is missing is a `Read` struct that can carry the universal read envelope for Solana and web2 (EVM-shaped today). Future planning, not v1 (tagged 2026-10-12).
4. Fees beyond reads: whether the evaluator takes a fee and how external-chain settlement is funded. Research, with the fee design (tagged 2026-10-12).
5. Recurring jobs and renewal, with the one-live-job rule on the wallet (tagged 2026-10-12).
6. Where the verified rating record lives (8004 Validation Registry or a Push contract). Parked; to be addressed later (2026-10-12).