# 4. Universal Evaluation

<aside>
⚖️

**Where we are going.** One immutable evaluator that judges any job type from data. The agent writes the success test on its card as a list of conditions (read this, at these points, compare like this). Validators attest the reads. The evaluator compares and settles. A new job type is new data, never a new contract. v1 is the deterministic lane only; the committee lane comes later and is not claimed until it exists.

**What this page is.** The criteria schema, how Harsh's four families (true/false, greater/less, percentage, absolute) map onto it, the evaluation rules, what is reserved, and what it depends on.

**Status.** DESIGN, converged 2026-09-28. No code. Supersedes the 1st and 2nd Architecture and the Hook Design where they differ.

</aside>

Status: DESIGN. Converged on 2026-09-28 to one generic evaluator. No code. Supersedes UniversalEvaluator 1st and 2nd Architecture and the Hook Design where they differ.

# In one paragraph

The evaluator is dumb on purpose. A job's success test is data: an array of conditions, each one "read this value, at these points, and compare it like this". Reads come from Read State (validators attest at a pinned block). The evaluator compares and calls complete or reject. A new job type is new data, never a new contract. In v1 this is the deterministic lane only: validator-attested facts plus on-chain comparison. No committee, no staking, no commit-reveal. Say so externally.

# The schema (draft v0)

```solidity
struct Criteria {
    uint16      version;      // 1
    uint32      minDuration;  // seconds after fund before submit is accepted
    Condition[] conditions;   // 1..8, all must hold
}
struct Condition { Read read; Sample sample; Compare cmp; }

struct Read {
    string chainNamespace;    // "eip155:1" | "solana:..." | "push" (local, no fee) | "web2"
    uint8  queryType;         // 0 ACCOUNT_BALANCE, 1 CONTRACT_CALL, 2 STORAGE_SLOT
    bytes  target;            // 20 bytes EVM, 32 bytes SVM
    bytes  callData;          // CONTRACT_CALL only; ACCOUNT and PRINCIPAL placeholders resolved at compile
    uint16 word;              // which 32-byte word of the return to keep
    uint8  resultType;        // 0 UINT, 1 INT, 2 BOOL, 3 ADDRESS, 4 BYTES32
}
enum Sample { END, START_AND_END, PERIODIC }   // PERIODIC reserved, refused in v1

struct Compare {
    uint8   op;          // EQ NEQ GT GTE LT LTE IS_TRUE IS_FALSE
    uint8   basis;       // ABSOLUTE (end vs value) | DELTA (end - start vs value) | PCT (bps of start) | REF (vs another condition)
    int256  value;
    uint8   ref;
    uint32  period;      // reserved for PERIODIC
    uint16  minPassBps;  // reserved for PERIODIC
}
```

# The four families named, as data

| Family | Example | Condition |
| --- | --- | --- |
| True or false | Position is in range | read tick or state, sample END, op IS_TRUE (or REF between two reads) |
| Greater or less than | At least 1 WETH out | read WETH.balanceOf(ACCOUNT), START_AND_END, basis DELTA, op GTE, value 1e18 |
| Percentage | 4% on principal | read position balance, START_AND_END, basis PCT, op GTE, value 400 (bps, for the job's duration) |
| Absolute number | Deliver 100 USDC | read USDC.balanceOf(ACCOUNT), START_AND_END, basis DELTA, op GTE, value 100e6 |

# Rules of evaluation

- START reads fire at fund. The job is started when the last one lands (`PreRecorded`). END reads fire at submit. The verdict runs in the last END callback.
- The card author picks where each sample is taken. A PCT condition whose START value is zero fails; it does not revert. That is the author's mistake, not the evaluator's.
- Percentages are for the job's duration, not annualised. `minDuration` blocks early submit.
- END reads take three consecutive blocks, and the condition must hold at all three (from the 2nd Architecture). Cheap protection against one-block manipulation of protocol state.
- Before any END read: check the AGW's checkpoints. Any owner-side change after PreRecorded means complete, no reads.
- Push-local reads (`push` namespace) are direct staticcalls, no fee, no callback.
- A START read that errors or expires can be refired by anyone, paying the fee. If START never completes, the job cannot be submitted and expires to claimRefund.

# Not in v1, reserved

- PERIODIC sampling (rebalanced every day, true 90% of the time). Needs a scheduler. Fields are reserved so it slots in without a schema break.
- Solana reads that need `RAW_ACCOUNT_DATA` (fields inside program-owned accounts). Needs a slice query type in Read State. `LAMPORT_BALANCE` and `SPL_TOKEN_ACCOUNT` work today.
- Judging causation or quality. The evaluator proves numbers, not work. A prompt-based read in Universal Callback is the future path.

# Depends on

- Read State answers: archive depth validators serve (U1), gas cap on contract-call reads (U2), how often tracked heights update (U3). Block-pinned reads cannot be specified without them.
- Kernel deployment and the hook (page 3).
- Checkpoints on the AGW (page 1).

# Open

1. Where the registered criteria live: evaluator (default, one address holds all job state) or hook.
2. Read budget: who pays, how much, refund of unused (parked).
3. Evaluator fee (parked).
4. The evaluator entry points must be callable through a gateway wrapper later (Base). Job key = (chainNamespace, kernel, jobId).