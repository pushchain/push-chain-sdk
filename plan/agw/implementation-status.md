# AGW SDK implementation status

> October 7: [decision alignment and acceptance](research/decision-alignment-2026-10-07/README.md). All settled SDK choices are implemented. The remaining AGW contract delivery item is editable labels.

## Validation

| Level | Current evidence |
| --- | --- |
| Unit | 1,999 passed, 0 failed; 12 skipped |
| Actual contracts | 81 passed, 0 failed across 11 Anvil suites |
| New funded tests | 3 native cases + 4 public Solana cases pass; exact default-policy refusal rerun passes |
| Build/typechecks | Build and lib/spec/local/AGW-E2E checks pass |
| Consumer checks | Package imports, compiled declarations, API comparison and guide examples pass |
| E2E selection | AGW: 46 scenarios/12 files/46 tests; default all remains 76/40/81 |

These are selected live runs: 39 prior cases plus seven additions, not a new single 46-case invocation. See the linked report for the initial 7702 gas failure and verified fix, public API changes, IDL-layout limits and test evidence.

## Per-step matrix

| Step | Deliverable | Current status | Remaining work |
| --- | --- | --- | --- |
| 1 | Source/capability contract | V4 deployed source/ABIs pinned and reproduced | Refresh for future releases |
| 2 | Namespace/types/errors | Implemented; AMBIGUOUS_RULE replaces duplicate-authoring rejection | Approved dual input forms; no pending type decision |
| 3 | Signer/wallet context | Owner/agent/read-only/identity guards retained | Release review; UEA identity cases pass |
| 4 | Registry/adapter | Donut v4 registered; unsupported networks fail | Release review; no legacy fallback |
| 5 | Wallet/checkpoint/rule reads | Native and EVM reads implemented; source tokens/beneficiary offsets reconstructed | Editable labels await contract delivery; ref removed |
| 6 | Normalization/codecs | Native/EVM envelope 1, ordered caps, hard-zero/max total, empty-list routing | Confirmed defaults; named-IDL compiler implemented |
| 7 | Create/add/revoke | Index-bound create, partial recovery, atomic writes; same-agent multiples allowed | Release review; deployed create/identity/batching paths verified |
| 8 | Atomic update | Native per-action and universal all-token assertions before revoke/grant | Public native/EVM/SVM lifecycle implemented |
| 9 | Owner/allowance | Owner path unrestricted; explicit separate allowance retained | Release review; production allowance/token debit and delivery verified |
| 10 | Native agent sends | Sender-preserving atomic batches retained | Existing ambiguity guard retained; contract validation/error mapping verified |
| 11 | EVM outbound | V4 asset membership, maxGasPerCall, wallet CEA/refunds, signer gas and responses | Release review; Sepolia success/failure and UEA cases verified |
| 12 | SVM destinations | Public named-IDL lifecycle, send and replay implemented; four new public cases pass live | Maintain documented supported-layout limits; prior failure retry timing remains operational follow-up |
| 13 | Responses/progress/errors | V4 ABIs and prior canonical replay/wait fixes retained | Delayed-index replay/polling tested with real contracts/receipts; no remaining SDK-owned response gap |
| 14 | E2E | 46 opt-in scenarios registered; all seven new decision-alignment cases pass live | Selected native/EVM/SVM acceptance complete |
| 15 | Web2 | Prior implementation retained and included in full unit run | Consumer migration notes supplied; existing Web2 unit acceptance passes |
| 16 | compileCard | Outside standalone AGW; absent public export | Future marketplace scope |
| 17 | Documentation/release | Current status/gaps/handoff updated | Label delivery and release review |

## Remaining dependencies

Product choices are settled. Rule ref is removed; zero native PC defaults and the current token model are retained; dual native/EVM raw/index inputs are approved; named IDL Solana authoring is implemented. Contract validation is authoritative; AMBIGUOUS_RULE remains the SDK response to multiple candidates. No selection interface change is required.

Freshly fetched contracts already validate explicit rulesIds and reject unauthorized actions. They lack setLabel, which remains gated until its ABI/deployment is verified. [Contract delivery items](questions-zaryab.md). `creditRevert` remains a separate Push-core executor dependency; ordinary returned funds do not lower policy spend.
