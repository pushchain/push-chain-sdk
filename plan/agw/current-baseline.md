# Current validated AGW baseline

Updated October 3, 2026 after reviewing checkpoint commit 6b7dbf4 and current head e704d5b. This page supersedes earlier recommendations; consequential corrections are retained in the [review summary](review-summary.md). The SDK Notion page remains the target API; conflicts below are recorded for resolution, not silently resolved in favor of code.

## Pinned sources

| Repository | Current inspected branch and commit |
| --- | --- |
| AGW | `pushAgenticWallet_v3@e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9` |
| Core | `universalMarketplace_v1@cb69e0ba101bef1bb4440e54b2c45396be3e92ce` |
| Gateway | Eight-field `pc20-3rd-iteration@bcbf7df42e8e6dd11088a43bcc0b056a54ea0a18`; six-field older `main@d02070d` |
| SDK | `167fdc6243ecfe5d97735a6124662c7d2084d126` |
| Notion | October 03, 2026 at 13:23 IST full export; page 1 and page 5 changed, 10 pages unchanged |

AGW remote branches were checked through GitHub API on October 3: nomenclature-changes was deleted after merging and pushAgenticWallet_v3 points to e704d5b. Core remains pinned at cb69e0b from the existing evidence; no fresh core fetch was performed in this pass. The head adapter keeps the SmartSession source unchanged. It replaces cryptographic session-key validation with a sender-checking adapter. The wallet binds the sender before calling the engine and constructs `USE || rulesId || msg.sender` itself. Engine account binding and disabled alternate paths are essential invariants. **No engine fork is recommended.**

## Compatibility status

| Surface | Current status | Remaining work |
| --- | --- | --- |
| `executeAsAgent`, `agentOf`, authorization event | Implemented in AGW source | Verify selected new deployment and preserve adapter invariants; G02 source dependency satisfied |
| Agent config | Exact `abi.encode(address agent)` | SDK codec and generation-specific validator context |
| Rule ID | `keccak256(abi.encode(validator, abi.encode(agent), bytes32(grantNonce)))` | Page 5 helper signature/constants need alignment. Chain is not hashed; key records by wallet plus rule ID |
| Owner batching | Documented design; local tests support atomic replacement | SDK implementation and final-generation regression tests; no need to ask whether batching is intended |
| Agent arrays | Wallet dispatch remains single/default. EVM destination multicall supports 1–10 calls | Define native arrays separately; supporting multiple native actions in a rule is a public type choice, not the same as atomic multi-call dispatch |
| Duplicate agent-chain rules | Accepted by contract with independent IDs/budgets | SDK preflight rejection and explicit ambiguity error are proposed; hard on-chain uniqueness is not assumed necessary |
| Checkpoints | Implemented in source at 6b7dbf4, included in e704d5b; count and last-block views plus Checkpointed event | Compare snapshot counts, account for per-call and lifecycle ticks, and verify selected new deployment |
| Grant job ref, labels, envelope version | Still absent | Agree next-generation surface and spec consequences |
| Historical rules | Revoke removes agent config and enabled actions, while URP terms persist | Event agent attribution or nested-call reconstruction needed if revoked rules are returned |
| expectedCEA | Required universal wire term, derived from AGW plus destination context and committed at grant | SDK must derive it, show it in previews, include it in encodeRules context, and monitor derivation drift |
| Binder | Never present in reviewed code; live Notion page checked October 3 says dropped for v1 | No binder/setBinder implementation required unless a new explicit product decision reverses this |
| Funding approval | Push gateway requires allowance for PRC20 pulls | Explicit owner setup approval, bounded recovery/update semantics, real pulling/burning test |
| Destination approvals | Page 5 example permits an unpinned spender; current marketplace rejects approve/increaseAllowance | Product policy and owner-controlled approvals; selector filtering alone is not a general guarantee against malicious/custom approval methods |
| Gateway shape | Eight fields in current branch and observed live dispatcher; main's six fields are older | Ask only whether a future removal is actually planned |
| Agent outbound composer | Existing Route 2 request cannot be used unchanged | Empty recipient, AGW revert recipient, nonzero maxPCForGas, policy-compatible multicall and AGW PC accounting |
| Outbound tracking | Existing tracker uses tx hash/events/UTX ID | Reuse provisionally; verify live wrapped outbound. Response `from` and progress route integration still need adaptation |
| Marketplace expiry | Core terms require exact equality with job expiry | Reconcile Notion's <= and >= statements; equality applies to this marketplace compile path, not every standalone AGW rule |
| SVM destination | Source and policy tests available | Typed SDK representation, obligations 19–23, deployment capability; do not claim an agreed deferral |
| Generation detection | Wallet clones immutable; factory implementation frozen by intended design | New generation/address context, supported factory registry, version identification and migration disclosures |

