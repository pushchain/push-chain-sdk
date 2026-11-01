# SDK owned AGW review

Reviewed October 3, 2026 before sharing team questions. Several integration choices can be settled locally. Their design is recorded below; production SDK implementation and AGW acceptance testing are still outstanding. None of the affected gaps is closed merely because an existing unit test passes.

Evidence baseline: SDK parent `167fdc6243ecfe5d97735a6124662c7d2084d126`, planning branch `46f9e669d001624cb8b7a594bfed3a9aafb139f1`, October 3 Notion snapshots, and AGW source `e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9`. Contract reads used `git show e704d5b:...`: the sibling checkout is on September main (`9ddd954`), not the reviewed branch. No remote fetch or Notion refresh was performed in this pass.

## Disposition

| Gaps | What we can settle ourselves | What remains external |
| --- | --- | --- |
| G03 | Wallet-scoped records and receipt-derived rule IDs | Public helper signature/constants and matching generation context |
| G08 | Checkpoint event reads, count snapshots and current-label event reconstruction | Editable labels/ref ABI, deployment and historical-rule scope |
| G13, G15 | Capability-based creation, committed/pending hashes and partial-failure recovery | No required new factory batch method; exact final artifacts still needed |
| G14 | One owner-wallet transaction for replacement; never sequential fallback | Multi-asset spend/assertion ABI and final-generation regression tests |
| G16 | Public Web2 normalization with unchanged wire identity | Implementation and compatibility checks; no contract change required |
| G17 | Read-only boundaries and explicit wallet selection on reinitialize | Implementation and mocked lifecycle tests |
| G18 | Enabled-rule eligibility, uncached send lookup and on-chain expiry enforcement | Public duplicate ambiguity wording remains part of H4 |
| G19, G22, G23 | ABI-aware encoding, trusted token/CEA context and generation guards | Approval policy, defaults, multi-asset fixtures and SVM capabilities |
| G20 | Dedicated AGW composition, separate identity/gas contexts, response/error/hook adaptation | Live production gateway/node/settlement acceptance; owner allowance mechanism now locally demonstrated |

G01/G02 deployment, G04 gateway release intent, G05/G09–G12 ecosystem alignment and G07 executor work cannot be closed through SDK code review. G06 binder was already resolved as dropped. G21 native action/array scope and G24 multi-asset spend semantics remain team decisions.

## Internal decisions for implementation

### Account context

Keep connected signer identity, execution wallet and origin as separate values. Derive/list/create owner wallets from the signer identity, never the displayed AGW account. Account status and Push gas checks remain signer-scoped; wallet assets and outbound PC remain AGW-scoped.

Current `push-chain.ts:297–310` exposes `origin` from `getUOA()` and `account` from `computeUEAOffchain()`. Add an explicit execution context rather than replacing signer derivation throughout the orchestrator. Do not reuse `getAccountStatus` as a wallet capability check.

### Read only and reinitialization

For new AGW support, choose the wallet explicitly on each `reinitialize`: an omitted `agenticWallet` produces an ordinary client. An explicit wallet reruns deployment, supported-generation and identity checks, including when the signer or network changes. Do not copy the prior owner/agent role or rule lookup cache. Continue inheriting existing network/RPC/explorer/hook options as today.

An ordinary read-only client may create a management handle for an arbitrary wallet and call its non-signing reads. Its writes fail before signing. If initialized with an AGW execution context, it remains read-only and must never gain execution authority from an address match. Preserve existing non-AGW behavior. These are selected SDK design choices for the new option, not implemented behavior or additional promises in the source spec.

Evidence: `push-chain.ts:701–743` creates a dummy signer that rejects signing in read-only mode; `:816–848` creates a fresh client and inherits existing options. Existing integration-style lifecycle suites are excluded from the unit configuration and were not run. Add mocked lifecycle coverage during implementation.

### Initialization and send eligibility

