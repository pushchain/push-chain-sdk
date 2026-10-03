# AGW SDK design review

The proposed design adds AGW management and execution to `@pushchain/core` through the API in [page 5](notion/5-sdk-agw.md). It keeps the existing signer and transaction machinery, while introducing a separate wallet execution context. The public API is the agreed target; this review proposes internal boundaries and identifies the evidence needed to implement them correctly.

Review status: proposed architecture, pending [gap resolutions](gaps.md) and matching multi-asset artifacts/deployment. This document does not claim that the new contract methods are deployed.

## Core design

There are two accounts to keep separate. The connected signer's Push identity is the native EOA or the external key's UEA. The execution account is normally that identity, but becomes the AGW when `agenticWallet` is supplied. The signer authorizes the transaction and pays its Push execution gas; the AGW owns its assets and pays wallet outbound fees.

`client.agentic.wallet(address)` is a management handle. It reads and manages that wallet through the connected signer. It never becomes a sender. `PushChain.initialize(signer, { agenticWallet })` creates a client that executes through the wallet. The owner goes through `execute`; an agent goes through `executeAsAgent` under on-chain rules.

`agentic.derive`, `agentic.list` and wallet creation must use the connected signer's Push identity even when `universal.account` exposes an AGW. Deriving a new owner wallet from the displayed execution account would create the wrong ownership model.

## Suggested internal modules

Names in this table describe proposed modules, not files that already exist.

| Module | Responsibility | Boundary |
| --- | --- | --- |
| Agentic namespace | `derive`, `create`, `list`, `wallet` and owner-scoped coordination | Uses connected signer identity and network configuration |
| Wallet management | Info, owner, label, checkpoints and rules lifecycle | Reads arbitrary wallets; writes require owner authorization |
| Contract adapter | Factory, wallet, policy and engine ABIs, capabilities, views and log decoding | Contains version-sensitive contract surface |
| Rules codec | Selectors, terms, envelope, IDs, beneficiary offsets and decode | Pure operations where all required context is supplied; verified against contract vectors |
| Execution context | Wallet address, connected Push identity, origin and selected door | Preserves identity separation; rechecks authorization as required |
| Wallet transaction composer | ERC-7579 calls and wallet-originated gateway requests | Does not route outbound through the signer's CEA |
| Response adapter | AGW `from`, signer `origin`, destination hashes, progress and errors | Reuses core receipt tracking with explicit AGW context |
| Read reconstruction | Factory slots, labels, rules, references, spend and checkpoints | Uses defined views or bounded event reconstruction |

Extend `PushChain` initialization and namespace wiring in `packages/core/src/lib/push-chain/push-chain.ts`. Integrate transaction composition and tracking with the orchestrator modules under packages/core/src/lib/orchestrator. Centralize contract version handling rather than distributing ABI checks across public methods.

## Creation path

1. Resolve the connected signer's Push identity and target network.
2. Derive the wallet and index through the factory; verify any pure mirror against contract vectors.
3. Validate structural inputs, agent ownership restrictions, unique agent-chain pairs, destination-chain assets, targets and encoding context before requesting signatures. Resolve each assets[].token to its Push PRC20 using trusted chain context.
4. Compose deployment and rule grants only. Updated CreateOptions has no funds or pc inputs. Funding and bounded owner gateway approvals are a separate normal-account operation; they must not be silently performed by create.
5. Select a supported creation strategy. Current native batching can be atomic through EIP-7702 or sequential through core's fallback; expose the actual strategy and any partial failure.
6. Resolve assigned rule IDs from matched contract behavior and receipt events, preserving input order. Return the specified wallet, index, rules IDs and transaction response.

Concurrent creations and grants can invalidate a predicted index or grant nonce. Define simulation, re-read and retry behavior without signing or returning stale IDs. The factory's proposed batch entry is missing from the reviewed change-set diff (G15).

## Management writes

Rule updates follow the specified assert-spend, revoke, grant order. The replacement creates a new ID and resets counters. All pairs must use an atomic path; a sequential core fallback cannot satisfy that guarantee. Missing atomic capability should be an explicit failure until an accepted alternative is defined (G14).

Revocation accepts explicit IDs or `{ all: true }`. Bare revocation fails with `REVOKE_NEEDS_TARGET`. Keep spend reads and existence checks consistent with policy initialization flags so an unknown configuration is not decoded as an active zero-valued rule.

Label changes remain a proposed cosmetic feature. Current e704d5b records one checkpoint before each owner call, plus one per successful grant/revoked ID; owner replacement batches therefore add five. Compare evaluator baseline counts rather than only blocks. This accounting does not observe allowance pulls that require no wallet call. Define reads and log reconstruction with the matching contract events before implementing `info`, `list` and `checkpoints` (G08).

## Sending through the wallet