## Chain observations

Historical read-only probes on October 2 at Donut block **23818643** confirmed the documented factory still points to `0xD7FEF338572f96edBeF89E720f1F0fF1284ec79C`, that implementation reports `push.agentwallet.1.0.0`, and the documented URP reports `1.0.0`. Gateway implementation `0x1e412939780f2b834dc42c7ac58d9f99888da659` contains the eight-field PUSH4 selector and not the six-field selector. See [probe](research/donut-probe-2026-10-02.json).

These observations validate the named historical deployment, not a global claim that nobody has deployed head elsewhere. No matching new-generation deployment manifest is available. A PUSH4 scan supports dispatch identification but is not complete ABI verification.

## SDK-owned decisions

Implement existing namespace structure, signer reuse, receipt identity adaptation, typed failure metadata, Web2 compatibility, generation guards and internal read reconstruction in the SDK. Document the chosen list/read-only/reinitialize behavior in an SDK decision record. Product consultation is needed only when that choice changes an explicit public promise or introduces a new public parameter.

Do not silently change per-send lookup to filter expired rules: page 5 says lookup selects enabled agent/chain rules and leaves policy checks on-chain. Any expiry precheck is a behavior change to document. A JSON-RPC batch is not necessarily one logical read: IDs must be enumerated before their agent/config reads can be constructed. Avoid promising a single round trip without an index or contract view.

Retries for stale spend must be bounded and must not repeat wallet signatures without user-visible control. Revoking first is an available alternative with different atomicity and permission-interruption semantics, not a transparent retry.

## Next live acceptance test

After a compatible deployment and authorized test funding are available, send a positive-amount EVM agent outbound with owner-established gateway allowance, empty recipient, AGW refund recipient and a policy-compliant multicall. Verify real burn, node/TSS handling, destination execution, receipt identity and unchanged hash-based tracking. No such transaction has been broadcast by this review.

## Checkpoint revision and current source freshness

The no-persistent-storage invariant was deliberately revised: owner execution may touch the single packed checkpoint slot, while remaining independent of engine/policy health. `check-execute` now pins the B2 checkpoint revision. A grant starts one tick; every owner call ticks before dispatch; each revoked ID ticks once; successful grants tick once. `executeWithSig` has the same per-call behavior. Failed transactions unwind the ticks; agent execution does not tick.

For assert/revoke/grant inside one owner batch, the delta is five: OWNER_ACTION(assert), OWNER_ACTION(revoke), RULES_REVOKED, OWNER_ACTION(grant), RULES_GRANTED. Checkpoint ref is a call hash or rulesId; it is not the missing job/card ref parameter on grant.

The new accepted limit 34 states that pre-existing allowances can be pulled without a wallet call/checkpoint. Checkpoints detect owner-door activity, not every possible balance change. The evaluator must define how allowance-driven changes affect its verdict. A baseline count and correct funding-call ordering are required; a sinceBlock filter alone cannot detect all same-block changes.

Fresh Notion page 1 was inspected on October 3 and still says binder was dropped for v1. The complete export succeeded. All 12 saved page bodies now reflect the October 3 export. Pages 1 and 5 changed; see the refresh report. Binder is recorded as dropped in the source index and review summary.

## Latest SDK target after successful refresh

Page 5 is still authoritative: create deploys/grants only, funding is separate, UniversalRule uses assets[] and maxGasPerCall, and AGENTIC-TX-103 is removed. New page 1 section 4c proposes per-token accounting and 0–8 assets. The tested e704d5b ABI does not implement that new wire format; retain its single-asset fixtures as historical baseline, not the future codec.

Define per-asset Spent and replacement assertion semantics, empty-asset routing, destination-token/native-marker resolution and the proposed bytes32 expectedCEA encoding. The prior universal defaults/maxAmountTotal naming cannot simply carry forward. Proposed AssetCap.maxTotal zero means unlimited; native defaults remain a separate question.

See [successful refresh report](research/notion-refresh-2026-10-03.md). All earlier download failures remain historical evidence; download permission was sufficient for this run.
