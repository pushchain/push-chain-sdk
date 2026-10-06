# AGW SDK — questions for Zaryab

Updated October 6, 2026. Please confirm the release scope below and answer the Solana API question Harsh redirected to you on October 6.

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

## 3. How should developers describe a Solana rule? — H4.4, Zaryab

Harsh redirected this question to Zaryab. The contract’s Solana constraint format is available; we need to agree on the developer-facing input the SDK compiles into that format.

**Example intent:** “Allow the agent to call a vault’s `deposit` instruction, only for Alice’s specified destination account, with an amount no greater than 10.” There are two ways a developer could express this:

| Option | What the developer supplies | What the SDK does |
| --- | --- | --- |
| Named inputs using an IDL | Program address, IDL (the program’s interface description), instruction name `deposit`, named accounts and constraints on fields such as `amount` | Resolves the discriminator, account positions and data offsets from the supported IDL layout, then builds the contract constraints |
| Explicit raw constraints | Program address, instruction discriminator, account positions/expected addresses, and data byte offsets/comparisons | Validates and encodes the supplied constraints without requiring an IDL |

In both options, the SDK derives the wallet’s destination CEA and protected token accounts internally. Reading a stored rule returns its exact constraints; the contract does not store the original IDL or field names.

**Recommendation:** support named IDL inputs for layouts the SDK can verify. Unsupported layouts must fail clearly rather than guess offsets.

**Decision needed from Zaryab:** should v1 expose IDL-based inputs, raw constraints, or both? If both, raw input should be an explicit advanced form. [Proposed types and boundaries](public-api-proposals.md#h44-solana-rule-inputs-and-decoded-records).

Harsh also now prefers `0` for omitted native `maxValuePerCall` and `maxValueTotal` and invited your input. The SDK already uses those defaults; flag any contract-side concern.

[Current contract guide](https://github.com/pushchain/push-agentic-wallets/blob/10a24f101e2e6e0a9b76517b29f5cdb1aa967796/docs/5_SDK_Owner_Integration.md) · [SDK spec](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9)
