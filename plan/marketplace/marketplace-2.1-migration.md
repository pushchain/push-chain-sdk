# Marketplace 2.1 SDK migration — November 1, 2026

Implementation commits: v4 `8bc8f9be`, v5 `ccc5d3dd`. Plan/evidence stays onv4. See the running SDK changelog for Git delivery and the live acceptance section for authorized test transactions. No package publication or contract upgrade.

## Source and decisions

- Marketplace: sdk_iteration_v2, 5aad0392510b7b4dce807f7edba39054c8f95fc4 (PR135). Compared with supplied 20a9bb7: changes are address-book/README updates recording the cap increase.
- Evaluator: feat/universal-evaluator, a7a8547822904b62c9b9dc031822b14c972abbc8. COMPARE replaces CHECK without changing enum value zero.
- Live reads confirmed version2.1.0, maxRulesPerCard4, kernel0x449C…, hook0xbee0…, evaluator0x2a73…, eUSD payment token. Cap transaction succeeded at block24837483. Hook/evaluator implementation slots match the October30 address book.
- User selected: gate multi-rule opening/funding, retain authoring/registration/preview; replace retired marketplace support.
- PR /pull/1 returned404; actual marketplace PR135 was discovered through GitHub API. Notion and Claude artifact were inaccessible through the web tool. Source and on-chain checks were used instead.

## Changed behavior

Card rules are ordered arrays with per-rule chains and one principal marker across the card. Job inputs contain principal, expiredAt and params. Opening signs the batch of grants and kernel creation, sessionHash zero. Result/mapping/history use rulesIds arrays. Canonical public job helpers and types use PRE/POST criteria; the default job namespace configures the compatible evaluator. Deposit and escrow remain separate, with eUSD escrow and PC read prepayment. Cancellation considers every recorded permission.

The SDK refuses multi-rule opening, funding and deposits until an all-rule hook exists, including funding jobs opened elsewhere. Four-rule registration does not imply execution support. Old signed plans and deployment constants are not retained as a compatibility adapter.

## Evidence and remaining acceptance

Contract review: 264 marketplace tests and54 current-hook tests passed locally in the planning review. SDK checkpoint:2309 units passed,12 existing skips; library build, public API comparison, guide snippets and package consumer checks passed. The additional funding-gate regression passes; all nine evaluator-local SDK scenarios pass after rebuilding the pinned AGW cache. The initial local evaluator run lacked the cached AGW artifact; its nine setup failures are not execution acceptance.

Two real-deployment fork smoke cases pass at Donut block24870502: card registration/discovery and independently verified batch opening on AGWv6, followed by cancellation and permission revocation. Nine separate evaluator-local scenarios cover escrow, PRE/POST reads, payout/refund and recovery against real contracts with simulated consensus. No public-chain writes occurred. The archive endpoint failed and the older pinned state was pruned on the normal endpoint; these failed attempts are retained separately and are not counted as acceptance. The normal endpoint succeeded at the fresh pinned block. Old2.0 fork results are not counted as2.1 acceptance.

## Website handoff

Replace the earlier2.0/manual-evaluator handoff with2.1/eUSD/PRE-POST. Cards have ordered chain rules and duration bounds; criteria have no executeBy/failFinalAt. Explain multi-rule execution gating despite live cap4. Do not copy old pUSDC or CEA-mismatch warnings. Use packages/core/MARKETPLACE.md and current source for API examples. Do not imply npm publication from branch or package metadata.

Final checks: SDK build, spec/local types, source/declaration API equality, CJS/ESM/package consumers, both guides, production lint and all76 scenario mappings pass. V5 independently passes types and66 focused tests. Implementation trees match; new plan records remain onv4 and v5 release metadata is unchanged. No commit or push.

## Live acceptance

[November1 live results](research/sdk-2.1-2026-11-01/live/README.md): nine distinct scenarios passed across runs, including PRE/POST evaluator completion/payout and prepaid refunds. Two read-path fixes passed2312 units. First-run failures and recovery are documented; no legacy decoder added.
