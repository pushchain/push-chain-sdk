# SDK v5 integration and label acceptance — October 7, 2026

The SDK now targets the current Donut v5 suite only. The existing `wallet.setLabel(label, opts?)` method is enabled. There is no new caller-facing method or automatic rule-selection change. Validation ran locally before commit and push. No contracts were deployed and no package was published during this implementation.

## Implementation

- Replaced the v4 deployment/adapter/ABI directories and fixtures with v5. Default source is `2e61e133e641b4e0e1ddbdc9306b0903b60e4dbb`; factory is `0x8137F96A50EBF41d904e3678c84c391a0D1BCcc5`, wallet implementation is `0x4D459Da499C14548aa16c46c57fD92880A88EBb4`, first scan block is 23989983. Existing v4 wallets are unsupported by this adapter, in accordance with the user's no-legacy direction.
- Durable ABI snapshots come from an isolated build of the exact v5 source. The local harness and ABI generator use that pin. [ABI signature changes](abi-signature-changes.json): wallet adds `label`, `setLabel`, `LabelSet` and `LabelTooLong`, and changes `initializeAccount()` to `initializeAccount(string)`. Factory, URP, engine and validator signatures are unchanged. This signature comparison does not itself prove bytecode equivalence.
- Wallet `info()` and `list()` read current labels at their snapshot block via `label()`, without deployment-event lookup. Custom labels and computed defaults are preserved. Undeployed preview slots still have an empty label.
- Public renames validate the 64 UTF-8 byte cap and signer ownership before signing, permit empty reset, use a single owner `execute` call targeting the wallet's own setter, await confirmation and forward the per-call progress hook. This works for EOA and UEA owners. It records **one owner-action checkpoint**; the underlying setter itself records none.
- Create validates the same byte cap before any RPC/signature. Create-race recovery uses the immutable deploy-event label, rather than the now-mutable label view. Regression tests cover a competing wallet renamed to match the requested label and a same-label deployment renamed afterward.
- `LabelTooLong` participates in the existing decoded contract error mapping. Source address/domain context and deterministic wallet prediction use the new factory. No rule encoding, ambiguity handling or authorization policy is changed.
- Added five registered public label E2Es and five actual-contract SDK label tests; updated shared E2E manifest verification to check the v5 selectors because `accountId()` has not changed. Updated the consumer guide, current planning status and team delivery documents.
- Existing uncommitted SVM alignment changes were preserved. Their prior proof remains recorded separately; no new live Solana delivery is claimed here.

## Validation

| Check | Result |
| --- | --- |
| Full core units | **2,010 passed, 12 skipped, 0 failed**; 120 passing suites |
| SDK against actual pinned v5 contracts on Anvil | **90 passed**, 12 suites; gateway/core/token/destination fixtures retain their documented limits |
| Regenerated contract vectors | Separate read-only comparison against the saved v5 fixture passed |
| Typechecks | Library, spec (including E2Es), local-contract harness passed; final library/spec checks also passed |
| Build | `core:build --skip-nx-cache` passed |
| Consumer/package | CJS/ESM imports on Node 20, compiled declarations, npm dry-run contents and 10 guide blocks passed; no legacy v4 contract directory remains in built output |
| API comparison | Compiled declarations match source; no transaction method, instance method or initialize-signature change against the checker baseline. Broader type changes in its report also include the earlier SVM work |
| Lint | Scoped AGW code/tests: 0 errors, 95 warnings (primarily existing test assertions and unused test imports); not claimed warning-free |
| E2E registration | **53 AGW scenarios / 13 files / 53 tests**; default `all` unchanged at **76 / 40 / 81** |
| Live Donut v5 | **15 scenarios verified across selected runs**: five labels, six native execution, four rule lifecycle |
| Integrity | `git diff --check` passed; changed/new text files checked for the available test credentials with no matches |

See [logs/](logs/), [live-evidence.jsonl](live-evidence.jsonl), and [api-comparison.json](api-comparison.json). [Read-only deployment/source verification](../deployment-review-2026-10-07-v5/README.md) preceded these funded SDK tests.

## Live run details and limits

The main run of labels, native execution and lifecycle finished **14 passed / 1 failed**. The failure was a test assertion expecting the later dispatch guard: a normal granted rule has no policy for wallet-self `setLabel`, so SmartSession correctly reverts earlier with `NoPoliciesSet`. Exact source confirms validation precedes dispatch. The assertion now decodes that engine error, and its focused rerun passed with label and checkpoint state unchanged. The other four label tests passed in the main run, including UEA ownership, rename and reset. This is not a claim of one unfiltered 15-pass invocation.

An earlier labels-only run was **4 passed / 1 failed** because its agent test created a wallet with no agent rule, so initialization correctly refused that signer. The corrected fixture grants an ordinary native rule. Both initial logs are retained rather than hidden. One multi-file run printed Jest's open-handle notice after completion and subsequently exited; no claim of a completely silent test runner is made.

Funded runs used only Donut and the existing Sepolia-origin test signer, fresh v5 wallets and fresh native agents. Each fixture funds its agent with the configured default 0.5 PC; the external-owner label case funds its UEA with a bounded 3 PC. Native fixture wallets receive 0.01 PC and bounded additional expiry-test value. No mainnet transaction, deployment or external team message was sent, and no credential was saved in the evidence.

The current source passes all 90 local contract cases, including EVM/SVM codecs, composition, accounting and rollback. Full live destination suites were **not rerun on v5**: prior v4 destination delivery evidence must not be represented as v5 delivery. Refund spend-credit wiring and bridge retry timing remain downstream operational dependencies. Node 24's full runtime matrix was not rerun in this pass.

The upstream signed-deploy label is still cosmetic and unsigned in OwnerIntent; this documented contract behavior is preserved. Successful rename transactions and actual wallet label/checkpoint reads are now verified live, extending the earlier read-only deployment review which had no existing clone to inspect.