Owner identity selects the owner door. Otherwise, initialization requires at least one enabled rule naming the connected Push identity. An enabled but expired rule may establish identity; expiry remains an on-chain send check. A revoked rule does not establish eligibility. This avoids silently changing the spec's enabled-rule lookup into an expiry filter.

Each send discovers enabled IDs and resolves agent/destination at a consistent block. Zero matches gives the specified `NO_RULES_FOR_CHAIN`; multiple matches fail before signing rather than choosing an arbitrary rule. Use the existing DUPLICATE_RULE code with a descriptive hint and document its send-path use. Never cache send eligibility at initialization or infer rule enablement from retained URP terms alone.

Pinned engine evidence: `lib/smartsessions/contracts/core/SmartSessionBase.sol:72` enumerates enabled IDs; `:444` tests membership. AGW `src/AGW.sol:935` resolves the agent and `:756–765` removes the engine session on revoke. Enumeration followed by dependent configuration reads does not guarantee one RPC round trip. Group reads by block and retry a bounded number of times if consistency cannot be maintained.

### Creation and recovery

Create only deploys/grants. Funding and approvals remain separate. Use the actual signer capability: supported atomic EIP-7702 for native batching, the existing sequential native fallback otherwise, and an external UEA batch where supported. Do not require a new `createWallet` contract entry point.

Preserve atomicity metadata and every confirmed/pending hash on failures. Re-read the factory index and grant nonce before constructing a retry. If deployment succeeded but grants failed, recover that wallet instead of blindly creating another. IDs come from verified receipts in input order; predictions are not authoritative results.

Evidence: `orchestrator/internals/push-chain-tx.ts` and the six native-multicall unit tests cover atomic routing, sequential fallback, committed/pending hashes and receipt failure. This resolves routing uncertainty, not AGW-specific batching, nonce races or recovery correctness.

### Replacement and reads

An existing-wallet update is one owner `execute` batch containing assert-spend, revoke and grant. No native EIP-7702 capability is required for that wallet-level batch. Current replacement records five checkpoints; a failed transaction rolls all of them back. Compare counts, including same-block changes, rather than treating last block as sufficient evidence.

Use factory count/prediction views for deployed-wallet enumeration. Include the next predicted undeployed slot shown in the SDK example with `deployed: false` and zero rules, alongside deployed slots; never predict indices beyond the factory's next index. This is the planned interpretation of the public example, not an implemented read. At e704d5b, labels are deployment-event metadata, not stored mutable state. Decode events from the selected factory start block with pagination and reorg handling. Revoked history and new label/ref storage remain external dependencies.

Evidence: AGWFactory `src/AGWFactory.sol:254–273` permits prediction only through the next index and defines count as deployed wallets. `:133` says labels are emitted and never stored. Current checkpoint and replacement evidence remains in [validation](research/validation-e704d5b/README.md).

### Web2 public input and wire identity

Add the specified enumerable `READ.CHAIN` with public `WEB2 = 'web2'`. Normalize both `'web2'` and legacy `'web2:https'` to the existing internal destination `{ chainNamespace: 'web2', chainId: 'https' }`. Keep the wire CAIP-2 `web2:https`; changing the public spelling does not authorize changing the node routing identity. Follow the specified deprecated `CHAIN.WEB2` alias and preserve compatibility for the existing `READ.WEB2` surface and old literal inputs.

Cover public constants, types, query discrimination, prepared reads, tracking/decoded results and transaction rejection. Do not just rename the enum: `read-state/read-params.ts:198` recognizes only the current alias, and `read-state/destination.ts:18` rejects a joined destination without `:`. Existing tests verify the old spelling, not the new one.

### Composer, responses and errors

For pinned EVM universal rules, compose a wallet-originated outbound with empty bytes recipient, AGW revert recipient, a nonzero gas cap and policy-compatible destination multicall. Derive `expectedCEA` from the wallet plus trusted destination deployment. Never insert an unrestricted approval into an agent transaction. The new assets format still needs agreed fixtures before this becomes the final composer.

