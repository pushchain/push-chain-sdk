# AGW SDK remaining contract follow-ups for Zaryab

Updated October 6, 2026 after the new Donut deployment and owner integration guide. Thank you: the multi-asset terms, versioned envelope, EVM CEA width, internal per-token reads/assertion ABI and SVM wire definitions are supplied. We have checked code/wiring read-only and saved the verified ABIs. Those delivery questions have been removed.

Only the following items remain in Z1. Please reply by sub-item with the agreed scope or fixture link. Deployment/address coordination is complete; adapter integration and funded acceptance are SDK work.

| Item | Remaining answer |
| --- | --- |
| [Z1.3](#z1-3) | Ref/label scope for this release |
| [Z1.4](#z1-4) | Representative SVM integration fixtures/registry inputs where available |

## Source baseline

- [Owner integration guide](https://github.com/pushchain/push-agentic-wallets/blob/10a24f101e2e6e0a9b76517b29f5cdb1aa967796/docs/5_SDK_Owner_Integration.md).
- [V4 address book](https://github.com/pushchain/push-agentic-wallets/blob/10a24f101e2e6e0a9b76517b29f5cdb1aa967796/docs/addresses/donut.md).
- Reported deployed source e8db748; documentation head deploy-agw@10a24f1 has identical src. Donut probe block 23931055: factory/wallet/policy wiring matches, URP 3.1.0. [Evidence and remaining SDK work](research/deployment-review-2026-10-06/README.md).
- Target public API remains [page 5](notion/5-sdk-agw.md), qualified by Harsh's later replies/comments. New owner guide describes deployed wire behavior; it does not settle every public API/scope question. Notion was not re-exported in this pass.

<a id="z1"></a>

## Z1 Remaining surface and integration details

<a id="z1-3"></a>

### Z1.3 Ref and editable labels: delivery or v1 scope change?

The new generation still exposes grantRules(Session) without ref, and RulesGranted carries no job reference. Label is emitted by WalletDeployed only; setLabel and label storage are absent. The target SDK still promises rule ref and w.setLabel.

Please confirm whether those are follow-up contract changes for this release or should be explicitly deferred from v1 with Harsh. If they are coming, provide the selected parameter/event shape when ready, including signature binding for ref on signed grants. We will keep unsupported capabilities explicit until the public scope and delivered ABI agree.

<a id="z1-4"></a>

### Z1.4 SVM example to validate the SDK mapping

SvmTerms/program/account/data-pin definitions are supplied; we are not asking for those structs again. If available, please share one representative Donut-to-Solana fixture covering:

- Cluster CAIP-2 value and gateway program/registry source.
- Destination CEA and protected token/output accounts, with their derivation inputs.
- A valid encoded envelope and outbound payload for one allowed instruction; expected account/data-pin matches and corresponding failure cases.

We will implement SDK resolution/composition. This fixture helps verify that our PDA/ATA coverage and payload encoding match the contract/parser and actual cluster configuration. The owner guide explicitly excludes agent outbound composition; source-level SVM support alone does not prove a live destination route.

## Product choices kept separate

[Harsh's draft](questions-harsh.md) retains native omission defaults/public fields, raw-offset authoring and multi-rule send selection. The new guide confirms that multiple rules may exist for the same agent and chain; it does not choose a sendTransaction selection API. No public multi-asset spend, revoked-history or compileCard request is reopened.

[Implementation plan](implementation-plan.md) · [External dependencies](external-blockers.md) · [Current baseline](current-baseline.md)
