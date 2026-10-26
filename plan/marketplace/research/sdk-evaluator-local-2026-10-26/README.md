# Local PRE/POST SDK implementation — October 26, 2026

Built locally on `feat/agw-sdk-v4`, from SDK head `e61c9606`, targeting the confirmed evaluator source `8666c2ac2304ffd97a7ada121170c397d0f6125d`. Changes remain uncommitted and unpushed as requested. No public-chain transaction, deployment or package publication was sent.

## Delivered

- `PushChain.utils.job.prePost`: explicit format, timing-free JobSpec, new EvaluationTemplate, PRE/POST reads, left/right sums, CHECK graphs, all-use validation, correct enum ordinals and explicit NONE. Exact topological graphs and signed bytes are retained. Template fills/principal/parameter resolution matches the real Solidity builder byte for byte.
- Descriptions and paid previews: explicit historical blocks for PRE reads; aggregate fee cap; authenticated request-ID recovery with no new payment; bounded result decoding including array-length checks; unknown-aware sums and exact percentage comparison. Missing/overflow values remain unknown; nonpositive percentage denominators fail. The existing deployed-v2 helper behavior is retained.
- `client.job.withEvaluator(config)`: scoped deployment, optional standalone kernel and code pins, block-consistent evaluator/hook/kernel checks. Existing manual jobs still use legacy decoding. No future addresses are installed as defaults.
- Funding: reviewed budget and spec hash, explicit read-fee cap, initial read-cost quote, optional PC headroom and balance checks. Approvals, evaluator PC prepayment and escrow acceptance use one atomic owner batch. The cap bounds the current quote and added PC, not future consumption from an existing prepaid pool.
- `quoteEvaluation`, `verify`, `claimReadFees`: quote initial PRE/POST fees, recover missing PRE/evaluation reads through the actual public entrypoints, settle a decided-but-unapplied verdict and return unspent evaluator PC to the recorded client. Caller/status and explicit retry-payment limits are checked before signing. Mutable criteria negotiation remains deferred.
- Status/watch: frozen criteria/hash, read phases, answers, request IDs, heights, single evidence hashes, readiness, prepaid PC, verdict and settlement state. Hook/evaluator events share the existing cursor/deduplication/reorg behavior.
- Consumer guide/public types/constants and opt-in local evaluator tests. The API checker normalizes overloaded callable references so declaration aliases do not create a false source/built mismatch.

## Acceptance

| Check | Result |
| --- | --- |
| Full unit suite | **2,302 pass**, 12 existing skips; 148 suites pass, one skipped |
| New SDK local contract scenarios | **8 pass**, no failures/skips |
| Build and library/spec/evaluator-local/marketplace-local types | Pass |
| Changed production lint | Pass, zero errors/warnings |
| Marketplace consumer guide | Nine TypeScript blocks compile |
| Package | CJS/ESM imports, compiled declaration examples and npm contents pass |
| Public API | Compiled declarations equal source; comparison baseline includes older AGW work and is not a claim that all reported API changes originate here |
| Existing deployed-stack fork rerun | **Not accepted**: RPC-limited; 11 reported failures, zero passing cases |

Local scenarios use real pinned v6 AGW, kernel, hook, evaluator and Read State contracts on isolated Anvil, with mocked tracked chain metadata and manually delivered consensus values. They cover atomic prepayment/escrow and PASS payout; stale hash/fee refusal without payment; client retry of an unreadable answer at the same block; expired PRE retry and stranger refusal; paused-kernel settlement recovery/events; exact Solidity template construction; legacy manual jobs; and FAIL/refund. They do not prove live validator consensus or a compatible marketplace rollout.

`submit` fixes end blocks, but dispatch is best effort. Real RPC gas estimation can leave reads unsent; the local SDK tests explicitly recover this through `verify` → `retryEvaluation`. The first harness attempt assumed immediate dispatch and failed; it is not counted as acceptance. Each scenario now restores a clean chain snapshot. The early manual-job fixture also needed a distinct evaluator/provider, matching kernel rules; all eight final cases pass.

The pre-existing fork suite pins block 24447347. The ordinary Donut endpoint no longer served that block, so its default was corrected to the archive endpoint. That endpoint then returned HTTP 429s, failing setup/reads and cascading through the 11 cases. The final failed report is retained; no green fork regression is claimed. Local legacy-job compatibility and unit regressions passed independently.

## Repeat

From the repository root:

```sh
node node_modules/jest/bin/jest.js --config packages/core/jest.config.ts --runInBand
AGW_LOCAL_DIR=$(bash packages/core/scripts/agw-local/prepare.sh | tail -1) \
  node node_modules/jest/bin/jest.js --config packages/core/jest.evaluator-local.config.ts --runInBand
```

The evaluator harness requires Foundry/cached solc 0.8.26 and a `push-chain-core-contracts` checkout at the exact reviewed head. `CORE_CONTRACTS_DIR` overrides its location. Preparation checks source/dependency pins and builds without checkout, fetch or broadcast; the AGW preparation script may fetch missing pinned dependency revisions. Only local Anvil receives transactions.

[Validation summary and command outcomes](validation-summary.json), [unit JSON, gzip](unit-results.json.gz), [local SDK result JSON](local-results.json), [RPC-limited fork JSON, gzip](fork-rpc-limited-results.json.gz), [public API comparison, gzip](api-comparison.json.gz), [checked file hashes](checked-files.json).

## Remaining integration boundary

The evaluator branch's marketplace predates the current v2 card/rules ABI: it uses `startJob`, different card names and an owner-approval interface. The existing SDK intentionally keeps its deployed v2 register/open/deposit adapter. The new template codec and kernel lifecycle are implemented and locally accepted; wiring them into v2 cards requires the compatible marketplace integration commit and deployment addresses, followed by actual live evaluator acceptance. [Team questions](../../questions.md) now ask for that concrete handoff, plus CEA rollout alignment.
