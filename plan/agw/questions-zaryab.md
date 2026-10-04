# AGW SDK open contract requests for Zaryab

We need the artifacts and compatibility details below to finish the AGW SDK against the intended contract generation. Please reply by item ID with the source/ABI/vector link when available, or the remaining work and expected delivery. Product choices that affect these requests are linked to Harsh's document.

**Status:** updated October 4 after [Harsh’s replies](product-decisions-2026-10-04.md). Only Z1/Z3 remain for standalone AGW. Public multi-asset spend, revoked history and compileCard are no longer requested as standalone v1 features; internal accounting still matters.

| Item | Requested deliverable | What it enables |
| --- | --- | --- |
| [Z1](#z1) | Matching terms, accounting/assertion ABI and metadata surface | Final rule encoding, reads and safe replacement |
| [Z3](#z3) | Verified deployment and capability manifest | Generation onboarding and live acceptance |

## Source baseline

- **Target:** [saved contract change set](notion/1-agw-contract-changes.md), especially section 4c; [live Notion page](https://app.notion.com/p/pushprotocol/1-AGW-Contract-Changes-nomenclature-standard-change-set-3e9188aea7f4813aa31fc95ceb4e684d).
- **SDK:** [saved page 5](notion/5-sdk-agw.md); [live Notion page](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9). Both snapshots were exported October 3, 2026 at 13:23 IST; later page edits are not covered.
- **Reviewed code:** [AGW e704d5b](https://github.com/pushchain/push-agentic-wallets/blob/e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9/src/AGW.sol), core `cb69e0b`, gateway `bcbf7df`. Remote refs were rechecked October 3 and were unchanged. This does not verify a new live deployment. [Full source inventory](SOURCES.md).

<a id="z1"></a>

## Z1 Source and ABI for the target generation

<a id="z1-1"></a>

### Z1.1 Universal rule encoding

**Current mismatch.** The proposal introduces multi-asset rules; tested `e704d5b` still has single-asset terms. The SDK needs an exact supported encoding before it can finalize the codec.

**Please provide the implementation revision, ABI and vectors covering:**

| Area | Detail needed |
| --- | --- |
| Assets and counters | `assets[]`, per-token counters, duplicate assets and zero/unlimited conventions |
| Call-only rules | Routing and token fields when `assets[]` is empty and no tokens move |
| Gas cap | Final `maxGasPerCall` field/layout |
| Destination account | EVM `expectedCEA` type/width and encoding |
| Envelope | Version field, accepted version and body layout |

If the code is still pending, please identify the agreed target definitions and remaining implementation work. A proposal alone cannot establish the final wire ABI.

**Evidence:** [proposed section 4c](notion/1-agw-contract-changes.md); [pinned UniversalTerms](https://github.com/pushchain/push-agentic-wallets/blob/e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9/src/libraries/Types.sol#L217).

<a id="z1-2"></a>

### Z1.2 Per-token reads and safe replacement

**Issue.** Replacement must reject a stale spend snapshot. An `assertSpent` function that only returns current totals does not protect a later revoke/grant from an agent spending after the SDK prepared the transaction.

**Requested behavior:** compare caller-supplied expected totals for all old-rule assets and revert if any differs, inside the same owner transaction as revoke and grant.

**Please provide:**

- Per-token spend-read and expected-spend assertion signatures.
- Token ordering/completeness rules for the expected snapshot.
- A vector/test where intervening spend makes the entire replacement revert.

The SDK will implement the wrapper and atomic batch. Harsh has said per-token spend need not be public, but the SDK still needs these internal reads and assertions for safe replacement. Please align omitted/explicit-zero wire semantics with the final H3 defaults.

**Evidence:** [current expected-spend assertion](https://github.com/pushchain/push-agentic-wallets/blob/e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9/src/policies/UniversalRulesPolicy.sol#L1409); [proposed assertion change, section 4c](notion/1-agw-contract-changes.md).

<a id="z1-3"></a>

### Z1.3 References, labels and historical metadata

**Please confirm the selected generation's surface:**

| Feature | Open detail |
| --- | --- |
| Grant reference | `ref` parameter/event shape; include it in the owner signature digest when a signed grant is used |
| Editable labels | Whether proposed `setLabel`/label storage ships with this generation, with its ABI/event behavior |

Harsh deferred revoked-rule history for v1; no additional historical metadata is requested solely for that feature. Please distinguish committed ref/label features from proposals.

**Evidence:** [target SDK lifecycle](notion/5-sdk-agw.md); [pinned grant signatures](https://github.com/pushchain/push-agentic-wallets/blob/e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9/src/AGW.sol#L483); [pinned grant event emission](https://github.com/pushchain/push-agentic-wallets/blob/e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9/src/AGW.sol#L636).

<a id="z3"></a>

## Z3 Deployment and capability manifest

**Please provide the following for the selected release deployment:**

| Manifest field | Required information |
| --- | --- |
| Network and addresses | Factory, wallet implementation, validator, engine and policy addresses |
| Source and ABI | Exact revisions/build artifacts, proxy implementations where applicable and wiring |
| Start blocks | Deployment/event start blocks for bounded discovery and reconstruction |
| Reused components | Whether engine/policy instances are shared with previous generations and their compatibility |
| Gateway | Matched gateway implementation/request ABI and any planned coordinated migration |
| Destination support | Supported EVM/SVM capabilities; matching SVM terms/payload fixtures if enabled |

Existing wallet clones cannot acquire the target wallet ABI. We will use the manifest to build a generation registry, verify deployed wiring and run live acceptance. These addresses must correspond to the intended release generation.

**If deployment is pending:** provide the intended feature scope and remaining delivery work. Clarification settles the plan; live acceptance remains pending until deployment exists.

Harsh referred SVM work to you. Please include its supported input constraints and matching artifacts when ready. [Historical Donut addresses](notion/agw-address-book-donut-2026-09-04.md) are retained as historical evidence, not assumed to support this target.

## Supporting documents

[Implementation plan](implementation-plan.md) · [External dependencies](external-blockers.md) · [Current baseline](current-baseline.md) · [Harsh's open decisions](questions-harsh.md)
