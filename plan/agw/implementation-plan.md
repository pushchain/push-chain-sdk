# AGW SDK implementation plan

Target: [SDK spec](notion/5-sdk-agw.md), October 3 export. Source/test baseline: [e704d5b](current-baseline.md). Current gaps and questions are in [gaps.md](gaps.md), [Harsh draft](questions-harsh.md) and [Zaryab draft](questions-zaryab.md). No production implementation is included.

## Phase 0 Agree the integration contract

Completed: source access, sender-adapter review, checkpoint/source-invariant review, local builds/tests, atomic replacement experiments and latest Notion import.

Remaining: approval safety, native action/array scope, defaults, per-asset Spent and assertion semantics, multi-asset fixtures, labels/ref/versioned envelope, empty-assets routing and compatible deployment generation. Keep standalone AGW and downstream marketplace/job/evaluator requirements distinct.

Exit: critical authorization, encoding, accounting and atomicity behavior has recorded decisions and exact artifacts. Source implementations are distinguished from live capabilities.

## Phase 1 Public surface and structure

Add types, namespace, wallet handle, errors, progress, exports and initialize options. Preserve existing defaults, read-only mode and reinitialize behavior. Introduce internal contract/read/execution adapters.

Verify public usage, signer versus wallet identity, forbidden operations and ordinary-client compatibility.

## Phase 2 Encoding and management

Implement selectors, safe ABI positions, chain/token/native-marker resolution, expectedCEA derivation, codecs, IDs and wallet prediction against matching vectors. Add derive/list/create, summaries, checkpoints, labels and lifecycle operations.

create deploys/grants only. Funding and owner approvals are separate. Replacement uses one owner wallet assert/revoke/grant batch; never a sequential fallback.

Verify ID ordering, unknown/revoked states, duplicate candidates, nonce/index races, per-asset caps, zero/unlimited conventions and assertion rollback. Snapshot checkpoint counts and account for five ticks in a replacement batch. AGENTIC-TX-103 is absent from creation.

## Phase 3 Wallet execution

Implement role checks, uncached rule lookup and owner/agent wrappers. Keep signer transport/gas separate from AGW assets/outbound PC. Build a dedicated composer satisfying URP; do not reuse signer-based Route 2 unchanged.

Verify unauthorized/revoked/expired cases, rejected from, forbidden methods, deployment/gas exceptions, native arrays, allowance prerequisites, zero-amount calls, beneficiary fixtures and rollback.

## Phase 4 Responses and compatibility

Map logical from to AGW and preserve signer origin. Reuse hash/UTX tracking provisionally and verify wrapped execution. Preserve hooks through send/wait and structured errors. Add READ.CHAIN and legacy Web2 normalization.

Run relevant route, gas, response, read and compatibility checks. Do not silently change failure timing through expiry filtering.

## Phase 5 Matched deployment validation

Verify source/build revisions, generation identity, proxy/implementation addresses, start blocks and capabilities. With separately authorized funding and transactions, test native and external owners/agents.

The first positive-amount EVM agent outbound should prove allowance, real burn, empty recipient, AGW refund recipient, policy-compliant multicall, node/TSS acceptance, settlement and tracking. Enable SVM destination work with obligations 19–23 and agreed fixtures.

## Phase 6 Optional ecosystem integration

Align canonical cards, multi-rule binding, marketplace expiry equality, payment-token scope, evaluator gating and checkpoint verdicts. The partial hook alone does not establish complete job lifecycle behavior.

Exit: supported capabilities documented, relevant tests pass and remaining gaps have explicit accepted scope. Assign each [integrator obligation](contract-integrator-obligations.md) to SDK, UI or operations.
