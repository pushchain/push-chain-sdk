# AGW SDK implementation status

> Latest: [extended AGW live coverage](research/extended-e2e-2026-10-06/README.md). The unfiltered unit suite passes 1,982 tests; all 75 Anvil cases and the core build pass. All 39 opt-in AGW scenarios, including the 14 management/native-policy additions, have passing selected-run live coverage. Public SVM destinations remain gated.

Updated October 6, 2026. Branch feat/agw-sdk-v4; runtime commits a66ff7d and b68bab7. The native/EVM migration uses deployed source e8db748. Runtime/test e704d5b adapters, ABIs and fixtures were removed at Shoaib's request; historical review documents are evidence only. [Full handoff, commands and validation](research/v4-implementation-2026-10-06/README.md).

## Validation

| Level | Current evidence |
| --- | --- |
| Unit | 1,982 passed, 0 failed; 12 skipped; 116 suites passed, 1 skipped |
| Local actual contracts | 75 passed, 0 failed; 10 suites against e8db748 on Anvil |
| ABI reproduction | All 5 explorer ABI entry sets match the isolated build, ignoring array order |
| Runtime matrix | Node 20.19.2 and 24.14.0 pass full units, local contracts and package/API checks |
| Build/typechecks | Build and lib/spec/local/AGW-E2E typechecks pass |
| Lint | 7 pre-existing errors in unchanged files; no new errors |
| E2E selection | AGW: 39 scenarios/11 files/39 tests; default all unchanged at 76/40/81 |
| Funded live | All 39 AGW scenarios have passing selected-run coverage; 0 outstanding native/EVM scenario failures |

Local gateway/core/token/executor and CEA lookup are fixtures. Actual AGW/factory/engine/validator/URP enforce the rules; native type-4 tests use real transactions. This does not prove production gateway, Cosmos/TSS, UEA or destination execution.

## Per-step matrix

| Step | Deliverable | Current status | Remaining work |
| --- | --- | --- | --- |
| 1 | Source/capability contract | V4 deployed source/ABIs pinned and reproduced | Refresh for future releases |
| 2 | Namespace/types/errors | Implemented; AMBIGUOUS_RULE replaces duplicate-authoring rejection | H4.5 public raw-offset boundary |
| 3 | Signer/wallet context | Owner/agent/read-only/identity guards retained | Release review; UEA identity cases pass |
| 4 | Registry/adapter | Donut v4 registered; unsupported networks fail | Release review; no legacy fallback |
| 5 | Wallet/checkpoint/rule reads | Native and EVM reads implemented; source tokens/beneficiary offsets reconstructed | Metadata scope; public SVM mapping (internal reads complete) |
| 6 | Normalization/codecs | Native/EVM envelope 1, ordered caps, hard-zero/max total, empty-list routing | H3 token wording; SVM public mapping |
| 7 | Create/add/revoke | Index-bound create, partial recovery, atomic writes; same-agent multiples allowed | Release review; deployed create/identity/batching paths verified |
| 8 | Atomic update | Native per-action and universal all-token assertions before revoke/grant | Public SVM authoring wrapper (internal lifecycle complete) |
| 9 | Owner/allowance | Owner path unrestricted; explicit separate allowance retained | Release review; production allowance/token debit and delivery verified |
| 10 | Native agent sends | Sender-preserving atomic batches retained | H6 selection for multiple matching rules |
| 11 | EVM outbound | V4 asset membership, maxGasPerCall, wallet CEA/refunds, signer gas and responses | Release review; Sepolia success/failure and UEA cases verified |
| 12 | SVM destinations | Internal live positive delivery and later terminal-rejection replay verified; public capability gated | Public mapping/display/dispatch agreement, adapters and public acceptance; rejection retry timing is documented separately |
| 13 | Responses/progress/errors | V4 ABIs and prior canonical replay/wait fixes retained | Delayed-index replay/polling tested with real contracts/receipts; no remaining SDK-owned response gap |
| 14 | E2E | 39 opt-in scenarios registered; added management/policy cases pass live | Completed native/EVM live coverage; public SVM acceptance after integration |
| 15 | Web2 | Prior implementation retained and included in full unit run | Consumer migration notes supplied; existing Web2 unit acceptance passes |
| 16 | compileCard | Outside standalone AGW; absent public export | Future marketplace scope |
| 17 | Documentation/release | Current status/gaps/handoff updated | Product scope decisions and public SVM integration/release review |

## Open product/contract choices

A01 approval policy, A04 internal generation details, A06 history deferral and A08 compiler scope remain settled. A02 native batching is implemented locally. A05 wire/accounting is delivered and implemented for EVM. A07 deployment/registry is supplied; grant ref and editable label remain absent and capability-gated.

Harsh’s October 6 reply prefers zero native PC omission defaults, matching the SDK, and invites Zaryab’s input. H3 token wording still needs an example-based clarification; current target retains maxValueTotal. Harsh redirected H4.4 public SVM representation to Zaryab, with [concrete proposals](public-api-proposals.md) ready. H4.5 covers raw-offset representation, and H6 send selection. [Harsh draft](questions-harsh.md); [Zaryab metadata draft](questions-zaryab.md). The fixture request is closed with [our live wire evidence](research/live-svm-wire-2026-10-06/README.md), including later terminal rejection after the initial timeout.

No public spent/history/compiler feature is reopened. Rule updates reset counters as agreed. Ordinary inflows do not restore spent; creditRevert remains a platform dependency.
