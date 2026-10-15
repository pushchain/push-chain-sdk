# AGW SDK implementation status

**October 14 — v6 integration complete locally:** source `ffd567d`; v6-only deployment/ABIs, atomic indexed creation, automatic outbound approvals, native/EVM EQ/MAX pins, new unlimited sentinels and linked Solana error decoding are integrated.

- **2,073 unit tests passed**, 12 skipped; **99 local contract tests passed**.
- **69 distinct live scenarios pass across the full run and focused follow-up.** The original run was 67 passed/1 failed (stale allowance assertion), followed by 2/2 passing focused cases, including the new EVM pin alternative proof. Not one clean full invocation.
- Build, lib/spec/local typechecks, guide examples, package imports/declarations and API comparison pass.
- V6 code committed on v4 (`7dca3f2a`) and v5 (`700a52a7`); not pushed yet. Preset catalog/struct-field conventions, the native eight-call ceiling clarification, and downstream revert credit remain separate items.

[Detailed evidence and commands](research/v6-integration-2026-10-14/status.md).

**Current — October 12 sections 6/7:** SDK-only feedback and the preset framework are implemented locally. [Section 6 work list](section6-action-items.md) · [Preset scope/decisions](section7-presets.md) · [Open items](pending-items.md).

- Full unit run: **2,075 passed, 0 failed, 12 skipped**. An earlier 100ms timing-test failure passed both on retry and in this final full run.
- Section-6 real-contract coverage: all 97 cases pass across the suite and focused correction run. Presets add one fixture integration; its complete 11-case multi-asset suite passes.
- Live section-6 coverage: **65/68 passed initially, then all 3 corrected cases passed**. All 68 cases have passing coverage; this is not one clean full invocation. No app-preset live claim is made with an empty approved catalog.
- Build, library/spec/local typechecks, guide examples, compiled package imports/declarations and source-versus-built API comparison pass. New preset code has no lint errors.
- Preset categories are enumerable; production chains remain empty pending catalog approval. Missing preset caps default to zero per the user. Templates omit identity/expiry until supplied. No encoder/ID utilities were re-exposed.
- SDK changes are grouped in commit `6bd8ad50`; planning is tracked separately on v4 and excluded from the v5 sync. New contract feedback remains undeployed; automatic approvals, atomic factory create and general EVM pins remain gated.

The dated entries below describe earlier checkpoints and are superseded where they conflict with the current summary.

**October 12:** ten native multi-action live E2Es passed in one Donut invocation; malformed-action/required-expiry guards and the N + 4 checkpoint description are fixed. [Acceptance and evidence](research/native-multi-action-e2e-2026-10-12/README.md). Work remains local on `feat/agw-sdk-v4`; public multi-action shape still awaits product sign-off.

**Latest v5 integration:** the new factory, source/artifacts, stored label reads and owner-only rename/reset are integrated. [V5 validation](research/v5-implementation-2026-10-07/README.md) distinguishes current tests from earlier v4 evidence.

**Fresh alignment review:** [October 7 source refresh](research/source-refresh-2026-10-07/README.md) confirms stable deployed code and identified SDK follow-ups G27 (policy-preflight/error parity) and G28 (Solana owner funds-only support). Both are now fixed; [follow-up validation](research/sdk-alignment-fixes-2026-10-07/README.md) records contract-derived errors and actual SOL transfer/replay.

> October 7: [decision alignment and acceptance](research/decision-alignment-2026-10-07/README.md). All settled SDK choices are implemented. Editable labels are now delivered and implemented against v5; no standalone contract delivery item remains.

## Validation

| Level | Current evidence |
| --- | --- |
| Unit | 2,034 passed, 0 failed; 12 skipped (includes 20 multi-action native tests) |
| Actual contracts | 97 passed, 0 failed across 13 Anvil suites (includes 7 multi-action native tests) |
| New funded tests | Expanded v5 labels, native/lifecycle, EVM, SOL and SPL cases pass across selected runs; [new report](research/extended-v5-e2e-2026-10-07/README.md) records individual runs and the gas-default issue |
| Build/typechecks | Build and lib/spec/local/AGW-E2E checks pass |
| Consumer checks | Package imports, compiled declarations, API comparison and guide examples pass |
| E2E selection | AGW: 68 scenarios/15 files/68 tests; default all remains 76/40/81 |

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

Open items, owners and the multi-action native rule decision: [pending items](pending-items.md).

Product choices are settled. Rule ref is removed; zero native PC defaults and the current token model are retained; dual native/EVM raw/index inputs are approved; named IDL Solana authoring is implemented. Contract validation is authoritative; AMBIGUOUS_RULE remains the SDK response to multiple candidates. No selection interface change is required.

Freshly fetched contracts already validate explicit rulesIds and reject unauthorized actions. V5 supplies stored labels and setLabel, now enabled by the SDK. [Contract delivery items](questions-zaryab.md). `creditRevert` remains a separate Push-core executor dependency; ordinary returned funds do not lower policy spend.

Latest coverage expansion: five additional registered E2Es, wallet-isolation and UEA intermediate-read assertions, live independent token budgets and SPL recipient credit. The source-mint resolver fix adds four regression units; no caller-facing API changed. [Evidence and gas-default follow-up](research/extended-v5-e2e-2026-10-07/README.md).
