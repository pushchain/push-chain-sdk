# Notion discussion observations — October 20

Read from signed-in Chrome's current **All discussions** panels. These notes are paraphrases, separate from the body-only Markdown export. Dates below are the displayed dates. This is not a full export of resolved/hidden history. No team replies or page edits were made.

## Page 2 — Universal Marketplace

- **Zaryab, Oct 16**, attached to M7 owner approvals: AGW v6 can EQ-pin the spender and MAX-cap approve amounts; its change doc explicitly uses an Aave allowance example. Asks Harsh to reconsider the old approval restriction. No resolution is visible in this discussion panel. The newly deployed branch independently implements pinned agent approvals, so page 6's public API still needs alignment.
- **Harsh, Oct 12**, recurring-jobs open item: asks Aman/Zaryab how 7/15-day renewals interact with one-live-job-per-wallet, including a successor slot. **Aman, Oct 13**: ERC-8183 has no renewal concept; renewal must create another job, with sequencing a product/AGW choice.
- **Aman, Oct 13**, Open cancellation: confirms client can reject an Open unfunded kernel job. Does not establish AGW permission cleanup.

## Page 6 — Marketplace SDK

- **Harsh, Oct 12**, card enumeration: asks Zaryab to distinguish on-chain count/ID-range/provider lookup from indexer needs and practical scale. No visible answer in that thread. Source now supplies agentCardCount/getAgentCard/agentCardOf; initial enumeration is SDK-owned work.

## Page 3 — Kernel and hook

- **Harsh, Oct 12**, fees: assigns client baseline prefund/provider verification costs and platform/external-chain fee research to Aman. **Aman, Oct 15**: client prepays snapshots; provider pays verification; suggests zero kernel platform fee when neither sponsorship nor triggers are supplied, with any additional fee potentially in marketplace. This is a recommendation, not evidence of an implemented marketplace fee. Live kernel fees are zero.
- **Harsh, Oct 12**, renewals: asks Aman/Zaryab to research per-period escrow and occupancy. **Aman, Oct 15**: says initial research will begin. No delivered renewal protocol is established.
- **Harsh, Oct 12**, phase 2: requests EvaluatorGateway planning. **Aman, Oct 13**: says a proposal has already been presented/agreed and no theoretical blockers found; links `3f0188aea7f480169cdcc33375f564a5`. That linked phase-2 proposal was not part of this v1 contract review, and no gateway deployment is inferred.
- **Harsh, Oct 12**, cancellation: asks for hook/narrow-role cleanup so cancellation also releases wallet rules. **Aman, Oct 13**: reject is hookable; direct hook→AGW authority appears missing. Independent review now distinguishes occupancy from permission and proves an owner-batch cleanup path on current v6. Automatic cleanup by a hook still needs its own authority design.

## Page 7 — Job SDK

- **Harsh, Oct 12**, verify/retry: asks whether anyone or only provider can rerun verification and for exact function name. **Aman, Oct 15**: refers to Nilesh, notes verifyFromSubmit is currently onlyHook in evaluator revision `4391181a143616bfe16c49be163b663c82cfe58f`, and says ideally anyone may call the retry.
- Later linked evaluator revision `8059817` was read directly: verifyFromSubmit remains onlyHook; public sendReads/retrySnapshot are separate operations. Do not equate a retry desire with a public verifyFromSubmit capability. Live v2 uses neither contract; evaluator is an EOA.

## Page 4 — Evaluation

- **Nilesh, Oct 16**, attached to the shared Solidity format: links [JobSpecTypes at `8059817591cca16c59f1cc154f475f51e1736a67`](https://github.com/pushchain/push-chain-core-contracts/blob/8059817591cca16c59f1cc154f475f51e1736a67/src/agentic-commerce-8183/libraries/JobSpecTypes.sol#L48-L77). Adds Read.at (POST/PRE); baseline is explicit in PRE reads; Check.left/right are arrays whose values are summed; MAX_READS grows to 32. Rationale includes protocol totals and cross-chain comparisons. The actual linked file also changes top-level order, Logic/CHECK representation and enum ordinals, beyond what this comment lists. [Comparison](wire-comparison.json).
- **Harsh, Oct 12**, shared wire: says content-first order with origin must be the one imported definition. Also asks Aman/Nilesh to use direct check references rather than CHECK leaf nodes, with common Evaluation/Operation/AllowedMutability vocabulary. Those body decisions are not implemented by the later linked evaluator profile.
- **Harsh, Oct 12**, verify retry: asks for authorization/name; **Aman, Oct 15** says Nilesh can verify the name and anyone can trigger. Current code distinguishes hook trigger and public retries.
- **Harsh, Oct 12**, source kinds: Push-local reads should use direct staticcall; evaluator web2 path is not defined and is future scope. **Aman, Oct 15** acknowledges.
- **Harsh, Oct 12**, fees: asks about evaluator fees/external settlement. **Aman, Oct 15** says current design has the provider pay evaluator invocation via hook or directly, reflected in profitable provider quotes. This remains distinct from client baseline prefunding.
- **Harsh, Oct 12**, recurring jobs: asks what each renewal needs (fresh baseline/spec/rearmed spec). No visible resolved design in this panel.

## Page 8 — retired placeholder

Current title is “SDK: Evaluation (retired, placeholder)”, edited Oct 12. The body explicitly retires client.evaluation, moves authoring helpers to utils.job/market and job-side state to client.job. No Comments toolbar button was exposed in this page's current UI. No absence-of-all-historical-comments claim is made.

## Supplied team message

The user supplied M4/K-12 concerns plus Zaryab's subsequent v2 deployment notice. Treat that as session evidence of intended rollout: current pUSDC-only kernel, EOA evaluator, four EVM testnets, SDK branch sdk-iteration-v1. The proposed NONE-only scope, token allowlist, CLIENT route and fund spec-hash commitment were questions/proposals in that discussion, not settled implementations. They are analyzed in [M4/M6](../../analysis/mutability-and-payment.md).
