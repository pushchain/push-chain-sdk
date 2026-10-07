# AGW source refresh and SDK alignment — October 7, 2026

Reviewed SDK `898eda17` against fresh Notion exports, fetched AGW/core/gateway refs, and read-only deployment probes. No runtime files were changed and no transactions were broadcast during this review.

**Review baseline/result:** no new AGW contract/deployment drift. `setLabel` remains the only pending standalone AGW contract-delivery item. At that reviewed commit, two SDK-owned alignment follow-ups were found: policy-preflight/error consistency and Solana owner funds-only parity. Several Notion sections also lag the agreed decisions.

**Subsequent disposition:** G27/G28 have been fixed and validated. [SDK fix report](../sdk-alignment-fixes-2026-10-07/README.md). The findings and reproduction below preserve the pre-fix evidence; they do not describe current production send paths.

## Freshness and evidence

| Source | Fresh result |
| --- | --- |
| All 12 registered Notion bodies | Exported and imported at 2026-10-07 10:27:18 UTC (15:57 IST); 1 changed, 11 unchanged; no missing/unknown pages |
| SDK page 5 | Only body change: removal of `ref: jobRef` from the create example |
| Primary Notion discussions | Pages 1 and 5, including resolved threads, inspected through All discussions |
| AGW | `deploy-agw@10a24f1`, source `pushAgenticWallet_v3@e8db748`; unchanged |
| Core marketplace | `universalMarketplace_v1@9479aef`; only three documentation files added since prior pin `cb69e0b`; code unchanged |
| Gateway | `pc20-3rd-iteration@bcbf7df`; unchanged. All remote refs were fetched; the alternative SVM audit branch is not assumed to replace the configured deployment |
| Donut | Chain 42101, block 23989371: code hashes, proxy slots, version, pause state and wiring match the prior probe |
| Solana devnet | Slot 508426857: gateway and test-counter ProgramData fingerprints match October 6; gateway remains unpaused |

[Notion comparison and hashes](../../notion/history/20261007T102718466408Z/refresh.json), [page-5 body diff](../../notion/history/20261007T102718466408Z/5-sdk-agw.diff), [raw exports](../../notion/exports/20261007T102718466408Z/), [contract refs/diffs](contract-refresh.json), [Donut probe](donut-probe.json), [Solana probe](solana-probe.json).

The new core docs clarify the already-reviewed per-token caps, job/rule expiry equality and marketplace rejection of approval selectors. They do not change standalone AGW contract behavior. Current copies are retained under [contracts/](contracts/).

## SDK findings at reviewed commit 898eda17

### G27 — Policy preflight and error shape differ from the spec (SDK-owned, P1)

The refreshed SDK spec §2.a says URP is the rule checker and rule failures surface as `AgenticRevertError` with `decodedError`. The user’s latest clarification also puts rule enforcement at the contract, with SDK error mapping.

The public Solana route evaluates stored policy constraints locally before entering its send/error-mapping block:

- `execution/svm-public.ts:95` awaits `prepareSvmAgentExecution`; its `wrapSendError` catch is later, around the actual execution (`222`).
- `execution/svm-outbound.ts:26–50` evaluates expiry, asset amounts, cumulative spend and PC limits. Refusals are `AgenticError` / `RULE_LIMIT_EXCEEDED`, with a string in `details.contractError`.
- `execution/svm-payload.ts:22–25, 102–135` evaluates allowed programs and account/data pins. Refusals are `AgenticError` / `INVALID_RULE`, without `decodedError`.
- The EVM route also performs a local `maxGasPerCall` check in `execution/send.ts`; align the distinction consistently across both VMs.

Reproduced expiry and wrong-account refusals: neither is an `AgenticRevertError`, and `decodedError` is absent. This concerns validation placement and the public error contract; authorization is still enforced by URP. Existing passing refusal E2Es do not establish error-type parity because some assert only the message.

**Recommended SDK action:** retain structural/context/funding validation, but obtain policy rejections from the contract/simulation and pass them through the existing mapper. Do not fabricate an on-chain revert for a purely local decision. Add public-path tests for error class, decoded gate and no state change. If retaining local policy checks deliberately, their distinct behavior needs an explicit documented public contract rather than a claim of spec parity.

