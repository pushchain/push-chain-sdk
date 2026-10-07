# AGW SDK implementation status

**Latest v5 integration:** the new factory, source/artifacts, stored label reads and owner-only rename/reset are integrated. [V5 validation](research/v5-implementation-2026-10-07/README.md) distinguishes current tests from earlier v4 evidence.

**Fresh alignment review:** [October 7 source refresh](research/source-refresh-2026-10-07/README.md) confirms stable deployed code and identified SDK follow-ups G27 (policy-preflight/error parity) and G28 (Solana owner funds-only support). Both are now fixed; [follow-up validation](research/sdk-alignment-fixes-2026-10-07/README.md) records contract-derived errors and actual SOL transfer/replay.

> October 7: [decision alignment and acceptance](research/decision-alignment-2026-10-07/README.md). All settled SDK choices are implemented. Editable labels are now delivered and implemented against v5; no standalone contract delivery item remains.

## Validation

| Level | Current evidence |
| --- | --- |
| Unit | 2,014 passed, 0 failed; 12 skipped |
| Actual contracts | 90 passed, 0 failed across 12 Anvil suites |
| New funded tests | Expanded v5 labels, native/lifecycle, EVM, SOL and SPL cases pass across selected runs; [new report](research/extended-v5-e2e-2026-10-07/README.md) records individual runs and the gas-default issue |
| Build/typechecks | Build and lib/spec/local/AGW-E2E checks pass |
| Consumer checks | Package imports, compiled declarations, API comparison and guide examples pass |
| E2E selection | AGW: 58 scenarios/14 files/58 tests; default all remains 76/40/81 |

These are selected live runs. Latest expansion verified 20 distinct labels/EVM/multi-asset/SOL/SPL scenarios across selected runs; earlier v5 native/lifecycle evidence adds ten distinct cases. This is not a full 58-case invocation. Older v4 evidence includes 39 prior cases plus seven additions. See the linked report for the initial 7702 gas failure and verified fix, public API changes, IDL-layout limits and test evidence.

## Per-step matrix

| Step | Deliverable | Current status | Remaining work |
| --- | --- | --- | --- |
| 1 | Source/capability contract | V5 deployed source/ABIs pinned and reproduced | Refresh for future releases |
| 2 | Namespace/types/errors | Implemented; AMBIGUOUS_RULE replaces duplicate-authoring rejection | Approved dual input forms; no pending type decision |
| 3 | Signer/wallet context | Owner/agent/read-only/identity guards retained | Release review; UEA identity cases pass |
| 4 | Registry/adapter | Donut v5 registered; unsupported networks fail | Release review; no legacy fallback |
| 5 | Wallet/checkpoint/rule reads | Native and EVM reads implemented; source tokens/beneficiary offsets reconstructed | Stored label reads and owner rename/reset implemented; ref removed |
| 6 | Normalization/codecs | Native/EVM envelope 1, ordered caps, hard-zero/max total, empty-list routing | Confirmed defaults; named-IDL compiler implemented |
| 7 | Create/add/revoke | Index-bound create, partial recovery, atomic writes; same-agent multiples allowed | Release review; deployed create/identity/batching paths verified |
| 8 | Atomic update | Native per-action and universal all-token assertions before revoke/grant | Public native/EVM/SVM lifecycle implemented |
| 9 | Owner/allowance | Owner path unrestricted; explicit separate allowance retained | Release review; production allowance/token debit and delivery verified |
| 10 | Native agent sends | Sender-preserving atomic batches retained | Existing ambiguity guard retained; contract validation/error mapping verified |
| 11 | EVM outbound | V5 asset membership, maxGasPerCall, wallet CEA/refunds, signer gas and responses | Release review; Sepolia success/failure and UEA cases verified |
| 12 | SVM destinations | Public named-IDL lifecycle, send and replay implemented; four new public cases pass live | Maintain documented supported-layout limits; prior failure retry timing remains operational follow-up |
| 13 | Responses/progress/errors | V5 ABIs and prior canonical replay/wait fixes retained | Delayed-index replay/polling tested with real contracts/receipts; no remaining SDK-owned response gap |
| 14 | E2E | 48 opt-in scenarios registered; selected coverage includes public owner transfers and mapped simulation errors | Selected native/EVM/SVM acceptance complete |
| 15 | Web2 | Prior implementation retained and included in full unit run | Consumer migration notes supplied; existing Web2 unit acceptance passes |
| 16 | compileCard | Outside standalone AGW; absent public export | Future marketplace scope |
| 17 | Documentation/release | Current status/gaps/handoff updated | Label delivery and release review |

## Remaining dependencies

Product choices are settled. Rule ref is removed; zero native PC defaults and the current token model are retained; dual native/EVM raw/index inputs are approved; named IDL Solana authoring is implemented. Contract validation is authoritative; AMBIGUOUS_RULE remains the SDK response to multiple candidates. No selection interface change is required.

Freshly fetched contracts already validate explicit rulesIds and reject unauthorized actions. V5 supplies stored labels and setLabel, now enabled by the SDK. [Contract delivery items](questions-zaryab.md). `creditRevert` remains a separate Push-core executor dependency; ordinary returned funds do not lower policy spend.

Latest coverage expansion: five additional registered E2Es, wallet-isolation and UEA intermediate-read assertions, live independent token budgets and SPL recipient credit. The source-mint resolver fix adds four regression units; no caller-facing API changed. [Evidence and gas-default follow-up](research/extended-v5-e2e-2026-10-07/README.md).
