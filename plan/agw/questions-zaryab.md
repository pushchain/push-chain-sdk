# AGW SDK remaining contract follow-ups for Zaryab

Rechecked October 6, 2026 against all saved Notion sources, live pages 1/5 and their All discussions, freshly fetched contract branches, the owner guide and SDK code. [Evidence and dispositions](research/question-source-recheck-2026-10-06/README.md). Multi-asset terms, envelope, EVM CEA width, accounting ABI, SVM wire definitions and deployment are supplied; those questions are closed. No questions have been sent.

Only Z1.3 needs a contract release-scope answer. We supplied and live-validated our own SVM fixture, so Z1.4 is removed. The public Solana SDK representation needs joint review under [Harsh H4.4](questions-harsh.md#h4-4); [concrete proposals](public-api-proposals.md) are ready. Deployment/address coordination is complete.

| Item | Remaining answer |
| --- | --- |
| [Z1.3](#z1-3) | Ref/label scope for this release |

## Source baseline

- [Owner integration guide](https://github.com/pushchain/push-agentic-wallets/blob/10a24f101e2e6e0a9b76517b29f5cdb1aa967796/docs/5_SDK_Owner_Integration.md).
- [V4 address book](https://github.com/pushchain/push-agentic-wallets/blob/10a24f101e2e6e0a9b76517b29f5cdb1aa967796/docs/addresses/donut.md).
- Reported deployed source e8db748; documentation head deploy-agw@10a24f1 has identical src. Donut probe block 23931055: factory/wallet/policy wiring matches, URP 3.1.0. [Evidence and remaining SDK work](research/deployment-review-2026-10-06/README.md).
- Fresh fetch confirms deploy-agw remains 10a24f1 and pushAgenticWallet_v3 remains e8db748; no src difference. No later branch supplies ref/setLabel.
- Target public API remains [page 5](notion/5-sdk-agw.md), qualified by Harsh's later replies/comments. Live pages 1/5 and All discussions were inspected again; no release-scope answer was visible. Notion was not re-exported in this pass.

<a id="z1"></a>

## Z1 Remaining surface and integration details

<a id="z1-3"></a>

### Z1.3 Ref and editable labels: delivery or v1 scope change?

The generation still exposes grantRules(Session) without ref, and RulesGranted carries no job reference. Label is emitted by WalletDeployed only; setLabel is absent. Page 1 already proposes grantRules(Session, ref) and owner-only setLabel with LabelSet, without a checkpoint. We are not asking you to design that surface again.

**Decision needed:** are rule ref and editable labels included in this release, or explicitly deferred from v1 with Harsh? If included, confirm that the existing page-1 proposal is still the target and announce the compatible source/ABI when ready. Signed grants must bind the ref as part of their authorized contents. We will keep absent capabilities explicit until the agreed scope and delivered ABI match. Checkpoint event ref is a rulesId/action hash; it is not the missing job ref.

## Product choices kept separate

[Harsh's draft](questions-harsh.md) retains native PC defaults/token wording, raw-offset authoring, multi-rule send selection and the joint public-Solana representation decision. The new guide confirms same-agent/same-chain multiplicity; it does not choose a send selection API. No public spend, revoked-history or compileCard request is reopened.

The [Solana wire evidence](research/live-svm-wire-2026-10-06/README.md) proves positive delivery/replay and later terminal-rejection classification. Its initial ten-minute timeout is retained; retry timing is an optional [operational follow-up](research/live-svm-wire-2026-10-06/platform-followup.md), separate from the contract scope question above.

[Implementation plan](implementation-plan.md) · [External dependencies](external-blockers.md) · [Current baseline](current-baseline.md)