### G28 — Solana owner funds-only sends are unavailable (SDK-owned scope gap, P2)

The spec §1.d promises the owner ordinary wallet send tooling. The contract owner door checks no policy (`docs/5_SDK_Owner_Integration.md:307–323`). Gateway classification already supports amount > 0 with an empty payload as FUNDS.

`execution/svm-public.ts:54–61` rejects absent instruction data for both owner and agent doors. A public owner-route reproduction with funds and no instruction returns `INVALID_RULE` before execution. The ordinary core SVM payload builder accepts the corresponding no-execution shape. Our consumer guide already discloses this restriction, so it is an existing scope limitation rather than a newly broken deployment.

**Recommended SDK action:** support funds-only sends on the owner door using the normal gateway route, with balance/allowance checks and receipt/replay coverage. Preserve the agent rulebook’s instruction requirement. No contract change is needed for the owner route.

[Read-only source reproductions](reproduce-sdk-findings.cjs), [results](sdk-findings.json). These isolate SDK branches with local inputs; they are not additional live delivery tests. Run against an isolated SDK checkout at `898eda17` using AGW_REVIEW_SDK_ROOT; the public path has since changed:

```sh
AGW_REVIEW_SDK_ROOT=/path/to/isolated-sdk-at-898eda17 TS_NODE_PROJECT=packages/core/tsconfig.lib.json node -r ts-node/register/transpile-only plan/agw/research/source-refresh-2026-10-07/reproduce-sdk-findings.cjs
```

## Notion text needing reconciliation

The new “omitting ref” comment and example edit agree with our removal. However, page 5 still contains:

| Stale text | Current agreed/implemented position |
| --- | --- |
| `ref` in NativeRule, UniversalRule, RulesRecord and prose | Rule ref removed; checkpoint ref retained |
| One rule per agent/chain and `DUPLICATE_RULE` | Multiple grants allowed; SDK retains AMBIGUOUS_RULE when lookup finds several candidates |
| Public `spent` and `compileCard` | Excluded from standalone v1 by Harsh’s earlier replies |
| Public generation-dependent helpers | Kept internal under the earlier approved scope |
| Push EOAs cannot batch / require a new factory method | Existing sender-preserving 7702 batching is implemented and tested |
| Solana rulebook “once it ships,” without final public IDL types | v4 rulebook deployed; public supported-IDL integration implemented |
| No validator at all | Sender-bound AgentValidator remains as the SmartSession adapter; no engine fork |

Page 1 still describes the previously corrected six-field gateway migration direction. Fresh sources and live slots support the currently integrated eight-field request. Its proposed grant refs also lag the removal decision. These are documentation corrections, not reasons to revert the SDK to historical behavior.

The contract owner guide’s `beneficiaryOffset = 4 + 32 * argIndex` is valid for the simple scalar ABI example, but is not a general formula for arbitrary static arrays/tuples. Keep the SDK’s ABI-layout calculation and exact offset reads.

## Visible discussion review

- Page 5: new Harsh comment “omitting ref,” shown as 2h old, attached to the create-example thread. The earlier multiple-rules, token-independence and deleted-content limit discussions remain visible. No newer substantive answer changes the user-relayed decisions.
- Page 1: latest visible substantive label comment remains October 1: owner-only setLabel / LabelSet, not a checkpoint. No delivery announcement/ABI appears in the thread.
- Overview and pages 2/3/4/6/7/8: loaded header showed no Comments button. This is a visibility observation, not proof that no hidden/resolved discussions exist.
- Historical SDK: September 18 WIP comment; no current-scope change.
- Historical address book: no Comments button; body still describes an older deployment and is kept historical.
- Historical wallet flow: September 7 tooling question, no new reply.

Native exports exclude comments; these observations are separate evidence and no comment was posted or edited.

## Remaining external work and limits

`setLabel` still needs Zaryab’s implemented ABI/deployment. Automatic-selection delivery is **not** requested; existing contract enforcement and SDK ambiguity handling remain the clarified design. `creditRevert` remains a separate platform executor dependency, with ordinary refunds not restoring spent.

Supported public IDL layouts remain a documented subset (fixed Anchor fields, flat non-optional accounts, eight-byte discriminators; one instruction per SVM send). This refresh did not expand that scope or rerun funded suites. It is an alignment review, not a full security audit.