1. Reject forbidden operations and any `from` before signing.
2. Resolve the destination chain from the transaction, normalizing a Push destination to the connected Push network.
3. On the owner door, compose `execute`; on the agent door, fetch the matching enabled rule for this signer and destination on every send.
4. If no rule exists, throw `NO_RULES_FOR_CHAIN` before requesting a signature. The SDK does not reproduce URP's authorization policy in the send path.
5. Compose native calls or policy-compatible outbound calls executed from the AGW. Owner gateway approvals are separate setup operations; do not inject unrestricted approvals into the agent path. The destination account is the AGW's CEA, derived from the AGW address.
6. Apply signer gas checks with the specified first-use external UEA exception. Keep wallet outbound PC separate from signer gas.
7. Send through the existing signer transport. Decode wallet and policy errors into `AgenticRevertError`, retaining core's structured error information.
8. Return a response with AGW `from` and signer `origin`. Track the destination leg and propagate per-call hooks into `wait()`.

Do not pass an AGW outbound directly into the current signer-based Route 2 implementation: it composes calls from the signer's UEA and would derive the wrong destination CEA. Reuse encoding and tracking primitives with an explicit wallet context instead.

## Identity and authorization invariants

- A native Push agent is its EOA; an external agent is its UEA for the actual origin chain. The same external EVM key on different chains has different UEAs.
- Agent authorization checks the connected Push sender. The old session-key validator scheme is historical context, not the new SDK API.
- Owner management and owner execution remain distinct. An owner can manage the wallet from an ordinary client and execute as it from an agentic client.
- Revocation takes effect for future Push execution; an outbound already dispatched can still finish on its destination.
- The gas payer, wallet asset owner and destination CEA must stay consistent in payloads, receipts, tracking and progress events.

## Compatibility and capability handling

Preserve existing clients that initialize without `agenticWallet`. Use the lifecycle choices in the [SDK owned review](sdk-owned-review.md): explicit wallet selection on each `reinitialize`, fresh role/capability checks, and read-only write guards (G17). Do not accidentally let a read-only identity reach a signing path.

Add `READ.CHAIN` as required by the spec. Normalize the existing `'web2:https'` input during the compatibility window while exposing the new `'web2'` constant (G16). Review the existing `READ.WEB2` alias as part of that migration.

Capabilities depend on the selected contract deployment: sender-gated execution, label mutation, checkpoints, batch creation, gateway layout and SVM destination rulebook. Missing deployment support should be explicit before signing. Do not substitute a legacy contract call merely because its name resembles the required operation.

## Optional marketplace and job integration

`utils.agentic.compileCard` produces `Rule[]`, but the canonical card encoding and shared SDK/hook compiler need agreed vectors (G09). A multi-chain card can create several rule IDs while the job hook currently binds one; define that mapping before integrating `market.start` (G10).

The job provider is the same Push identity named in the rules. The hook must enforce provider identity, expiry and execution chain. START reads establish the baseline; any owner-side checkpoint after that baseline causes settlement in the provider's favor under the design. These responsibilities belong to the hook and evaluator, while the AGW supplies trustworthy identities and checkpoints.

Standalone AGW can be reviewed and delivered independently. Full marketplace/job/evaluation readiness depends on their WIP implementations.

## Review and verification checklist

- [ ] Exact matched artifacts identified; all G01–G24 entries have a disposition.
- [ ] Rule and wallet derivation match contract-generated vectors, including nonce and index races.
- [ ] Owner, agent, unknown sender, revoked rule and expired rule behavior is covered.
- [ ] Native and external signers retain their correct account and gas identity.
- [ ] Atomic replacement cannot use sequential fallback.
- [ ] Native and cross-chain receipts show the intended SDK fields and track the AGW's destination account.
- [ ] Create, update and revoke events return correctly ordered IDs and checkpoint records.
- [ ] Init-time and per-call hooks remain additive through send and wait; errors retain decoded data.
- [ ] Existing initialization, read-only mode, Web2 reads and regular routes remain compatible.
- [ ] Solana-origin support is verified separately from Solana destination capability.
- [ ] Selected deployment passes contract tests and authorized SDK end-to-end coverage.

## Current integration requirements

Use owner wallet batching for atomic updates. Stored checkpoints are implemented at e704d5b; grant job refs, label mutation and envelope version remain pending. Universal assets[]/maxGasPerCall require a new matched wire ABI. Public Spent remains scalar in the new snapshot; agree per-token returns and expected-total assertions. Empty-assets routing and native-marker resolution need fixtures.

Derive expectedCEA from AGW and destination context, commit it in universal terms, expose it in previews and monitor drift. Apply all [integrator obligations](contract-integrator-obligations.md). [Validation evidence](research/validation-e704d5b/README.md) verifies the pinned single-asset source; it does not establish multi-asset or live deployment support.

Implementation details settled by local review are recorded in the [SDK owned review](sdk-owned-review.md). Existing machinery passed 183 unit tests; new AGW behavior still requires implementation-specific coverage. Include transaction-creating universal reads in the execution-context audit, while keeping management reads non-signing.

Follow-up: keep NativeRule single-action as specified; reject ambiguous enabled-rule candidates with DUPLICATE_RULE and a hint. Bounded gateway approvals use the existing owner execute path, demonstrated by four local pull/burn-fixture tests. Remaining external decisions are in [external blockers](external-blockers.md).
