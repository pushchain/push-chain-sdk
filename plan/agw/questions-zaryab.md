# AGW SDK — questions for Zaryab

Updated October 6, 2026. Please confirm the release scope below and review the shared Solana API choice with Harsh.

<a id="z1"></a>
<a id="z1-3"></a>

## Z1.3. Rule references and editable labels

**For each item, is it included in v1 or deferred?**

| Item | SDK target | Current contracts |
| --- | --- | --- |
| Rule `ref` | Optional job/card reference on a grant | `grantRules(Session)` and `RulesGranted` have no job reference |
| Editable label | Owner calls `w.setLabel(label)` | Label is emitted at deployment; `setLabel` is absent |

If included, please confirm the existing [page-1 proposal](https://app.notion.com/p/pushprotocol/1-AGW-Contract-Changes-nomenclature-standard-change-set-3e9188aea7f4813aa31fc95ceb4e684d) remains the target and share the updated ABI when ready. Signed grants must bind the rule `ref`.

If deferred, please agree the v1 scope with Harsh so we can align the public SDK.

<a id="h4-4"></a>

## H4.4. Public Solana rules — with Harsh

**Should public Solana rules use IDL-based authoring, or explicit raw constraints?**

Our proposal compiles instruction/account/field inputs from an IDL and keeps gateway/CEA/token-account derivation internal. Decoded records preserve exact stored constraints.

Please review the [proposed types and examples](public-api-proposals.md#h44-solana-rule-inputs-and-decoded-records) with Harsh. This is the same [H4.4 question](questions-harsh.md#h4-4) in his document.

[Current contract guide](https://github.com/pushchain/push-agentic-wallets/blob/10a24f101e2e6e0a9b76517b29f5cdb1aa967796/docs/5_SDK_Owner_Integration.md) · [SDK spec](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9)