Current Route 2 derives CEA from the signer (`route-handlers.ts:666,763`), uses the CEA as recipient for a payload and uses signer UEA for refunds (`:826–854`). It cannot be reused unchanged. `cea-utils.ts:109–120` already queries `getCEAForPushAccount(address)`; adapt with explicit AGW and network/factory context. Its current address cache does not include factory identity, so generation-aware caching requires review.

Preserve logical AGW `from` on both send response and waited receipt; preserve signer `origin`, hashes and raw transport metadata. Management transaction responses retain their specified owner `from`. Hash/event tracking is reusable infrastructure: `outbound-tracker.ts:17–24` hashes network plus Push transaction hash. It does not establish that an AGW-wrapped transaction is reconstructed correctly.

The current response builder derives signer/UEA identity (`response-builder.ts:645,740,859`) and reconstructs known UEA calls (`:655–682`). Add explicit wallet decoding/context for live sends and replayed tracking; do not overwrite only the first response. Carry init and per-call hooks through `wait` without duplication.

Extend the existing structured `PushChainExecutionError` with the specified AGW error. Preserve `gatewayTxHash`, `decodedError` and partial-batch recovery metadata where relevant. Export the base error publicly if callers are expected to use it: it currently exists internally (`internals/errors.ts:40`) but is absent from `packages/core/src/lib/index.ts`. Default decoders also need the matching AGW/URP error ABIs.

### Transaction creating reads

`universal.read()` and `executeReads()` submit request transactions; they are not ordinary RPC reads. Route them through the same wallet execution/authorization layer and audit read budget, refund and balance context. `prepareRead` and tracking must remain non-signing. Management `info`, `rules.get/list` and checkpoint reads are separate RPC/log operations.

Evidence: `push-chain.ts:346–363` invokes read execution; `read-state/read-executor.ts:84` calls the transaction executor; `orchestrator/internals/read-state.ts:23–28` currently derives the default refund from the signer. Neither the balance nor refund context should be changed by globally replacing the signer with the AGW. Native agent batch-read behavior depends on H2; do not silently bypass its single-call restriction.

## Validation and limits

Ten existing mock-based unit suites passed: **183 tests, zero failures**. The first group covers native batching, tracking helpers, per-call hooks, structured errors, public read exports and read grammar (126 tests). The second covers gateway/account/CEA helpers, failed Push response handling, tracking guards and outbound confirmation gates (57 tests).

Commands and suite counts are in [test summary](research/sdk-owned-review-2026-10-03/test-summary.json); [first run](research/sdk-owned-review-2026-10-03/jest.log) and [response run](research/sdk-owned-review-2026-10-03/response.log) retain runner output. No production file changed, no new SDK implementation was tested, no contract suite was rerun and no transaction was broadcast. These results are evidence for existing behavior, not a complete audit or future AGW acceptance.

## What still belongs in the team questions

Keep H1 approval safety, H2 native-array scope, H3 defaults, and H4 helper context/history/per-token spend. Keep Z1 matching artifacts and Z3 compatible deployment. Z2 allowance setup is resolved locally; Z4 is a release note covered by generation compatibility. See the [external blocker register](external-blockers.md). Creation routing and partial failure, read-only/reinitialize semantics, response adaptation, Web2 normalization and checkpoint reconstruction are SDK tasks; do not ask the teams to design these internals.

Independent module work can begin from the recorded choices; finalize affected types/codecs after the matching contract/API decisions are available, with targeted tests for the new behavior. Refresh sources again before sharing the drafts. Implementation is still a separate phase.

## Follow-up closure

Four new [allowance experiments](research/sdk-owned-review-2026-10-03/README.md) demonstrate bounded owner setup/removal and atomic failure behavior with a pulling/burning fixture. No new AGW allowance API is needed. Destination approval can use the existing owner execution client; only the agent approval policy needs a product decision. Keep NativeRule single-action as specified; ask only about native arrays. Remote AGW/core/gateway refs were rechecked unchanged; Notion was not refreshed. The remaining standalone external areas are enumerated in [external blockers](external-blockers.md).
