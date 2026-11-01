# 3. 8183 (job kernel and hook)

<aside>
📜

**Where we are going.** The ERC-8183 kernel and its hook on Donut, with Push implementing the Evaluator role of the standard. The AGW is the client of a marketplace job (any address can be the client of a plain job). The hook binds the job to the wallet's rules at `fund`, carries the provider's criteria proposal at `setBudget`, triggers the baseline at `fund` and the verdict at `submit`. The kernel's function signatures stay the standard's; Push's additions are marked as extensions.

**What this page is.** What the kernel and hook do today (from source), the lifecycle as decided, the kernel change the stack needs (K-12), the hook and evaluator split, and what is open. The public narrative with diagrams lives on [ERC-8183 x Push: Trust Layer](https://app.notion.com/p/ERC-8183-x-Push-Trust-Layer-3f4188aea7f48036a26bc8b58e748cf1?pvs=21).

**Status.** Kernel BUILT on `push-chain-core-contracts` branch `universalMarketplace_v1` (`AgenticCommerce.sol`), with tests, not deployed. `RulesBindingHook` BUILT, interim. `UniversalEvaluator` IN BUILD against the V2 design, ETA this week. Nothing on Donut yet.

</aside>

# 1. What exists (verified in source, 2026-10-07)

**Kernel `AgenticCommerce.sol`.** Base V3 shape with the K-01 to K-11 changes.

- Transparent proxy. One `paymentToken` set at `initialize` (changes with K-12, section 4). `platformFee` and `evaluatorFee` in bps, start at 0; `platformFee` goes to the treasury at `complete`, the evaluator fee to whoever calls `complete`.
- Hookable: `setProvider`, `setBudget`, `fund`, `submit`, `complete`, `reject`, each with `beforeAction` and `afterAction` and an `optParams` payload. `createJob` is hookable on the Push kernel (decided 2026-10-12, reverses K-10 for this kernel only; kernels on other chains are not expected to hook it, so the design must not depend on it). Not hookable: `claimRefund`.
- `createJob(provider, evaluator, expiredAt, description, hook)`: evaluator non-zero, hook whitelisted and ERC-165 checked, provider may be zero (bid mode) or set. The job is Open with budget 0.
- `setBudget(jobId, amount, optParams)`: provider only, re-callable while Open. `fund(jobId, expectedBudget, optParams)`: client only, provider must be set, `expectedBudget` must equal the stored budget, pulls `paymentToken`, status Funded. `submit(jobId, deliverable, optParams)`: provider, Funded only, `deliverable` is `bytes32`. `complete` and `reject`: evaluator only. `claimRefund`: client, after expiry plus a 1-hour grace for Submitted jobs, never pausable.

**Hook `RulesBindingHook.sol`** (was `MandateBindingHook`). Acts only in `beforeAction(fund)`: `optParams` must be exactly `abi.encode(rulesId)`; the client must be a factory AGW; the rules must be live on the session engine; the AGW must have no Funded or Submitted job under this hook. Then records the binding and emits `RulesBound(jobId, agw, rulesId)`. Every other action passes through. Views `rulesOf(jobId)` and `liveJobOf(agw)` (renamed below).

# 2. The lifecycle, as decided

| Kernel call | Who | What Push does there | Status |
| --- | --- | --- | --- |
| `createJob` | client (the AGW through `openJob`, or any address directly) | `evaluator` = `UniversalEvaluator` on Push (or the `EvaluatorGateway` on another chain, phase 2); `description` = `abi.encode(JobSpec)`; `hook` = the rules hook. Hookable on the Push kernel (2026-10-12): the hook may learn the job at creation; on other chains it is not, so the evaluator still only depends on `setBudget` and `fund`. K-12 adds `paymentToken` here. | DECIDED |
| `setBudget` | provider | Prices the job in the job's token. `optParams` may carry a replacement `JobSpec`; the hook's `afterAction(setBudget)` checks `allowedMutability` against the caller and the evaluator stores the proposal, or the call reverts. A proposal is not an agreement. | DECIDED (2026-10-06); hook and evaluator code pending |
| `fund` | client | The client's acceptance. `beforeAction(fund)`: bind job to rules (section 1). `afterAction(fund)`: freeze the standing `JobSpec`, take the baseline (one before read per NUM or PCT check, pinned to the height at `fund`), paid from the client's prefund (`quoteSnapshot(description)` returns the amount). No further `setBudget` once Funded. | DECIDED (2026-10-06); snapshot owned by hook plus evaluator |
| `submit` | provider | `afterAction(submit)` calls `verify(jobId)` on the evaluator: checkpoint first (any owner-side change after the baseline completes in the agent's favour), after reads by validator quorum, logic tree, settle. A separate provider-callable retry exists for partial read failures. | DECIDED (2026-10-06) |
| `complete` / `reject` | evaluator | PASS calls `complete`; FAIL after `failFinalAt` calls `reject`; an early FAIL or an inconclusive round sends nothing and `verify` can run again. `reason` is a hash of the job and the round. Verified rating written in the same transaction (draft). | DECIDED |
| `claimRefund` | client | Untouched. The evaluator never holds funds and never blocks the kernel; `failFinalAt` sits well before `expiredAt`. | unchanged |

Started is an evaluator fact, not a kernel state: the job has started when the baseline is recorded. The hook and the evaluator are separate contracts (DECIDED 2026-10-06, option A): the hook maps job to wallet rules and exists only on Push; the evaluator is directly callable so a developer with their own hook, or no AGW at all, can use it, and other chains' kernels whitelist their own hooks.

# 3. Criteria: the shared wire format

`JobSpec` is defined once (`JobSpecTypes.sol` in the marketplace repo) and read by the marketplace (writes it), the hook (freezes it) and the evaluator (judges it). Field order is ABI; a change here changes every description.

```solidity
enum Evaluation        { BOOLEAN, COMPARE, NUMBER, PERCENTAGE }   // was EvalType { BOOL, CMP, NUM, PCT } (renamed 2026-10-12)
enum Operation         { EQUAL, NOT_EQUAL, GREATER_THAN, GREATER_OR_EQUAL, LESS_THAN, LESS_OR_EQUAL }   // was Op
enum LogicKind         { ALL, ANY, AT_LEAST }                     // was NodeKind; CHECK leaf dropped (PROPOSED 2026-10-12)
enum AllowedMutability { NONE, CLIENT, PROVIDER, BOTH }           // was Mutability; who may propose a replacement spec at setBudget

struct Read  { string chainNamespace; string chainId; uint16 minConfirmations; address target; bytes4 selector; bytes args; bytes outputs; uint8[] field; }
struct Check { uint8 read; Evaluation evaluation; Operation operation; int256 target; }
struct Logic { LogicKind kind; uint8[] checks; uint8[] children; uint8 k; }   // was Node; operators list checks and child operators directly; logic[0] is the root

struct JobSpec {
    Read[]     reads;       // what to look at
    Check[]    checks;      // how to compare each value; NUM and PCT need the baseline
    Logic[]    logic;       // how the checks combine; was nodes
    AllowedMutability allowedMutability;   // who may propose a replacement spec at setBudget
    bytes32    origin;      // marketplace jobs: keccak256(marketplace, cardId, cardVersion, principal); zero otherwise
    uint64     executeBy;
    uint64     failFinalAt;
}
```

`PROVIDER` means the provider may propose a whole replacement spec; the evaluator refuses a proposal that changes `origin` or `allowedMutability` itself; timing stays inside the job's `expiredAt`; the client accepts by funding. Field order decided 2026-10-12: content first, then `allowedMutability` and `origin`, then timing ([4. Universal Evaluation](4%20Universal%20Evaluation%203e9188aea7f4817bb03ef4c78c883f8b.md), section 0); the evaluator team implements it in `JobSpecTypes.sol`.

# 4. Kernel change the stack needs: K-12, payment token per job

ERC-8183 carries no token on any call: `createJob`, `setBudget` and `fund` are token-less, and the token is an implementation constant of this kernel. The card wants to name its payment token and the job to inherit it. DECIDED (2026-10-09): `createJob` takes `paymentToken`; escrow is tracked per token; `fund` pulls and `complete` pays the job's token; `setBudget` keeps its one role, the price in that token. The token sits inside the `createJob` calldata the owner signs at `openJob`, so nobody can swap it afterwards. Two consequences to record in the interface: `createJob` is not hooked on other chains' kernels, so a hook reads the token from the job struct at `setBudget` or `fund`; and the argument is a Push extension, marked as such so a Base or BNB integration does not expect it. Until it lands, cards are priced in the kernel's one token.

# 5. Hook changes

- Renames: `rulesOf(jobId)` becomes `rulesOfJob(jobId)` and `agwOfJob(jobId)`; `isAGWBusy` and `liveJobOf` become `activeJobOf(agw) returns (uint256)`; one spelling with the marketplace.
- New: `afterAction(setBudget)` mutability check and proposal hand-off; `afterAction(fund)` freeze and baseline; `afterAction(submit)` verify. The interim hook is being extended into this (owner: the evaluator track, building on the existing hook).
- Dropped from the earlier plan: the binder role (rules expire by `validUntil`, caps bound the gap); the hook recomputing a criteria hash (the marketplace builds criteria on-chain, so there is nothing to recompute); the hook refusing `submit` before the baseline (the evaluator returns inconclusive instead and `verify` runs again).
- Still to check in the hook for non-marketplace jobs: the rules' `validUntil` is at or after the job's `expiredAt`, and the rules' agent equals the job's provider. The marketplace already enforces both at `openJob`; a plain job that names the hook gets them here or not at all.

# 6. Fits the standard

Push implements the Evaluator role in ERC-8183. The kernel ABI is Base V3's with the K changes; K-12 is the first change to a standard function's signature and is marked as a Push extension. Everything the hook and evaluator do runs through the standard's own hook points and evaluator role. The open-jobs and budget-proposals extension is a separate proposal: [Proposal: Open Jobs and Budget Proposals for ERC-8183](https://app.notion.com/p/Proposal-Open-Jobs-and-Budget-Proposals-for-ERC-8183-3f4188aea7f481cdad84fdd7a446ab7b?pvs=21).

# 7. Open

1. `createJob` hookability. Decided 2026-10-12: hookable on the Push kernel (reverses K-10 here), not assumed for kernels on other chains. The evaluator therefore still learns a job at `setBudget` or `fund`, and the Push hook may use the `createJob` hook for bookkeeping only.
2. Client cancel of an Open unfunded job. Decided 2026-10-12: yes, at the kernel. Open: the hook (or a narrow stop role) must release the AGW's rules on cancel so the wallet is not blocked until `expiredAt`. Research tagged.
3. `JobSpec` field order and `origin`: decided 2026-10-12 (section 3); pending implementation in `JobSpecTypes.sol`.
4. Fee design: the kernel's `platformFee` exists; who pays reads (client prefund at `fund` for the baseline, the submitter for after reads, as drafted) and whether external-chain evaluators are charged differently. Research, after AGW (tagged 2026-10-12).
5. Recurring jobs: a 7 or 15 day job that renews until cancelled, because a year of fees cannot be escrowed for "4% as long as the principal stays". Research; interacts with the one-live-job rule (tagged 2026-10-12).
6. Phase 2: jobs on other chains name an `EvaluatorGateway` on their chain; snapshot and verify travel to Push through the universal gateway, the verdict comes back TSS-signed. Planning doc pending; must not block the V2 evaluator build (tagged 2026-10-12).