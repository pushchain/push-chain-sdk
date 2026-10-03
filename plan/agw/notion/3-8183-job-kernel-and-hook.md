# 3. 8183 (job kernel and hook)

<aside>
📜

**Where we are going.** The ERC-8183 kernel and its hook deployed on Donut. The AGW is the client of every job. The hook binds the job to the wallet's rules at fund, checks the provider's key and the rules' expiry, registers the criteria with the evaluator, and refuses submit until the baseline exists. Push implements the Evaluator role in the standard; the kernel ABI stays Base V3's.

**What this page is.** What the kernel and hook do today (from source), the checks the hook still needs, the flow decisions from 2026-09-28, and what is open.

**Status.** Kernel and hook BUILT on branch `8183-v1` with tests, not deployed. Hook is PARTIAL.

</aside>

Status: BUILT on `push-chain-core-contracts` branch `8183-v1` (commit 01439d1) with tests. Not deployed. Hook is PARTIAL.

# What exists (verified in source)

**Kernel `AgenticCommerce.sol`**: Base V3 shape with the K-01 to K-11 changes.

- Transparent proxy. One payment token, set at initialize. Platform fee and evaluator fee in bps, start at 0.
- Hooks fire on setProvider, setBudget, fund, submit, complete, reject. Not on createJob, not on claimRefund.
- claimRefund is never pausable. 1-hour grace after expiry for Submitted jobs. 5-minute minimum expiry window.
- Evaluator may equal the client. Evaluator fee is paid to whoever calls complete.

**Hook `MandateBindingHook.sol`**: acts only in `beforeAction(fund)`. `optParams` must be exactly 32 bytes (the rules id). Checks three things: the client is a factory wallet, the rules are enabled on the engine, the AGW has no Funded or Submitted job. Stores `mandateOf[jobId]` and `liveJobOf[agw]`.

# What the hook must also do (not implemented yet)

| Check | Why | Where |
| --- | --- | --- |
| Rules key equals the provider's registered execution key | Otherwise a different agent works while the job's provider is paid. Harsh: the one hard restriction for using 8183 with AGW. | beforeAction(fund) |
| Rules `validUntil` at or before job `expiredAt` | Rules must outlive the job. | beforeAction(fund) |
| Rules chain matches the criteria's execution chain | A job on Base cannot run under Sepolia rules. | beforeAction(fund) |
| Criteria hash matches `compile(card, userInput)` for card jobs | Provider acceptance (page 2). | beforeAction(fund) |
| Register criteria with the evaluator and fire START reads | Job start is fund. | afterAction(fund) |
| Refuse submit before START reads landed and before `minDuration` | No baseline, no grade. Blocks early-submit gaming. | beforeAction(submit) |
| Free the rules when the job ends | Needs the binder role on the AGW (page 1). | afterAction(complete or reject) |

The hook uses exactly these kernel touchpoints: afterAction(fund), beforeAction(submit), afterAction(complete or reject). Nothing else.

# Flow decisions (2026-09-28)

- Job start is fund, not createJob. Provider may be zero at createJob.
- Criteria travel in the kernel's `description` as the hex of `abi.encode(Criteria)`. One carrier. The hook reads `getJob(jobId).description` at fund, decodes, validates, registers. Portable to Base and any other 8183 kernel.
- Started is an evaluator fact, not a kernel state: the evaluator emits `PreRecorded(jobId)` when the last START read lands. The hook refuses submit until then. The agent SDK waits for the event.
- Checkpoint rule: before any END read, the evaluator checks the AGW's checkpoints. Any owner-side change after PreRecorded (principal moved, rules changed, key changed) means complete, provider paid, no reads. This is also the answer to "rules changed mid-job": no rebind, the fee ends in the agent's favour.
- setProvider is only for bid mode. In direct mode createJob carries the provider.
- Reputation writes only for jobs judged by the UniversalEvaluator from a registered card.

# Fits the standard

Push implements the Evaluator role in ERC-8183. The kernel ABI is Base V3's with the K changes. Nothing here changes the standard's function signatures.

# Open

1. Fee token: PUSD by default (gas is always PC). The kernel is single-token per deployment; USDC.eth or others mean a second kernel deployment or a multi-token kernel change. Decide which.
2. Fixed fee on the card (no setBudget) or provider quote after createJob. If quote: pre-signed quote inside the user's signature, or fundIfQuoted.
3. Who pays reads and whether the evaluator takes a fee (parked, not needed for the POC).
4. Portability constraint for Base later: the evaluator keys jobs by (chainNamespace, kernel, jobId), not local jobId, and its entry points are callable by a wrapper contract through the universal gateway.