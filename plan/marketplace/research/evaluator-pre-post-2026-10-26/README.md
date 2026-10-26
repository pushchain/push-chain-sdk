# Current evaluator target — October 26, 2026

Nilesh's correction, supplied by the user, identifies **`feat/universal-evaluator-pre-post-reads`** as the current branch. Fetched head [`8666c2ac2304ffd97a7ada121170c397d0f6125d`](https://github.com/pushchain/push-chain-core-contracts/tree/8666c2ac2304ffd97a7ada121170c397d0f6125d) matches open [contracts PR #132](https://github.com/pushchain/push-chain-core-contracts/pull/132), targeting `feat/universal-evaluator`. [PR metadata](pull-request.json). The sibling checkout was already at this clean head; neither working tree was switched or edited during validation.

This resolves which source to use for the next SDK integration. The existing SDK continues to support deployed marketplace v2; support for the newer source is pending SDK work, not another unanswered source-selection question. Compatible Donut deployment remains an external dependency for live acceptance.

## What changed

- [JobSpec](https://github.com/pushchain/push-chain-core-contracts/blob/8666c2ac2304ffd97a7ada121170c397d0f6125d/src/agentic-commerce-8183/libraries/JobSpecTypes.sol) is now `(reads, checks, logic, allowedMutability, origin)`. `executeBy` and `failFinalAt` were removed. This is another wire revision beyond the October 16 snapshot; kernel expiry and remaining marketplace job inputs are separate.
- Reads explicitly choose POST_EXECUTION=0 or PRE_EXECUTION=1. Checks sum `left[]` and `right[]`; logic has CHECK leaves. Limits are 32 reads, 16 checks and 32 logic entries. There is no longer a separate MAX_TERMS; the 32 KB description limit bounds it. The PR description still mentions 64 terms, so use pinned source for this detail.
- AllowedMutability is BOTH=0, NONE=1, CLIENT=2, PROVIDER=3. SDK authoring must explicitly encode its intended default; an omitted Solidity field means BOTH.
- The [card template](https://github.com/pushchain/push-chain-core-contracts/blob/8666c2ac2304ffd97a7ada121170c397d0f6125d/src/agentic-commerce-8183/libraries/Types.sol) is `EvaluationTemplate(reads, checks, logic, params)`: it has PRE/POST reads and left/right check arrays, with no template mutability field. The builder explicitly sets marketplace jobs to NONE.
- The hook still requires `(rulesId, expectedSpecHash, newSpec)` at funding for evaluated jobs. Hash mismatch reverts the funding transaction. Baselines are explicit PRE reads; they are not implicitly inferred from a NUMBER/PERCENTAGE check.
- In the [evaluator](https://github.com/pushchain/push-chain-core-contracts/blob/8666c2ac2304ffd97a7ada121170c397d0f6125d/src/agentic-commerce-8183/evaluator/UniversalEvaluator.sol), `sendReads` became payable `retryEvaluation(uint256)`, callable by the client or provider. It retries the same fixed blocks. `retrySnapshot(uint256)` is for unanswered PRE reads before evaluation starts. Expired-but-unswept requests can be retried.
- `verifyFromSubmit(uint256)` remains hook-only; submit initiates evaluation. A FAIL at the submit-fixed blocks is final. Public `settle(uint256)` retries application of a decided verdict after a failed kernel call.
- `snapshotOf` and `snapshotRequestOf` are absent. `answerOf` and `requestOf` cover both phases; `evidenceOf` returns one bytes32. `evaluationOf`, `ready`, `specHashOf` and per-read heights remain available.
- The [deployment helper](https://github.com/pushchain/push-chain-core-contracts/blob/8666c2ac2304ffd97a7ada121170c397d0f6125d/scripts/agentic-commerce-8183/UniversalEvaluatorDeploy.sol) deploys a fresh hook/evaluator pair, then requires kernel hook whitelisting and marketplace hook/evaluator configuration. It explicitly requires matching marketplace JobSpec construction and SDK funding parameters before activation.

## SDK implementation that can proceed locally

1. Add an explicit new wire profile with codecs, constants, types and template builders. Preserve the existing deployed-v2 profile and archived job decoding. Do not silently reinterpret signed bytes or select a profile by whichever decoder happens to accept them.
2. Update authoring, descriptions and paid previews for PRE/POST reads, summed left/right checks, CHECK leaves, explicit NONE and the timing-free spec. Preserve kernel/job timing where the contracts still require it. Unknown observations must remain unknown.
3. Add evaluator ABI/configuration and profile validation. Read the job's actual hook/evaluator and preserve historical deployments; do not route all old jobs through new global addresses.
4. Extend funding with reviewed spec-hash acceptance, `prefundCost`/`prefund` and atomic fee/escrow batching. Preserve the accepted budget and criteria across RPC/signing delays. Include fee caps and failure/recovery behavior.
5. Map SDK verification to the real lifecycle: submit initiates through the hook, `retrySnapshot` recovers PRE reads, `retryEvaluation` recovers evaluation, and `settle` recovers a decided-but-unapplied verdict. Enforce the actual status/caller restrictions and explicit PC spending.
6. Extend status/watch with evaluator state, frozen hash, read phases, heights, request IDs, evidence and settlement state. Use the current getters/events, not the removed snapshot API.
7. Run meaningful unit and local real-contract SDK E2Es: canonical bytes/template resolution, both profiles, hash-swap refusal, PRE/POST sums, funding fees, retry expiry/caller restrictions, failed settlement recovery and historical manual jobs. Update consumer examples and package/API checks. Live automatic-evaluator E2Es wait for a compatible deployment.

These items are the next implementation scope. This source check does not implement them or claim they are complete.

## Validation

**170 local contract tests passed, zero failed/skipped, across 11 suites**, using 64 runs per fuzz test. Coverage includes 27 executable criteria scenarios, 40 evaluator lifecycle cases, hook binding/criteria checks, JobSpec libraries, marketplace builder/conformance, pair deployment, gas cases and out-of-gas settlement recovery. The tests use mocked external dependencies; they are not funded SDK or live universal-read E2Es.

Command: `forge test --match-contract '(UniversalEvaluator.*Test|UniversalHook.*Test|JobSpecLibrariesTest|JobSpecBuilderTest|UniversalMarketplaceConformanceTest)' --fuzz-runs 64 --json`.

[Summary and source hashes](validation-summary.json), [raw test results, gzip](contract-tests.json.gz), [controlled wire vectors](wire-comparison.json). The new vector round-trips canonically under its own schema. It does not canonically cross-decode with deployed v2 or `8059817`; the new vector decodes under the old deployed schema but re-encodes differently, illustrating why decoder success is insufficient.

The separate [earlier October 26 live probe](../evaluator-branch-2026-10-26/live-deployment.json), at block 24655950, showed the existing marketplace still using a zero-code EOA evaluator. This follow-up sent no public-chain transaction and changed no SDK runtime. [Remaining team questions](../../questions.md).
